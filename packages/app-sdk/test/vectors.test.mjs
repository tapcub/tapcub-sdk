import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TapCubCore } from '../src/core/sdk.ts';
import { loadVectors, runVector } from './runner.mjs';

const MP = /\$mp_|mp_uuid|tapcub-mp|mp_weixin|mp_alipay|mp_bytedance|withShareParams|requiredPrivacyApis/;

const vectors = loadVectors().filter((v) => v.suite === 'app' || !MP.test(readFileSync(new URL(`../../shared/test-vectors/sdk/${v.file}`, import.meta.url), 'utf8')));

test('common vector set still ≥ 40 (phase3/01 §11)', () => {
  assert.ok(vectors.length >= 40, `only ${vectors.length} shared vectors`);
});

for (const v of vectors) {
  test(`${v.file}: ${v.name}`, async () => {
    const r = await runVector(v, (adapters) => new TapCubCore(adapters));
    if (r.failures.length) {
      const dump = { items: r.items.map((i) => ({ t: i.t, n: i.n, op: i.op, did: i.did, sid: i.sid, ts: i.ts })), state: r.state, errors: r.errors };
      assert.fail(`${r.failures.join('\n')}\n--- actual ---\n${JSON.stringify(dump, null, 1)}`);
    }
  });
}
