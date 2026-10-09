import type { PropValue, Props, RemoteConfig } from './types.ts';

/** 与 packages/shared/src/identity.ts 对齐的常量（小程序端不依赖 shared 以控制包体；test/align.test.mjs 对齐） */
export const BLOCKED_ID_RE = /^([0-]*|-1|null|undefined|NaN|anonymous|guest|true|false|\[object Object\])$/i;
export const DEVICE_ID_RE = /^(web_cookie|web_cookieless|mp_openid|mp_uuid|ios_idfv|android_id|harmony_odid|custom):[A-Za-z0-9_-]{8,64}$/;
export const LOGIN_ID_MAX = 200;
export const HEX64 = /^[a-f0-9]{64}$/i;
export const LIMITS = {
  name: 100,
  propKey: 50,
  propValue: 200,
  propKeys: 30,
  presetPropKeys: 40,
  profileKeys: 50,
  stack: 4000,
  message: 1000,
  url: 4000,
  title: 200,
} as const;

export const DEFAULT_RC: RemoteConfig = {
  enabled: true,
  blacklist: [],
  sample: 100,
  interval: 30,
  threshold: 30,
  deviceBlacklist: [],
  requireConsent: false,
  autotrack: true,
  textCapture: false,
  elementBlacklist: [],
  perf: false,
  minVersion: null,
  ttl: 86400,
};

const clampInt = (v: unknown, min: number, max: number, d: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const strList = (v: unknown, max: number, len: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= len).slice(0, max) : [];

/** 与 shared.normalizeSdkRemoteConfig 同规则 */
export function normalizeRc(raw: unknown): RemoteConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_RC;
  const mv = typeof r.minVersion === 'string' && /^\d+\.\d+\.\d+$/.test(r.minVersion.trim()) ? r.minVersion.trim() : null;
  return {
    enabled: r.enabled !== false,
    blacklist: strList(r.blacklist, 50, 100),
    sample: clampInt(r.sample, 1, 100, d.sample),
    interval: clampInt(r.interval, 10, 1800, d.interval),
    threshold: clampInt(r.threshold, 10, 1000, d.threshold),
    deviceBlacklist: strList(r.deviceBlacklist, 50, 80),
    requireConsent: r.requireConsent === true,
    autotrack: r.autotrack !== false,
    textCapture: r.textCapture === true,
    elementBlacklist: strList(r.elementBlacklist, 50, 120),
    perf: r.perf === true,
    minVersion: mv,
    ttl: clampInt(r.ttl, 300, 604800, d.ttl),
  };
}

/** semver 比较：a<b → -1，a==b → 0，a>b → 1；非法视为 0.0.0 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function hex(bytes: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (bytes[i] + 256).toString(16).slice(1);
  return s;
}

/** n 字节随机 hex（随机源由 Timers.random 注入，便于向量确定性） */
export function randomHex(random: () => number, n: number): string {
  const a: number[] = [];
  for (let i = 0; i < n; i++) a.push(Math.floor(random() * 256) & 255);
  return hex(a);
}

/** UUID v4（带横线，36 字符，collector `mid` 正则 [A-Za-z0-9_-]{8,36}） */
export function uuidV4(random: () => number): string {
  const h = randomHex(random, 16).split('');
  h[12] = '4';
  h[16] = ((parseInt(h[16], 16) & 3) | 8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** FNV-1a 32 位；用于采样（按 device_id 稳定） */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ---- SHA-256（纯 JS；小程序无 crypto.subtle）----
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
function utf8(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d < 0xe000) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}
export function sha256(text: string): string {
  const m = utf8(text);
  const l = m.length;
  const bitLen = l * 8;
  m.push(0x80);
  while (m.length % 64 !== 56) m.push(0);
  for (let i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 255);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < m.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[off + i * 4] << 24) | (m[off + i * 4 + 1] << 16) | (m[off + i * 4 + 2] << 8) | m[off + i * 4 + 3];
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += (H[i] >>> 0).toString(16).padStart(8, '0');
  return out;
}

/** email 小写 / mobile 去空格横线（与 w-id.js、collector 一致） */
export const normId = (t: string, v: string) => (t === 'email' ? v.trim().toLowerCase() : t === 'mobile' ? v.replace(/[\s-]/g, '') : v.trim());

/**
 * 属性归一化：键 ≤50 / 值 ≤200；`$` 预置键与用户键分别限数（phase3/01 §3、collector LIMITS）。
 * 对象 / 数组值 JSON 化后截断；null / undefined 丢弃。
 */
export function normProps(input: Props | undefined, userMax: number = LIMITS.propKeys, presetMax: number = LIMITS.presetPropKeys): Record<string, PropValue> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, PropValue> = {};
  let user = 0;
  let preset = 0;
  for (const k of Object.keys(input)) {
    const v = input[k];
    if (v === null || v === undefined || !k || k.length > LIMITS.propKey) continue;
    const isPreset = k.charCodeAt(0) === 36; // '$'
    if (isPreset) {
      if (preset >= presetMax) continue;
      preset++;
    } else {
      if (user >= userMax) continue;
      user++;
    }
    if (typeof v === 'string') out[k] = v.length > LIMITS.propValue ? v.slice(0, LIMITS.propValue) : v;
    else if (typeof v === 'number') out[k] = Number.isFinite(v) ? v : 0;
    else if (typeof v === 'boolean') out[k] = v;
    else {
      let s: string;
      try {
        s = JSON.stringify(v);
      } catch {
        s = String(v);
      }
      out[k] = s.length > LIMITS.propValue ? s.slice(0, LIMITS.propValue) : s;
    }
  }
  return out;
}

export function safeParse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** UTF-8 字节数（估算 body 大小；小程序无 TextEncoder） */
export function byteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? ((i++), 4) : 3;
  }
  return n;
}
