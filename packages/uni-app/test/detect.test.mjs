import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectTarget, assertNotH5, createUniTapCub, TapCub } from '../src/index.ts';
import { TapCubCore as AppCore } from '@tapcub/app-sdk';
import { TapCubCore as MpCore } from '@tapcub/miniprogram';
import { createMock, drain } from '../../app-sdk/test/mock.mjs';

test('detectTarget maps uni platforms', () => {
  assert.deepEqual(detectTarget('mp-weixin').flavor, 'mp');
  assert.equal(detectTarget('mp-weixin').platform, 'mp_weixin');
  assert.equal(detectTarget('mp-alipay').platform, 'mp_alipay');
  assert.equal(detectTarget('mp-toutiao').platform, 'mp_bytedance');
  assert.equal(detectTarget('app-plus').flavor, 'app');
  assert.equal(detectTarget('app-ios').platform, 'ios');
  assert.equal(detectTarget('h5').flavor, 'web');
});

test('H5 throws', () => {
  assert.throws(() => assertNotH5(detectTarget('h5')), /w\.js/);
});

test('createUniTapCub picks MpCore vs AppCore', () => {
  const mp = createMock({ platform: 'mp_weixin', cfg: { t: 3, i: 1, cs: { req: false } } });
  // miniprogram mock expects mp platform on device — app-sdk mock uses android by default
  mp.adapters.device.platform = 'mp_weixin';
  const a = createUniTapCub(mp.adapters, 'mp-weixin');
  assert.ok(a.core instanceof MpCore);
  const app = createMock({ platform: 'android', cfg: { t: 3, i: 1, cs: { req: false } } });
  const b = createUniTapCub(app.adapters, 'app-plus');
  assert.ok(b.core instanceof AppCore);
});

test('app-plus track goes through app-sdk', async () => {
  const m = createMock({ platform: 'android', cfg: { t: 3, i: 1, cs: { req: false } } });
  const { core } = TapCub.attach(m.adapters, 'app-plus');
  core.preInit({ siteKey: 'k_vector_site', endpoint: 'https://c.test', appId: 'com.uni' });
  await core.init();
  core.track('purchase', { revenue: 9 });
  core.flush();
  await drain();
  const names = m.net.requests.flatMap((r) => (r.body?.items || []).map((i) => i.n));
  assert.ok(names.includes('purchase'), JSON.stringify(names));
});
