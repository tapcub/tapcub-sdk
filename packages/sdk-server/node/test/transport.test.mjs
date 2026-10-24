// 发送行为：本机 HTTP 服务模拟 /api/v1/track（批量、切批、重试、gzip、错误回调、debug）
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { TapCub, TapCubError, VERSION, normalizeEndpoint } from '../src/index.ts';

/** 起一个记录请求的服务；handler 返回 [status, body, headers?] */
async function server(handler = () => [200, { received: 1, accepted: 1, rejected: 0, events: 1, results: [] }]) {
  const reqs = [];
  const srv = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let raw = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'gzip') raw = gunzipSync(raw);
      const r = { url: req.url, headers: req.headers, body: JSON.parse(raw.toString('utf8')) };
      reqs.push(r);
      const [status, body, headers = {}] = handler(r, reqs.length);
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  return { reqs, endpoint: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) };
}

test('version matches package.json', () => {
  assert.equal(VERSION, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
});

test('endpoint normalization', () => {
  assert.equal(normalizeEndpoint(undefined), 'https://api.pathclue.com');
  assert.equal(normalizeEndpoint('https://api.pathclue.com/'), 'https://api.pathclue.com');
  assert.equal(normalizeEndpoint('https://x.example.com/api/v1/track'), 'https://x.example.com');
  assert.equal(normalizeEndpoint('https://x.example.com/proxy/api/v1'), 'https://x.example.com/proxy');
  assert.throws(() => normalizeEndpoint('api.pathclue.com'), TypeError);
  assert.throws(() => new TapCub({ apiKey: '' }), TypeError);
});

test('headers, path and user agent', async () => {
  const s = await server();
  const tc = new TapCub({ apiKey: 'wck_abc', endpoint: s.endpoint, consumer: 'sync' });
  await tc.track('purchase', { insertId: 'o1' });
  const r = s.reqs[0];
  assert.equal(r.url, '/api/v1/track');
  assert.equal(r.headers.authorization, 'Bearer wck_abc');
  assert.equal(r.headers['content-type'], 'application/json');
  assert.equal(r.headers['user-agent'], `tapcub-node/${VERSION}`);
  assert.deepEqual(Object.keys(r.body), ['events']);
  await s.close();
});

test('batch: queued until flush, split by maxBatch, close sends the rest', async () => {
  const s = await server();
  const tc = new TapCub({ apiKey: 'k', endpoint: s.endpoint, maxBatch: 2, flushIntervalMs: 60_000 });
  await tc.track('a');
  assert.equal(s.reqs.length, 0);
  assert.equal(tc.queued, 1);
  await tc.track('b'); // 满批触发后台发送
  await tc.track('c');
  await tc.close();
  assert.deepEqual(s.reqs.map((r) => r.body.events.map((e) => e.event)), [['a', 'b'], ['c']]);
  await s.close();
});

test('batch: flush on interval', async () => {
  const s = await server();
  const tc = new TapCub({ apiKey: 'k', endpoint: s.endpoint, flushIntervalMs: 30 });
  await tc.track('a');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(s.reqs.length, 1);
  await tc.close();
  await s.close();
});

test('batch: body is split at 1 MB', async () => {
  const s = await server();
  const tc = new TapCub({ apiKey: 'k', endpoint: s.endpoint, maxBatch: 1000, flushIntervalMs: 60_000 });
  const big = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`p${i}`, 'x'.repeat(1000)])); // ≈41 KB / 条
  for (let i = 0; i < 50; i++) await tc.track('big', { properties: big });
  await tc.flush();
  assert.ok(s.reqs.length >= 2, `${s.reqs.length} requests`);
  for (const r of s.reqs) assert.ok(Buffer.byteLength(JSON.stringify(r.body)) <= 1_000_000);
  assert.equal(s.reqs.reduce((n, r) => n + r.body.events.length, 0), 50);
  await tc.close();
  await s.close();
});

test('retries 5xx and 429 with the same body, then succeeds', async () => {
  const s = await server((_r, n) => (n === 1 ? [503, { message: 'down' }] : n === 2 ? [429, { message: 'slow' }, { 'retry-after': '0' }] : [200, { results: [] }]));
  const tc = new TapCub({ apiKey: 'k', endpoint: s.endpoint, consumer: 'sync', _retryBaseMs: 5 });
  await tc.track('a', { insertId: 'same' });
  assert.equal(s.reqs.length, 3);
  assert.deepEqual(s.reqs[0].body, s.reqs[2].body);
  await s.close();
});

