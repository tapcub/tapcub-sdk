import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as root from '../src/index.ts';
import * as mp from '../src/mp.ts';
import * as app from '../src/app.ts';
import { TapCubCore as AppCore } from '@tapcub/app-sdk';
import { TapCubCore as MpCore } from '@tapcub/miniprogram';
import { createMock } from '../../app-sdk/test/mock.mjs';

test('all three entries import', () => {
  assert.equal(typeof root.TapCub.preInit, 'function');
  assert.equal(root.default, root.TapCub);
  for (const m of [mp, app]) {
    assert.equal(typeof m.createTapCub, 'function');
    assert.equal(m.default, m.createTapCub);
    assert.equal(typeof m.TapCubCore, 'function');
    assert.match(m.LIB_VERSION, /^\d+\.\d+\.\d+$/);
  }
  assert.equal(typeof mp.mpAdapters, 'function');
});

test('sub-entry factories build the matching core', () => {
  const a = createMock({ platform: 'android' });
  assert.ok(app.default(a.adapters) instanceof AppCore);
  const m = createMock({ platform: 'mp_weixin' });
  m.adapters.device.platform = 'mp_weixin';
  assert.ok(mp.default(m.adapters) instanceof MpCore);
});
