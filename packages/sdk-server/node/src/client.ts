import { gzipSync } from 'node:zlib';
import { TapCubError } from './errors.ts';
import * as n from './normalize.ts';
import type { Logger, SignupOptions, TrackContext, TrackOptions, TrackResponse, WireEvent } from './types.ts';
import { VERSION } from './version.ts';

export type ConsumerKind = 'batch' | 'sync' | 'debug';

export interface TapCubOptions {
  /** Project API key (`wck_…`) with the `track:write` scope */
  apiKey: string;
  /** Leave unset: the TapCub ingest API is built in. Set it only for a dedicated address TapCub gives you. */
  endpoint?: string;
  /**
   * `batch` (default): queue in memory, send every `flushIntervalMs` or when `maxBatch` events are queued.
   * `sync`: send on every call; the returned promise rejects on failure.
   * `debug`: like `sync`, but against `?debug=1` (validated, not stored) and every result is logged.
   */
  consumer?: ConsumerKind;
  /** Events per request, 1–1000. Default 200 */
  maxBatch?: number;
  /** Default 3000 */
  flushIntervalMs?: number;
  /** Queued events kept in memory; the oldest are dropped beyond this. Default 10000 */
  maxQueueSize?: number;
  /** Retries for network errors, 5xx and 429. Default 5 */
  maxRetries?: number;
  /** Per request. Default 10000 */
  timeoutMs?: number;
  /** Send `Content-Encoding: gzip`. Default false */
  gzip?: boolean;
  /** Called for failures in background sends (and dropped events). Default: log with `logger.error` */
  onError?: (err: TapCubError) => void;
  /** Default `console` */
  logger?: Logger;
  /** Custom fetch (tests, proxies). Default the global fetch (Node.js 18+) */
  fetch?: typeof fetch;
}

const DEFAULT_ENDPOINT = 'https://api.pathclue.com';
const MAX_BODY_BYTES = 1_000_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Queued {
  ev: WireEvent;
  bytes: number;
}

