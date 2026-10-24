import { createHash } from 'node:crypto';
import type { Campaign, Properties, PropertyValue, TrackContext, WireEvent } from './types.ts';

/** 与 apps/api server-events/track.service.ts 的 eventSchema 同一组上限（packages/shared/test-vectors/track/README.md） */
export const LOGIN_ID_TYPES = ['login', 'email', 'mobile', 'unionid', 'openid', 'custom'] as const;
export const PLATFORMS = ['web', 'mp_weixin', 'mp_alipay', 'mp_bytedance', 'mp_baidu', 'mp_kuaishou', 'mp_qq', 'android', 'ios', 'harmony', 'tvos', 'watchos', 'macos', 'windows', 'linux', 'server', 'import'] as const;
const GROUP_KEY_RE = /^[a-z][a-z0-9_]{0,23}:[A-Za-z0-9_@.\-]{1,80}$/;
const GROUP_TYPE_RE = /^[a-z][a-z0-9_]{0,23}$/;
const HEX64 = /^[a-f0-9]{64}$/i;
const CAMPAIGN_LIMITS: Record<keyof Omit<Campaign, 'touched_at'>, number> = { source: 100, medium: 100, name: 100, term: 100, content: 100, ref: 64, click_id: 1000, landing_url: 2000, referrer: 2000 };

export const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

const present = (v: unknown) => v !== undefined && v !== null;

/** 按 UTF-16 码元截断（服务端 zod 的 max 按 .length 计），不拆开代理对 */
export function cut(s: string, n: number) {
  if (s.length <= n) return s;
  const c = s.charCodeAt(n - 1);
  return s.slice(0, c >= 0xd800 && c <= 0xdbff ? n - 1 : n);
}
const str = (v: unknown) => (typeof v === 'string' ? v : String(v));

/** 参数错误：调用方写错，抛出且不入队 */
export function argError(msg: string): never {
  throw new TypeError(`TapCub: ${msg}`);
}

export function requireText(name: string, v: unknown, max?: number): string {
  const s = present(v) ? str(v).trim() : '';
  if (!s) argError(`${name} is required`);
  if (max !== undefined && s.length > max) argError(`${name} must be at most ${max} characters`);
  return s;
}

export function optionalText(name: string, v: unknown, max: number): string | undefined {
  if (!present(v)) return undefined;
  const s = str(v).trim();
  if (!s) return undefined;
  if (s.length > max) argError(`${name} must be at most ${max} characters`);
  return s;
}

export function eventName(v: unknown) {
  const s = present(v) ? str(v).trim() : '';
  if (!s) argError('event is required');
  return cut(s, 100);
}

export function loginIdType(v: unknown) {
  if (!present(v)) return undefined;
  if (!(LOGIN_ID_TYPES as readonly unknown[]).includes(v)) argError(`login_id_type must be one of ${LOGIN_ID_TYPES.join(', ')}`);
  return v as (typeof LOGIN_ID_TYPES)[number];
}

/** 身份值：email 小写、mobile 去空格与 -，再 SHA-256；已是 64 位十六进制的原样保留 */
export function identityValue(type: string, value: unknown): string {
  const v = present(value) ? str(value).trim() : '';
  if (type === 'email' || type === 'mobile') {
    const n = type === 'email' ? v.toLowerCase() : v.replace(/[\s-]/g, '');
    return HEX64.test(n) ? n.toLowerCase() : sha256(n);
  }
  return v;
}

export function identities(v: Record<string, unknown> | undefined | null) {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v ?? {})) {
    if (!(LOGIN_ID_TYPES as readonly string[]).includes(k)) argError(`unknown identity type "${k}"`);
    if (!present(raw) || str(raw).trim() === '') continue;
    out[k] = identityValue(k, raw);
  }
  return out;
}

export function group(v: unknown) {
  if (!present(v)) return undefined;
  const s = str(v);
  if (!GROUP_KEY_RE.test(s)) argError('group must look like "type:id" (type: a-z, 0-9, _)');
  return s;
}

