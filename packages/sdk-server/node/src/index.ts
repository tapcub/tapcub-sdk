export type ConsumerKind = 'sync' | 'batch' | 'log' | 'debug';

export interface TrackOptions {
  loginId?: string;
  deviceId?: string;
  properties?: Record<string, unknown>;
  time?: number;
  insertId?: string;
  sessionId?: string;
  context?: Record<string, unknown>;
}

export interface TapCubOptions {
  apiKey: string;
  endpoint: string;
  consumer?: ConsumerKind;
  maxBatch?: number;
  flushIntervalMs?: number;
}

type Payload = Record<string, unknown>;

export class TapCub {
  private queue: Payload[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private debugOn = false;
  constructor(private readonly opts: TapCubOptions) {
    if ((opts.consumer ?? 'batch') === 'batch') {
      this.timer = setInterval(() => void this.flush(), opts.flushIntervalMs ?? 3000);
      if (this.timer.unref) this.timer.unref();
    }
  }

  static fromRequestHeaders(headers: Record<string, string | string[] | undefined>) {
    const g = (k: string) => {
      const v = headers[k] ?? headers[k.toLowerCase()];
      return Array.isArray(v) ? v[0] : v;
    };
    return { device_id: g('x-tc-device') || undefined, session_id: g('x-tc-session') || undefined };
  }

  debug(on = true) {
    this.debugOn = on;
  }

  track(event: string, o: TrackOptions = {}) {
    return this.enqueue({ type: 'track', event, ...this.norm(o) });
  }
  trackSignup(loginId: string, deviceId: string, properties?: Record<string, unknown>) {
    return this.enqueue({ type: 'track_signup', event: 'sign_up', login_id: loginId, device_id: deviceId, properties });
  }
  bind(loginId: string, identities: Record<string, string>) {
    return this.enqueue({ type: 'bind', login_id: loginId, identities: this.hashIds(identities) });
  }
  unbind(loginId: string, identityType: string, value: string) {
    return this.enqueue({ type: 'unbind', login_id: loginId, identities: { [identityType]: value } });
  }
  profileSet(loginId: string, props: Record<string, unknown>) {
    return this.enqueue({ type: 'profile_set', login_id: loginId, properties: props });
  }
  profileSetOnce(loginId: string, props: Record<string, unknown>) {
    return this.enqueue({ type: 'profile_set_once', login_id: loginId, properties: props });
  }
  profileIncrement(loginId: string, increment: Record<string, number>) {
    return this.enqueue({ type: 'profile_increment', login_id: loginId, increment });
  }
  profileAppend(loginId: string, append: Record<string, unknown[]>) {
    return this.enqueue({ type: 'profile_append', login_id: loginId, append });
  }
  profileUnset(loginId: string, keys: string[]) {
    return this.enqueue({ type: 'profile_unset', login_id: loginId, unset: keys });
  }
  itemSet(itemType: string, itemId: string, props: Record<string, unknown>) {
    return this.enqueue({ type: 'item_set', item_type: itemType, item_id: itemId, properties: props });
  }
  itemDelete(itemType: string, itemId: string) {
    return this.enqueue({ type: 'item_delete', item_type: itemType, item_id: itemId });
  }
  trackUpdate(event: string, insertId: string, properties: Record<string, unknown>) {
    return this.enqueue({ type: 'track_update', event, insert_id: insertId, properties });
  }
  trackOverwrite(event: string, insertId: string, properties: Record<string, unknown>) {
    return this.enqueue({ type: 'track_overwrite', event, insert_id: insertId, properties });
  }

  async flush() {
    if (!this.queue.length) return;
    const batch = this.queue.splice(0, this.opts.maxBatch ?? 200);
    await this.send(batch);
  }
  async close() {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }

  private norm(o: TrackOptions): Payload {
    const ctx = { platform: 'server', ...(o.context ?? {}) };
    return {
      login_id: o.loginId,
      device_id: o.deviceId,
      properties: o.properties,
      time: o.time,
      insert_id: o.insertId,
      session_id: o.sessionId,
      context: ctx,
    };
  }

  private hashIds(ids: Record<string, string>) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(ids)) {
      if ((k === 'email' || k === 'mobile') && v && !/^[a-f0-9]{64}$/i.test(v)) {
        out[k] = this.sha256(k === 'email' ? v.trim().toLowerCase() : v.replace(/[\s-]/g, ''));
      } else out[k] = v;
    }
    return out;
  }

  private sha256(s: string) {
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha256').update(s).digest('hex');
  }

  private enqueue(ev: Payload) {
    ev.context = { library: { name: '@tapcub/node', version: '0.1.0' }, ...((ev.context as object) ?? {}) };
    if ((this.opts.consumer ?? 'batch') === 'sync' || this.debugOn || this.opts.consumer === 'debug') return this.send([ev]);
    this.queue.push(ev);
    if (this.queue.length >= (this.opts.maxBatch ?? 200)) return this.flush();
  }

  private async send(events: Payload[]) {
    const url = `${this.opts.endpoint.replace(/\/$/, '')}/api/v1/track${this.debugOn || this.opts.consumer === 'debug' ? '?debug=1' : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({ events }),
    });
    if (!res.ok && res.status !== 429) {
      const text = await res.text().catch(() => '');
      throw new Error(`TapCub track ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json().catch(() => ({}));
  }
}
