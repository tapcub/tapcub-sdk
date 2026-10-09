/**
 * 向量运行器：读取 packages/shared/test-vectors/sdk/*.json，用 mock 适配驱动核心，断言载荷序列与状态。
 *
 * 向量格式：
 *   { name, platform?, seed?, now?, storage?, cfg?, collect?, config,
 *     steps: [ {call, args?}, {advance}, {lifecycle, info?}, {page: 'show'|'hide', path, query?, title?}, {share, path}, {net: {...}}, {storageFail: bool} ],
 *     expect: { items?, requests?, cfgRequests?, deviceReads?, state?, errors?, storage?, logs? } }
 * 匹配器（字符串）："<any>" "<absent>" "<uuid>" "<ts>" "<num>" "<str>" "<bool>" "<hex64>" "<did>" "<did:prefix>" "<sid>" "<re:...>"
 *   "<$name>" 首次出现记录、之后必须相等；"<!$name>" 必须与已记录值不同。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMock, drain } from './mock.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const VECTOR_DIR = join(here, '../../shared/test-vectors/sdk');

const DEVICE_ID_RE = /^(web_cookie|web_cookieless|mp_openid|mp_uuid|ios_idfv|android_id|harmony_odid|custom):[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function loadVectors() {
  return readdirSync(VECTOR_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, ...JSON.parse(readFileSync(join(VECTOR_DIR, f), 'utf8')) }));
}

class Matcher {
  constructor() {
    this.vars = new Map();
  }
  match(expected, actual, path, out) {
    if (typeof expected === 'string' && expected.startsWith('<') && expected.endsWith('>')) return this.token(expected.slice(1, -1), actual, path, out);
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) return out.push(`${path}: expected array, got ${typeof actual}`);
      if (expected.length !== actual.length) return out.push(`${path}: expected ${expected.length} items, got ${actual.length}`);
      expected.forEach((e, i) => this.match(e, actual[i], `${path}[${i}]`, out));
      return;
    }
    if (expected && typeof expected === 'object') {
      if (!actual || typeof actual !== 'object') return out.push(`${path}: expected object, got ${JSON.stringify(actual)}`);
      for (const k of Object.keys(expected)) this.match(expected[k], actual[k], `${path}.${k}`, out);
      return;
    }
    if (expected !== actual) out.push(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  token(t, actual, path, out) {
    const fail = (why) => out.push(`${path}: ${why} (got ${JSON.stringify(actual)})`);
    if (t === 'any') return actual === undefined ? fail('expected present') : undefined;
    if (t === 'absent') return actual === undefined ? undefined : fail('expected absent');
    if (t === 'uuid') return typeof actual === 'string' && UUID_RE.test(actual) ? undefined : fail('expected uuid v4');
    if (t === 'ts' || t === 'num') return typeof actual === 'number' && Number.isFinite(actual) ? undefined : fail('expected number');
    if (t === 'str') return typeof actual === 'string' && actual.length ? undefined : fail('expected non-empty string');
    if (t === 'bool') return typeof actual === 'boolean' ? undefined : fail('expected boolean');
    if (t === 'hex64') return typeof actual === 'string' && /^[a-f0-9]{64}$/.test(actual) ? undefined : fail('expected sha256 hex');
    if (t === 'did') return typeof actual === 'string' && DEVICE_ID_RE.test(actual) ? undefined : fail('expected device id');
    if (t.startsWith('did:')) return typeof actual === 'string' && DEVICE_ID_RE.test(actual) && actual.startsWith(t.slice(4) + ':') ? undefined : fail(`expected device id with prefix ${t.slice(4)}`);
    if (t === 'sid') return typeof actual === 'string' && /^[A-Za-z0-9]{8,32}$/.test(actual) ? undefined : fail('expected session id');
    if (t.startsWith('re:')) return typeof actual === 'string' && new RegExp(t.slice(3)).test(actual) ? undefined : fail(`expected /${t.slice(3)}/`);
    if (t.startsWith('$')) {
      if (actual === undefined) return fail('expected present (capture)');
      if (!this.vars.has(t)) this.vars.set(t, actual);
      else if (JSON.stringify(this.vars.get(t)) !== JSON.stringify(actual)) fail(`expected same as ${t}=${JSON.stringify(this.vars.get(t))}`);
      return;
    }
    if (t.startsWith('!$')) {
      const name = t.slice(1);
      if (actual === undefined) return fail('expected present');
      if (!this.vars.has(name)) return fail(`${name} not captured yet`);
      if (JSON.stringify(this.vars.get(name)) === JSON.stringify(actual)) fail(`expected different from ${name}`);
      return;
    }
    if (`<${t}>` !== actual) out.push(`${path}: expected ${JSON.stringify(`<${t}>`)}, got ${JSON.stringify(actual)}`);
  }
}

export async function runVector(vector, createSdk) {
  const m = createMock(vector);
  const errors = [];
  const sessions = [];
  const consents = [];
  const out = [];
  const mt = new Matcher();
  const boot = () => {
    const sdk = createSdk(m.adapters);
    sdk.onError((code, msg) => errors.push({ code, msg }));
    sdk.onSessionStart((sid, reason) => sessions.push({ sid, reason }));
    sdk.onConsentChange((c) => consents.push(c));
    if (vector.config !== null) sdk.preInit({ siteKey: 'k_vector_site', endpoint: 'https://c.test', appId: 'wxvector', ...(vector.config ?? {}) });
    return sdk;
  };
  let sdk = boot();

  for (const step of vector.steps ?? []) {
    if (step.call) {
      const r = sdk[step.call](...(step.args ?? []));
      const value = r && typeof r.then === 'function' ? await r : r;
      if (step.expect !== undefined) mt.match(step.expect, value, `call ${step.call}() return`, out);
    } else if (step.advance !== undefined) await m.clock.advance(step.advance);
    else if (step.restart) {
      // 模拟杀进程后冷启动：新实例、同一 storage / 时钟；已注册的定时器作废
      m.clock.clearAll?.();
      sdk = boot();
    } else if (step.tap) m.autoTrack.tap(step.tap, step.page ? { path: step.page } : null);
    else if (step.crash) m.crash.fire(step.crash);
    else if (step.lifecycle) m.lifecycle.fire(step.lifecycle, step.info ?? {});
    else if (step.page) m.lifecycle.fire(step.page === 'show' ? 'pageShow' : 'pageHide', { path: step.path, query: step.query, title: step.title });
    else if (step.share) m.lifecycle.fire('share', { path: step.path ?? 'pages/index/index' }, step.share);
    else if (step.favorite) m.lifecycle.fire('favorite', { path: step.path ?? 'pages/index/index' });
    else if (step.net) {
      if (step.net.cfg !== undefined) m.net.cfg = step.net.cfg;
      if (step.net.collect !== undefined) {
        m.net.collect = step.net.collect;
        m.net.collectSeq = Array.isArray(step.net.collect) ? [...step.net.collect] : null;
      }
    } else if (step.storageFail !== undefined) m.net.storageFail = !!step.storageFail;
    else throw new Error(`unknown step ${JSON.stringify(step)}`);
    await drain();
  }

  const e = vector.expect ?? {};
  const items = m.net.requests.flatMap((r) => (r.body && Array.isArray(r.body.items) ? r.body.items : []));
  if (e.items) mt.match(e.items, items, 'items', out);
  if (e.itemNames) mt.match(e.itemNames, items.map((i) => (i.t === 'id' ? `id:${i.op}` : i.n)), 'itemNames', out);
  if (e.requests) mt.match(e.requests, m.net.requests.map((r) => ({ url: r.url, sent: r.body?.sent, items: r.body?.items, count: r.body?.items?.length, bytes: r.bytes, at: r.at - m.start })), 'requests', out);
  if (e.requestCount !== undefined) mt.match(e.requestCount, m.net.requests.length, 'requestCount', out);
  if (e.cfgRequests !== undefined) mt.match(e.cfgRequests, m.net.cfgRequests.length, 'cfgRequests', out);
  if (e.deviceReads !== undefined) mt.match(e.deviceReads, m.deviceReads.count, 'deviceReads', out);
  if (e.state) mt.match(e.state, sdk.getState(), 'state', out);
  if (e.errors) mt.match(e.errors, errors.map((x) => x.code), 'errors', out);
  if (e.errorsInclude) for (const c of e.errorsInclude) if (!errors.some((x) => x.code === c)) out.push(`errors: expected to include ${c}, got ${JSON.stringify(errors.map((x) => x.code))}`);
  if (e.sessions) mt.match(e.sessions, sessions, 'sessions', out);
  if (e.consents) mt.match(e.consents, consents, 'consents', out);
  if (e.storage) mt.match(e.storage, m.storage.dump(), 'storage', out);
  if (e.storageKeys) mt.match(e.storageKeys, Object.keys(m.storage.dump()).sort(), 'storageKeys', out);
  return { failures: out, items, requests: m.net.requests, state: sdk.getState(), errors, storage: m.storage.dump() };
}
