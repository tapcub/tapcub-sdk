/**
 * 持久队列（dev_behavior_phase3/01 §7）：内存镜像 + storage 分片 `tc_q_{n}`。
 * - 追加只写最后一片，出队只重写第一片；片索引 `tc_q_i = {f,l}`。
 * - 上限：maxEvents 条 / maxDays 天 / maxStorageBytes 字节（小程序 ≤ 1 MB），超出丢最旧。
 * - 同一 `mid` 不重复入队。
 */
import type { Payload, QueueLimits, Storage } from './types.ts';
import { byteLength, safeParse } from './util.ts';

const CHUNK_ITEMS = 40;
const IDX = 'tc_q_i';
const key = (n: number) => `tc_q_${n}`;

interface Chunk {
  n: number;
  items: Payload[];
  bytes: number;
}

export class PersistentQueue {
  private chunks: Chunk[] = [];
  private mids = new Set<string>();
  private first = 0;
  private last = -1;
  private persistent = false;

  private readonly storage: Storage;
  private readonly limits: QueueLimits;
  private readonly now: () => number;
  private readonly onError: (code: 'storage_failed' | 'queue_overflow', msg: string) => void;

  constructor(storage: Storage, limits: QueueLimits, now: () => number, onError: (code: 'storage_failed' | 'queue_overflow', msg: string) => void) {
    this.storage = storage;
    this.limits = limits;
    this.now = now;
    this.onError = onError;
  }

  /** 打开持久层：读取已存分片、丢过期、合并内存中已有的条目 */
  load(): void {
    this.persistent = true;
    const idx = safeParse<{ f: number; l: number } | null>(this.safeGet(IDX), null);
    const mem = this.chunks;
    this.chunks = [];
    this.mids.clear();
    if (idx && Number.isFinite(idx.f) && Number.isFinite(idx.l) && idx.l >= idx.f && idx.l - idx.f < 10000) {
      const minTs = this.now() - this.limits.maxDays * 86400000;
      for (let n = idx.f; n <= idx.l; n++) {
        const raw = this.safeGet(key(n));
        const items = safeParse<Payload[]>(raw, []).filter((p) => p && typeof p.mid === 'string' && (typeof p.ts !== 'number' || p.ts >= minTs));
        if (!items.length) {
          this.safeRemove(key(n));
          continue;
        }
        for (const p of items) this.mids.add(p.mid);
        this.chunks.push({ n, items, bytes: raw ? byteLength(raw) : 0 });
      }
      this.first = idx.f;
      this.last = idx.l;
    }
    if (!this.chunks.length) {
      this.first = 0;
      this.last = -1;
    }
    // 内存期入队的条目（同意前已放行的等）追加到持久层
    for (const c of mem) for (const p of c.items) this.push(p);
    this.enforce();
    this.writeIndex();
  }

  /** 关闭持久层并清空 storage（撤回同意 / optOut） */
  purge(): void {
    for (const c of this.chunks) this.safeRemove(key(c.n));
    this.safeRemove(IDX);
    this.chunks = [];
    this.mids.clear();
    this.first = 0;
    this.last = -1;
    this.persistent = false;
  }

  clear(): void {
    const wasPersistent = this.persistent;
    this.purge();
    this.persistent = wasPersistent;
  }

  get length(): number {
    let n = 0;
    for (const c of this.chunks) n += c.items.length;
    return n;
  }

  get bytes(): number {
    let n = 0;
    for (const c of this.chunks) n += c.bytes;
    return n;
  }

  push(p: Payload): boolean {
    if (this.mids.has(p.mid)) return false;
    let tail = this.chunks[this.chunks.length - 1];
    if (!tail || tail.items.length >= CHUNK_ITEMS) {
      tail = { n: ++this.last, items: [], bytes: 0 };
      if (!this.chunks.length) this.first = this.last;
      this.chunks.push(tail);
      this.writeIndex();
    }
    tail.items.push(p);
    this.mids.add(p.mid);
    this.writeChunk(tail);
    this.enforce();
    return true;
  }

  /** 按顺序取一批：≤ maxBatch 条且序列化后 ≤ maxBytes */
  peek(): Payload[] {
    const out: Payload[] = [];
    let bytes = 2;
    for (const c of this.chunks) {
      for (const p of c.items) {
        const b = byteLength(JSON.stringify(p)) + 1;
        if (out.length && (out.length >= this.limits.maxBatch || bytes + b > this.limits.maxBytes)) return out;
        out.push(p);
        bytes += b;
        if (out.length >= this.limits.maxBatch) return out;
      }
    }
    return out;
  }

  get loaded(): boolean {
    return this.persistent;
  }

  /** 按 mid 移除（已发送成功或 4xx 丢弃）；发送期间被 enforce 淘汰的条目自然跳过 */
  ack(items: Payload[]): void {
    const set = new Set(items.map((p) => p.mid));
    for (let i = 0; i < this.chunks.length && set.size; ) {
      const c = this.chunks[i];
      const before = c.items.length;
      c.items = c.items.filter((p) => {
        if (!set.has(p.mid)) return true;
        set.delete(p.mid);
        this.mids.delete(p.mid);
        return false;
      });
      if (c.items.length === before) {
        i++;
        continue;
      }
      if (!c.items.length) {
        this.chunks.splice(i, 1);
        this.safeRemove(key(c.n));
        this.first = this.chunks.length ? this.chunks[0].n : this.last + 1;
        this.writeIndex();
      } else {
        this.writeChunk(c);
        i++;
      }
    }
  }

  private enforce(): void {
    let dropped = 0;
    while (this.length > this.limits.maxEvents || this.bytes > this.limits.maxStorageBytes) {
      const head = this.chunks[0];
      if (!head) break;
      const excessItems = this.length - this.limits.maxEvents;
      const take = this.bytes > this.limits.maxStorageBytes ? Math.max(1, Math.ceil(head.items.length / 2)) : Math.min(Math.max(1, excessItems), head.items.length);
      for (let i = 0; i < take; i++) this.mids.delete(head.items[i].mid);
      head.items.splice(0, take);
      dropped += take;
      if (!head.items.length) {
        this.chunks.shift();
        this.safeRemove(key(head.n));
        this.first = this.chunks.length ? this.chunks[0].n : this.last + 1;
        this.writeIndex();
      } else this.writeChunk(head);
    }
    if (dropped) this.onError('queue_overflow', `dropped ${dropped} oldest events`);
  }

  private writeChunk(c: Chunk): void {
    const s = JSON.stringify(c.items);
    c.bytes = byteLength(s);
    if (!this.persistent) return;
    try {
      this.storage.set(key(c.n), s);
    } catch (e) {
      this.onError('storage_failed', String(e));
    }
  }
  private writeIndex(): void {
    if (!this.persistent) return;
    try {
      if (this.chunks.length) this.storage.set(IDX, JSON.stringify({ f: this.first, l: this.last }));
      else this.storage.remove(IDX);
    } catch (e) {
      this.onError('storage_failed', String(e));
    }
  }
  private safeGet(k: string): string | null {
    try {
      return this.storage.get(k);
    } catch {
      return null;
    }
  }
  private safeRemove(k: string): void {
    if (!this.persistent) return;
    try {
      this.storage.remove(k);
    } catch {
      /* ignore */
    }
  }
}
