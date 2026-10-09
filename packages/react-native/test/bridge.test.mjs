import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TapCub, activeRouteName } from '../src/index.ts';
import { TapCubCore } from '@tapcub/app-sdk';
import { createMock, drain } from '../../app-sdk/test/mock.mjs';

test('activeRouteName walks nested navigation state', () => {
  assert.equal(activeRouteName({ index: 0, routes: [{ name: 'Home' }] }), 'Home');
  assert.equal(
    activeRouteName({
      index: 1,
      routes: [
        { name: 'Tabs' },
        { name: 'Tabs', state: { index: 0, routes: [{ name: 'Goods' }] } },
      ],
    }),
    'Goods',
  );
});

test('navigationHook de-dupes same route and forwards trackScreen', async () => {
  const m = createMock({ cfg: { t: 3, i: 1, cs: { req: false } }, platform: 'android' });
  TapCub.attach(m.adapters);
  TapCub.preInit({ siteKey: 'k_vector_site', endpoint: 'https://c.test', appId: 'com.rn' });
  await TapCub.init();
  await drain();
  TapCub.navigationHook({ index: 0, routes: [{ name: 'Home' }] });
  TapCub.navigationHook({ index: 0, routes: [{ name: 'Home' }] });
  TapCub.navigationHook({ index: 0, routes: [{ name: 'Detail' }] });
  TapCub.flush();
  await drain();
  const names = m.net.requests.flatMap((r) => (r.body?.items || []).map((i) => i.n));
  const screens = names.filter((n) => n === '$screen_view');
  assert.equal(screens.length, 2, `screens=${JSON.stringify(names)}`);
});

test('track / login forward to core and collect', async () => {
  const m = createMock({ cfg: { t: 3, i: 1, cs: { req: false } }, platform: 'ios' });
  const core = TapCub.attach(m.adapters);
  assert.ok(core instanceof TapCubCore);
  TapCub.preInit({ siteKey: 'k_vector_site', endpoint: 'https://c.test', appId: 'com.rn' });
  await TapCub.init();
  TapCub.login('u1');
  TapCub.track('purchase', { revenue: 1 });
  TapCub.flush();
  await drain();
  const names = m.net.requests.flatMap((r) => (r.body?.items || []).map((i) => (i.t === 'id' ? `id:${i.op}` : i.n)));
  assert.ok(names.includes('id:login'), JSON.stringify(names));
  assert.ok(names.includes('purchase'), JSON.stringify(names));
  assert.match(TapCub.getDeviceId() || '', /^ios_idfv:/);
});

test('native crash module records are drained once and reported with the original time', async () => {
  const { nativeCrashHook, toCrashEvent } = await import('../src/native-crash.ts');
  assert.equal(nativeCrashHook(null), undefined);
  assert.equal(toCrashEvent({ kind: 'nope' }), null);
  let drains = 0;
  const mod = {
    drain: async () => {
      drains++;
      return [
        { kind: 'crash', type: 'NullPointerException', message: 'npe', stack: 'at a.b(C.kt:1)', ts: 1699999000000, foreground: true },
        { kind: 'anr', type: 'ANR', message: 'Input dispatching timed out', ts: 1699999100000 },
      ];
    },
  };
  const m = createMock({ cfg: { t: 3, i: 1, cs: { req: false } }, platform: 'android' });
  TapCub.attach({ ...m.adapters, crash: nativeCrashHook(mod) });
  TapCub.preInit({ siteKey: 'k_vector_site', endpoint: 'https://c.test', appId: 'com.rn' });
  await TapCub.init();
  await drain();
  TapCub.flush();
  await drain();
  const items = m.net.requests.flatMap((r) => r.body?.items || []);
  const crash = items.find((i) => i.n === '$app_crashed');
  const anr = items.find((i) => i.n === '$anr');
  assert.ok(crash, JSON.stringify(items.map((i) => i.n)));
  assert.equal(crash.ts, 1699999000000);
  assert.equal(crash.p.$exception_type, 'NullPointerException');
  assert.ok(anr);
  assert.equal(drains, 1);
});

test('hydrateRnStorage follows the queue index to load chunks', async () => {
  const { hydrateRnStorage } = await import('../src/adapters.ts');
  const store = new Map([
    ['tc_did', 'android_id:abcdef1234'],
    ['tc_q_i', JSON.stringify({ f: 3, l: 4 })],
    ['tc_q_3', '[{"n":"a"}]'],
    ['tc_q_4', '[{"n":"b"}]'],
    ['tc_q_9', 'stale'],
  ]);
  const asyncStorage = { getItem: async (k) => store.get(k) ?? null, setItem: async () => undefined, removeItem: async () => undefined };
  const seed = await hydrateRnStorage({ asyncStorage });
  assert.equal(seed.tc_did, 'android_id:abcdef1234');
  assert.equal(seed.tc_q_3, '[{"n":"a"}]');
  assert.equal(seed.tc_q_4, '[{"n":"b"}]');
  assert.equal(seed.tc_q_9, undefined);
});