export function groupKey(type: unknown, id: unknown) {
  const t = requireText('groupType', type);
  if (!GROUP_TYPE_RE.test(t)) argError('groupType must start with a-z and contain only a-z, 0-9 and _ (≤24)');
  return group(`${t}:${requireText('groupId', id)}`)!;
}

export function time(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (present(v)) argError('time must be a millisecond timestamp or a Date');
  return Date.now();
}

/** 嵌套值转紧凑 JSON 字符串（键序不变，不转义 / 与非 ASCII，同 JSON.stringify） */
const jsonText = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)) ?? '';

function scalar(v: unknown): PropertyValue | undefined {
  if (!present(v)) return undefined;
  if (typeof v === 'string') return cut(v, 1000);
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'bigint') return cut(v.toString(), 1000);
  if (v instanceof Date) return v.toISOString();
  return cut(jsonText(v), 1000);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

export function properties(p: Record<string, unknown> | undefined | null): Properties | undefined {
  if (!p) return undefined;
  const out: Properties = {};
  for (const [k, v] of Object.entries(p)) {
    const key = cut(k, 50);
    if (Array.isArray(v) && v.length && v.every(isPlainObject)) {
      out[key] = v.slice(0, 100).map((o) => {
        const row: Record<string, PropertyValue> = {};
        for (const [ik, iv] of Object.entries(o)) {
          const s = scalar(iv);
          if (s !== undefined) row[cut(ik, 50)] = s;
        }
        return row;
      });
      continue;
    }
    const s = scalar(v);
    if (s !== undefined) out[key] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

export function increment(p: Record<string, unknown> | undefined | null) {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(p ?? {})) if (typeof v === 'number' && Number.isFinite(v)) out[cut(k, 50)] = v;
  return out;
}

export function append(p: Record<string, unknown> | undefined | null) {
  const out: Record<string, (string | number | boolean)[]> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    const list = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' || typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x))) as (string | number | boolean)[];
    if (list.length) out[cut(k, 50)] = list.slice(0, 20);
  }
  return out;
}

export function unsetKeys(keys: unknown) {
  if (!Array.isArray(keys)) argError('keys must be an array of property names');
  return keys.filter((k) => present(k) && str(k) !== '').map((k) => cut(str(k), 50)).slice(0, 50);
}

export function campaign(c: unknown): Campaign | undefined {
  if (!isPlainObject(c)) return undefined;
  const out: Campaign = {};
  for (const [k, max] of Object.entries(CAMPAIGN_LIMITS) as [keyof typeof CAMPAIGN_LIMITS, number][]) {
    const v = c[k];
    if (present(v) && str(v) !== '') out[k] = cut(str(v), max);
  }
  if (typeof c.touched_at === 'number' && Number.isFinite(c.touched_at)) out.touched_at = Math.trunc(c.touched_at);
  return Object.keys(out).length ? out : undefined;
}

export function context(c: TrackContext | Record<string, unknown> | undefined | null): TrackContext | undefined {
  if (!isPlainObject(c)) return undefined;
  const out: TrackContext = {};
  const clip = (k: 'ip' | 'user_agent' | 'url' | 'lang', max: number) => {
    const v = c[k];
    if (present(v) && str(v) !== '') out[k] = cut(str(v), max);
  };
  clip('ip', 45);
  clip('user_agent', 1000);
  clip('url', 2000);
  if ((PLATFORMS as readonly unknown[]).includes(c.platform)) out.platform = c.platform as TrackContext['platform'];
  if (typeof c.country === 'string' && /^[A-Za-z]{2}$/.test(c.country)) out.country = c.country.toUpperCase();
  clip('lang', 12);
  const camp = campaign(c.campaign);
  if (camp) out.campaign = camp;
  return Object.keys(out).length ? out : undefined;
}

/** 去掉 undefined 字段，得到最终报文 */
export function compact(ev: Record<string, unknown>): WireEvent {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev)) if (v !== undefined) out[k] = v;
  return out as unknown as WireEvent;
}