test('4xx is not retried and raises the server code', async () => {
  const s = await server(() => [401, { statusCode: 401, message: 'bad key', code: 'BAD_API_KEY' }]);
  const tc = new TapCub({ apiKey: 'k', endpoint: s.endpoint, consumer: 'sync', _retryBaseMs: 5 });
  await assert.rejects(tc.track('a'), (e) => e instanceof TapCubError && e.code === 'BAD_API_KEY' && e.status === 401 && e.events.length === 1);
  assert.equal(s.reqs.length, 1);
  await s.close();
});

test('gives up after maxRetries; background errors go to onError, flush() rejects', async () => {
  const s = await server(() => [500, { message: 'boom' }]);
  const errors = [];
  const tc = new TapCub({ apiKey: 'k', endpoint: s.endpoint, maxRetries: 2, _retryBaseMs: 5, maxBatch: 1, flushIntervalMs: 60_000, onError: (e) => errors.push(e) });
  await tc.track('a'); // 满批 → 后台发送
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(s.reqs.length, 3);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'HTTP_500');
  await tc.close();
  // 显式 flush / close：抛出，不走 onError
  const tc2 = new TapCub({ apiKey: 'k', endpoint: s.endpoint, maxRetries: 1, _retryBaseMs: 5, flushIntervalMs: 60_000, onError: (e) => errors.push(e) });
  await tc2.track('b');
  await assert.rejects(tc2.close(), (e) => e instanceof TapCubError && e.code === 'HTTP_500' && e.events[0].event === 'b');
  assert.equal(errors.length, 1);
  await s.close();
});

test('network errors are retried and reported as NETWORK', async () => {
  const tc = new TapCub({ apiKey: 'k', endpoint: 'http://127.0.0.1:9', consumer: 'sync', maxRetries: 1, _retryBaseMs: 5, timeoutMs: 2000 });
  await assert.rejects(tc.track('a'), (e) => e.code === 'NETWORK');
});

test('events rejected inside a 2xx response raise EVENT_REJECTED with those events', async () => {
  const s = await server(() => [200, { received: 2, accepted: 1, rejected: 1, events: 1, results: [{ index: 1, ok: false, warnings: ['profile_without_person'] }] }]);
  const tc = new TapCub({ apiKey: 'k', endpoint: s.endpoint, flushIntervalMs: 60_000 });
  await tc.track('a');
  await tc.profileSet('u', { a: 1 });
  await assert.rejects(tc.flush(), (e) => e.code === 'EVENT_REJECTED' && e.events.length === 1 && e.events[0].type === 'profile_set');
  await tc.close();
  await s.close();
});

test('queue overflow drops the oldest and reports QUEUE_FULL', async () => {
  const s = await server();
  const tc = new TapCub({ apiKey: 'k', endpoint: s.endpoint, maxQueueSize: 3, maxBatch: 1000, flushIntervalMs: 60_000 });
  for (const e of ['a', 'b', 'c', 'd', 'e']) await tc.track(e);
  await assert.rejects(tc.flush(), (e) => e.code === 'QUEUE_FULL');
  assert.deepEqual(s.reqs[0].body.events.map((e) => e.event), ['c', 'd', 'e']);
  await tc.close();
  await s.close();
});

test('gzip', async () => {
  const s = await server();
  const tc = new TapCub({ apiKey: 'k', endpoint: s.endpoint, consumer: 'sync', gzip: true });
  await tc.track('a');
  assert.equal(s.reqs[0].headers['content-encoding'], 'gzip');
  assert.equal(s.reqs[0].body.events[0].event, 'a');
  await s.close();
});

test('debug consumer uses ?debug=1 and logs each result', async () => {
  const s = await server(() => [200, { debug: true, results: [{ index: 0, ok: true, warnings: ['plaintext_identity_hashed'] }] }]);
  const logs = [];
  const tc = new TapCub({ apiKey: 'k', endpoint: s.endpoint, consumer: 'debug', logger: { warn: (m) => logs.push(m), error: (m) => logs.push(m) } });
  await tc.track('a');
  assert.equal(s.reqs[0].url, '/api/v1/track?debug=1');
  assert.match(logs[0], /#0 ok warnings=plaintext_identity_hashed/);
  await s.close();
});

test('fromRequestHeaders', () => {
  assert.deepEqual(TapCub.fromRequestHeaders({ 'x-tc-device': 'custom:abcd1234', 'x-tc-session': ['s1'] }), { deviceId: 'custom:abcd1234', sessionId: 's1' });
  assert.deepEqual(TapCub.fromRequestHeaders(new Headers({ 'X-Tc-Device': 'custom:abcd1234' })), { deviceId: 'custom:abcd1234', sessionId: undefined });
});