/** Normalize the endpoint to an origin (plus any reverse-proxy prefix), without `/api/v1/track` */
export function normalizeEndpoint(endpoint: string | undefined) {
  let e = (endpoint || DEFAULT_ENDPOINT).trim().replace(/\/+$/, '');
  e = e.replace(/\/api\/v1(\/track)?$/, '');
  if (!/^https?:\/\//.test(e)) throw new TypeError('TapCub: endpoint must start with http:// or https://');
  return e;
}

export class TapCub {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly consumer: ConsumerKind;
  private readonly maxBatch: number;
  private readonly maxQueueSize: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly gzip: boolean;
  private readonly logger: Logger;
  private readonly onError: (err: TapCubError) => void;
  private readonly fetchImpl: typeof fetch;
  /** 测试用：退避基数（毫秒） */
  private readonly retryBaseMs: number;
  private queue: Queued[] = [];
  private dropped = 0;
  private chain: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private readonly onBeforeExit = () => void this.flush().catch(() => {});

  constructor(opts: TapCubOptions) {
    if (!opts || !opts.apiKey || !String(opts.apiKey).trim()) throw new TypeError('TapCub: apiKey is required');
    this.apiKey = String(opts.apiKey).trim();
    this.endpoint = normalizeEndpoint(opts.endpoint);
    this.consumer = opts.consumer ?? 'batch';
    if (!['batch', 'sync', 'debug'].includes(this.consumer)) throw new TypeError('TapCub: consumer must be batch, sync or debug');
    this.maxBatch = Math.min(1000, Math.max(1, Math.trunc(opts.maxBatch ?? 200)));
    this.maxQueueSize = Math.max(1, Math.trunc(opts.maxQueueSize ?? 10_000));
    this.maxRetries = Math.max(0, Math.trunc(opts.maxRetries ?? 5));
    this.timeoutMs = Math.max(1, opts.timeoutMs ?? 10_000);
    this.gzip = !!opts.gzip;
    this.logger = opts.logger ?? console;
    this.onError = opts.onError ?? ((err) => this.logger.error(`[tapcub] ${err.message}`));
    const f = opts.fetch ?? globalThis.fetch;
    if (typeof f !== 'function') throw new TypeError('TapCub: no global fetch; use Node.js 18+ or pass options.fetch');
    this.fetchImpl = f;
    this.retryBaseMs = (opts as { _retryBaseMs?: number })._retryBaseMs ?? 500;
    if (this.consumer === 'batch') {
      this.timer = setInterval(() => void this.backgroundFlush(), Math.max(10, opts.flushIntervalMs ?? 3000));
      this.timer.unref?.();
      process.once?.('beforeExit', this.onBeforeExit);
    }
  }

  /**
   * Read the device and session IDs a TapCub client put on a request to your backend
   * (`X-Tc-Device` / `X-Tc-Session`), to pass on as `deviceId` / `sessionId`.
   */
  static fromRequestHeaders(headers: Record<string, string | string[] | undefined> | { get(name: string): string | null }) {
    const g = (k: string) => {
      const v = typeof (headers as { get?: unknown }).get === 'function' ? (headers as { get(n: string): string | null }).get(k) : (headers as Record<string, string | string[] | undefined>)[k];
      const s = Array.isArray(v) ? v[0] : v;
      return s ? s.trim() || undefined : undefined;
    };
    return { deviceId: g('x-tc-device'), sessionId: g('x-tc-session') };
  }

  // ---------------- 事件 ----------------

  /** A business event */
  track(event: string, o: TrackOptions = {}) {
    const loginIdType = n.loginIdType(o.loginIdType);
    const rawLogin = n.optionalText('loginId', o.loginId, 200);
    return this.enqueue({
      type: 'track',
      event: n.eventName(event),
      login_id: rawLogin && (loginIdType === 'email' || loginIdType === 'mobile') ? n.identityValue(loginIdType, rawLogin) : rawLogin,
      login_id_type: loginIdType,
      device_id: n.optionalText('deviceId', o.deviceId, 72),
      session_id: n.optionalText('sessionId', o.sessionId, 32),
      insert_id: n.optionalText('insertId', o.insertId, 36),
      time: n.time(o.time),
      group: n.group(o.group),
      properties: n.properties(o.properties),
      context: n.context(o.context),
    });
  }

  /** Sign-up: links the anonymous device (if any) to the new login ID and records `sign_up` */
  trackSignup(loginId: string, o: SignupOptions = {}) {
    const props = { ...(o.properties ?? {}) } as Record<string, unknown>;
    if (o.invitedBy !== undefined && o.invitedBy !== null && String(o.invitedBy).trim() !== '') props.$invited_by = String(o.invitedBy).trim();
    return this.enqueue({
      type: 'track_signup',
      event: 'sign_up',
      login_id: n.requireText('loginId', loginId, 200),
      device_id: n.optionalText('deviceId', o.deviceId, 72),
      session_id: n.optionalText('sessionId', o.sessionId, 32),
      insert_id: n.optionalText('insertId', o.insertId, 36),
      time: n.time(o.time),
      properties: n.properties(props),
      context: n.context(o.context),
    });
  }

  /** Correct the properties of a stored event: merged into the event with this `insertId` */
  trackUpdate(event: string, insertId: string, properties: Record<string, unknown>) {
    return this.enqueue({ type: 'track_update', event: n.eventName(event), insert_id: n.requireText('insertId', insertId, 36), time: Date.now(), properties: n.properties(properties) });
  }

  /** Replace the properties of the stored event with this `insertId` */
  trackOverwrite(event: string, insertId: string, properties: Record<string, unknown>) {
    return this.enqueue({ type: 'track_overwrite', event: n.eventName(event), insert_id: n.requireText('insertId', insertId, 36), time: Date.now(), properties: n.properties(properties) });
  }

  // ---------------- 身份 ----------------

  /** Attach more identities (email, mobile, unionid, …) to the user. Email and mobile are hashed with SHA-256 before sending. */
  bind(loginId: string, identities: Partial<Record<'email' | 'mobile' | 'unionid' | 'openid' | 'custom' | 'login', string>>) {
    return this.enqueue({ type: 'bind', login_id: n.requireText('loginId', loginId, 200), time: Date.now(), identities: n.identities(identities) });
  }

  /** Remove one identity from the user */
  unbind(loginId: string, identityType: 'email' | 'mobile' | 'unionid' | 'openid' | 'custom' | 'login', value: string) {
    return this.enqueue({ type: 'unbind', login_id: n.requireText('loginId', loginId, 200), time: Date.now(), identities: n.identities({ [identityType]: n.requireText('value', value) }) });
  }

  // ---------------- 用户档案 ----------------

  profileSet(loginId: string, properties: Record<string, unknown>) {
    return this.profile('profile_set', loginId, { properties: n.properties(properties) });
  }
  /** Set only the properties that are not set yet */
  profileSetOnce(loginId: string, properties: Record<string, unknown>) {
    return this.profile('profile_set_once', loginId, { properties: n.properties(properties) });
  }
  profileIncrement(loginId: string, increment: Record<string, number>) {
    return this.profile('profile_increment', loginId, { increment: n.increment(increment) });
  }
  profileAppend(loginId: string, append: Record<string, unknown>) {
    return this.profile('profile_append', loginId, { append: n.append(append) });
  }
  profileUnset(loginId: string, keys: string[]) {
    return this.profile('profile_unset', loginId, { unset: n.unsetKeys(keys) });
  }

  // ---------------- 维度表 / 账户 ----------------

  /** Upsert a dimension row (product, article, store, …) */
  itemSet(itemType: string, itemId: string, properties: Record<string, unknown>) {
    return this.enqueue({ type: 'item_set', item_type: n.requireText('itemType', itemType, 40), item_id: n.requireText('itemId', itemId, 80), time: Date.now(), properties: n.properties(properties) });
  }
  itemDelete(itemType: string, itemId: string) {
    return this.enqueue({ type: 'item_delete', item_type: n.requireText('itemType', itemType, 40), item_id: n.requireText('itemId', itemId, 80), time: Date.now() });
  }
  /** Set account (group) traits for `groupType:groupId` */
  groupSet(groupType: string, groupId: string, properties: Record<string, unknown>) {
    return this.enqueue({ type: 'group_set', group: n.groupKey(groupType, groupId), time: Date.now(), properties: n.properties(properties) });
  }

  // ---------------- 发送 ----------------

  /** Send everything queued now. Rejects with the first `TapCubError` if a batch could not be delivered. */
  async flush(): Promise<void> {
    const run = this.chain.then(() => this.drain());
    this.chain = run.catch(() => {});
    const errors = await run;
    if (errors.length) throw errors[0];
  }

  /** Stop the timer and send what is queued. Call it before the process exits (serverless: at the end of each invocation, use `flush`). */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    process.removeListener?.('beforeExit', this.onBeforeExit);
    this.closed = true;
    await this.flush();
  }

  /** Number of events waiting in the queue */
  get queued() {
    return this.queue.length;
  }

  private profile(type: string, loginId: string, body: Partial<WireEvent>) {
    return this.enqueue({ type, login_id: n.requireText('loginId', loginId, 200), time: Date.now(), ...body });
  }

  private enqueue(raw: Record<string, unknown>): Promise<void> {
    const ev = n.compact(raw);
    if (this.consumer !== 'batch') return this.sendBatch([ev], this.consumer === 'debug').then(() => undefined);
    if (this.closed) this.logger.warn('[tapcub] event queued after close(); call flush() to send it');
    this.queue.push({ ev, bytes: Buffer.byteLength(JSON.stringify(ev)) + 1 });
    if (this.queue.length > this.maxQueueSize) {
      const over = this.queue.length - this.maxQueueSize;
      this.queue.splice(0, over);
      this.dropped += over;
    }
    if (this.queue.length >= this.maxBatch) void this.backgroundFlush();
    return Promise.resolve();
  }

  private backgroundFlush() {
    const run = this.chain.then(() => this.drain());
    this.chain = run.then(
      (errors) => errors.forEach((e) => this.report(e)),
      (e) => this.report(e instanceof TapCubError ? e : new TapCubError(String(e), { code: 'NETWORK', cause: e })),
    );
    return this.chain;
  }

  private report(err: TapCubError) {
    try {
      this.onError(err);
    } catch (e) {
      this.logger.error('[tapcub] onError threw', e);
    }
  }

  /** 按条数与 1 MB 切批，依次发送；返回最终失败的错误（不抛） */
  private async drain(): Promise<TapCubError[]> {
    const errors: TapCubError[] = [];
    if (this.dropped) {
      errors.push(new TapCubError(`TapCub: queue full, dropped ${this.dropped} oldest event(s)`, { code: 'QUEUE_FULL' }));
      this.dropped = 0;
    }
    while (this.queue.length) {
      let bytes = 0;
      let count = 0;
      while (count < this.queue.length && count < this.maxBatch && (count === 0 || bytes + this.queue[count].bytes <= MAX_BODY_BYTES)) bytes += this.queue[count++].bytes;
      const batch = this.queue.splice(0, count).map((q) => q.ev);
      try {
        await this.sendBatch(batch, false);
      } catch (e) {
        errors.push(e as TapCubError);
      }
    }
    return errors;
  }

  /** 发一批：网络错误 / 5xx / 429 按退避重试（同一报文），其他 4xx 不重试；失败抛 TapCubError */
  private async sendBatch(events: WireEvent[], debug: boolean): Promise<TrackResponse> {
    const url = `${this.endpoint}/api/v1/track${debug ? '?debug=1' : ''}`;
    const json = JSON.stringify({ events });
    const body = this.gzip ? gzipSync(json) : json;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      authorization: `Bearer ${this.apiKey}`,
      'user-agent': `tapcub-node/${VERSION}`,
    };
    if (this.gzip) headers['content-encoding'] = 'gzip';
    let last: TapCubError | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await sleep(this.backoff(attempt, last));
      let res: Response;
      try {
        res = await this.fetchImpl(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        last = new TapCubError(`TapCub: request failed: ${(e as Error)?.message ?? e}`, { code: 'NETWORK', events, cause: e });
        continue;
      }
      const text = await res.text().catch(() => '');
      let data: Record<string, unknown> = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (res.ok) {
        const out = { results: [], ...data } as TrackResponse;
        if (debug) for (const r of out.results ?? []) this.logger.warn(`[tapcub] debug #${r.index} ${r.ok ? 'ok' : 'rejected'}${r.warnings?.length ? ` warnings=${r.warnings.join(',')}` : ''}`);
        const bad = (out.results ?? []).filter((r) => !r.ok);
        if (bad.length) {
          throw new TapCubError(`TapCub: ${bad.length} event(s) rejected: ${bad.map((r) => `#${r.index} ${r.warnings.join(',') || 'rejected'}`).join('; ')}`, {
            code: 'EVENT_REJECTED',
            status: res.status,
            events: bad.map((r) => events[r.index]).filter(Boolean),
            results: bad,
          });
        }
        return out;
      }
      const code = typeof data.code === 'string' ? data.code : `HTTP_${res.status}`;
      const issues = Array.isArray(data.issues) ? ` (${(data.issues as unknown[]).slice(0, 3).join('; ')})` : '';
      last = new TapCubError(`TapCub: HTTP ${res.status} ${code}: ${typeof data.message === 'string' ? data.message : text.slice(0, 200)}${issues}`, { code, status: res.status, events });
      (last as { retryAfter?: number }).retryAfter = Number(res.headers.get('retry-after')) || undefined;
      if (res.status !== 429 && res.status < 500) throw last;
    }
    throw last!;
  }

  private backoff(attempt: number, last: TapCubError | null) {
    const ra = (last as { retryAfter?: number } | null)?.retryAfter;
    if (ra && ra > 0) return Math.min(60_000, ra * 1000);
    const base = Math.min(30_000, this.retryBaseMs * 2 ** (attempt - 1));
    return base / 2 + Math.random() * (base / 2);
  }
}

export type { TrackContext };
