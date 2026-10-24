// 共享一致性向量：packages/shared/test-vectors/track（说明见该目录 README）
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TapCub } from '../src/index.ts';

const dir = new URL('../../../shared/test-vectors/track/', import.meta.url);
assert.ok(existsSync(dir), 'shared vectors not found');
const vectors = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, ...JSON.parse(readFileSync(new URL(f, dir), 'utf8')) }));

/** 向量的 snake_case 参数 → Node API 调用 */
function call(tc, { method, args: a }) {
  const opts = (keys) => Object.fromEntries(keys.filter(([k]) => k in a).map(([k, to]) => [to, a[k]]));
  switch (method) {
    case 'track':
      return tc.track(a.event, opts([['login_id', 'loginId'], ['login_id_type', 'loginIdType'], ['device_id', 'deviceId'], ['session_id', 'sessionId'], ['insert_id', 'insertId'], ['time', 'time'], ['group', 'group'], ['properties', 'properties'], ['context', 'context']]));
    case 'track_signup':
      return tc.trackSignup(a.login_id, opts([['device_id', 'deviceId'], ['session_id', 'sessionId'], ['insert_id', 'insertId'], ['time', 'time'], ['properties', 'properties'], ['invited_by', 'invitedBy'], ['context', 'context']]));
    case 'bind':
      return tc.bind(a.login_id, a.identities);
    case 'unbind':
      return tc.unbind(a.login_id, a.identity_type, a.value);
    case 'profile_set':
      return tc.profileSet(a.login_id, a.properties);
    case 'profile_set_once':
      return tc.profileSetOnce(a.login_id, a.properties);
    case 'profile_increment':
      return tc.profileIncrement(a.login_id, a.increment);
    case 'profile_append':
      return tc.profileAppend(a.login_id, a.append);
    case 'profile_unset':
      return tc.profileUnset(a.login_id, a.keys);
    case 'item_set':
      return tc.itemSet(a.item_type, a.item_id, a.properties);
    case 'item_delete':
      return tc.itemDelete(a.item_type, a.item_id);
    case 'track_update':
      return tc.trackUpdate(a.event, a.insert_id, a.properties);
    case 'track_overwrite':
      return tc.trackOverwrite(a.event, a.insert_id, a.properties);
    case 'group_set':
      return tc.groupSet(a.group_type, a.group_id, a.properties);
    default:
      throw new Error(`unknown method ${method}`);
  }
}

test('vector set is complete', () => assert.ok(vectors.length >= 30, `${vectors.length} vectors`));

for (const v of vectors) {
  test(`vector ${v.file}`, async () => {
    const sent = [];
    const fetch = async (_url, init) => {
      sent.push(JSON.parse(init.body).events);
      return new Response(JSON.stringify({ received: 1, accepted: 1, rejected: 0, events: 1, results: [] }), { status: 200 });
    };
    const tc = new TapCub({ apiKey: 'wck_test', consumer: 'sync', fetch });
    if (v.error) {
      assert.throws(() => call(tc, v.call), TypeError);
      assert.equal(sent.length, 0);
      return;
    }
    await call(tc, v.call);
    assert.equal(sent.length, 1);
    const [ev] = sent[0];
    const expected = structuredClone(v.expected);
    if (expected.time === '$now') {
      assert.ok(Number.isInteger(ev.time) && Math.abs(ev.time - Date.now()) < 60_000, `time ${ev.time}`);
      expected.time = ev.time;
    }
    assert.deepEqual(ev, expected);
  });
}
