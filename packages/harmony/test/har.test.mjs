import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { sim, mockContext } from './kit-mocks.mjs';

const { DeviceStorage } = await import('../src/main/sdk/Storage.ts');
const { SystemDevice, languageTag } = await import('../src/main/sdk/Device.ts');
const { toCrashEvent } = await import('../src/main/sdk/Crash.ts');
const { TapCub } = await import('../src/main/sdk/TapCub.ts');

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

beforeEach(() => sim.reset());

test('queue chunks go to files, small keys to Preferences, did removal rotates', () => {
  const s = new DeviceStorage(mockContext);
  s.set('tc_q0', '[1,2]');
  s.set('tc_sp', '{"a":1}');
  assert.equal(sim.files.get('/data/app/files/tapcub_queue/tc_q0'), '[1,2]');
  assert.equal(sim.prefs.get('tapcub_sdk').get('tc_sp'), '{"a":1}');
  assert.equal(s.get('tc_q0'), '[1,2]');
  assert.equal(s.get('missing'), null);
  s.remove('tc_q0');
  assert.equal(s.get('tc_q0'), null);

  const d = new SystemDevice(s);
  assert.equal(d.deviceId(), 'harmony_odid:A1B2C3D4-0000-4000-8000-1234567890AB');
  s.set('tc_did', 'harmony_odid:A1B2C3D4-0000-4000-8000-1234567890AB');
  s.remove('tc_did');
  assert.equal(s.didRotated, true);
  assert.equal(d.deviceId(), null, 'after reset the core generates a new id instead of reusing the ODID');
});

test('device snapshot and locale', async () => {
  const d = new SystemDevice(new DeviceStorage(mockContext));
  const snap = d.read();
  assert.equal(snap.os, 'HarmonyOS');
  assert.equal(snap.osVersion, '5.0.0');
  assert.equal(snap.model, 'ALN-AL00');
  assert.equal(snap.screenWidth, 1260);
  assert.equal(snap.screenHeight, 2720);
  assert.equal(snap.locale, 'zh-CN');
  assert.equal(snap.timezone, 'Asia/Shanghai');
  assert.equal(await d.networkType(), 'wifi');
  assert.equal(languageTag('zh-Hant'), 'zh-TW');
  assert.equal(languageTag('en_US'), 'en-US');
  assert.equal(languageTag(''), 'und');
  sim.device.ODID = '00000000-0000-0000-0000-000000000000';
  assert.equal(d.deviceId(), null, 'all-zero ODID is treated as missing');
});

test('hiAppEvent crash and freeze records map to CrashEvent with the original time', () => {
  const js = toCrashEvent('APP_CRASH', {
    time: 1699999000000,
    crash_type: 'JsError',
    foreground: true,
    exception: { name: 'TypeError', message: 'x is undefined', stack: 'at onClick (pages/Index.ets:12:5)' },
  });
  assert.deepEqual(js, { kind: 'crash', type: 'TypeError', message: 'x is undefined', stack: 'at onClick (pages/Index.ets:12:5)', fatal: true, foreground: true, ts: 1699999000000 });

  const native = toCrashEvent('APP_CRASH', {
    time: 1699999100000,
    crash_type: 'NativeCrash',
    exception: { signal: { signo: 11 }, frames: [{ file: '/system/lib64/libc.so', pc: '000000000009a3c4', symbol: 'abort' }, { file: 'libentry.so', pc: '1f20' }] },
  });
  assert.equal(native.type, 'SIG11');
  assert.equal(native.stack, '/system/lib64/libc.so+0x000000000009a3c4 abort\nlibentry.so+0x1f20');

  const freeze = toCrashEvent('APP_FREEZE', { time: 1699999200000, exception: { name: 'THREAD_BLOCK_6S', message: 'main thread blocked' } });
  assert.equal(freeze.kind, 'anr');
  assert.equal(freeze.type, 'THREAD_BLOCK_6S');
  assert.equal(toCrashEvent('OTHER', {}), null);
});

test('end to end: launch, pages, clicks, crash on next launch, all posted with harmony presets', async () => {
  TapCub.preInit(mockContext, { siteKey: 's_test', endpoint: 'https://c.example.com' });
  assert.equal(sim.requests.length, 0, 'preInit must not touch the network');

  for (const cb of sim.appCallbacks.abilityLifecycle) cb.onAbilityCreate({ context: mockContext, launchWant: { uri: 'demo://open/item/7' } });
  for (const cb of sim.appCallbacks.abilityLifecycle) cb.onAbilityForeground({});
  for (const cb of sim.observers.routerPageUpdate) cb({ index: 1, name: 'Index', path: 'pages/Index', state: 2 });

  const watcher = sim.watchers.get('tapcub_crash_watcher');
  assert.ok(watcher, 'crash watcher registered at preInit');
  watcher.onReceive('OS', [{ name: 'APP_CRASH', appEventInfos: [{ domain: 'OS', name: 'APP_CRASH', params: { time: 1699999000000, crash_type: 'JsError', exception: { name: 'Error', message: 'boom', stack: 'at a' } } }] }]);

  await TapCub.init();
  TapCub.grantConsent(['analytics']);
  TapCub.trackClick('buy', '立即购买');
  for (const cb of sim.observers.navDestinationUpdate) cb({ navigationId: 'nav', name: 'Detail', state: 0 });
  TapCub.track('checkout', { amount: 99 });
  TapCub.flush();
  await settle();

  const posts = sim.requests.filter((r) => r.method === 'POST');
  assert.ok(posts.length > 0, `no POST; requests: ${sim.requests.map((r) => `${r.method} ${r.url}`).join(', ')}`);
  assert.ok(posts.every((r) => r.url === 'https://c.example.com/api/v1/pulse'));
  const events = posts.flatMap((r) => JSON.parse(r.body).items);
  const names = events.map((e) => e.n);
  for (const n of ['$app_install', '$app_start', '$screen_view', '$app_crashed', '$app_click', 'checkout']) {
    assert.ok(names.includes(n), `missing ${n} in ${names.join(',')}`);
  }
  const start = events.find((e) => e.n === '$app_start');
  assert.equal(start.p.$duration_ms, 820);
  const checkout = events.find((e) => e.n === 'checkout');
  assert.equal(checkout.pt, 'harmony');
  assert.equal(checkout.lib, 'tapcub-harmony/0.1.0');
  assert.equal(checkout.did, 'harmony_odid:A1B2C3D4-0000-4000-8000-1234567890AB');
  assert.equal(checkout.p.$os, 'HarmonyOS');
  assert.equal(checkout.p.$app_version, '1.4.0');
  const crash = events.find((e) => e.n === '$app_crashed');
  assert.equal(crash.ts, 1699999000000);
  const click = events.find((e) => e.n === '$app_click');
  assert.equal(click.p.$element_id, 'buy');
  const screens = events.filter((e) => e.n === '$screen_view').map((e) => e.p.$screen_name);
  assert.deepEqual(screens, ['Index', 'Detail']);
  TapCub.stop();
});
