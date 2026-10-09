import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TapCubCore } from '../src/core/sdk.ts';
import { loadVectors, runVector } from './runner.mjs';

const vectors = loadVectors().filter((v) => v.suite !== 'app');

test('vector set has ≥ 40 cases (phase3/01 §11)', () => {
  assert.ok(vectors.length >= 40, `only ${vectors.length} vectors`);
});

for (const v of vectors) {
  test(`${v.file}: ${v.name}`, async () => {
    const r = await runVector(v, (adapters) => new TapCubCore(adapters));
    if (r.failures.length) {
      const dump = { items: r.items.map((i) => ({ t: i.t, n: i.n, op: i.op, did: i.did, sid: i.sid, c: i.c, ts: i.ts })), state: r.state, errors: r.errors, storageKeys: Object.keys(r.storage) };
      assert.fail(`${r.failures.join('\n')}\n--- actual ---\n${JSON.stringify(dump, null, 1)}`);
    }
  });
}
