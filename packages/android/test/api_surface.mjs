import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel) => readFileSync(join(root, rel), 'utf8');
const CORE = 'core/src/main/kotlin/com/tapcub/core';
const SDK = 'sdk/src/main/java/com/tapcub';

const FACADE = [
  'preInit',
  'init',
  'track',
  'trackScreen',
  'flush',
  'login',
  'logout',
  'bind',
  'setProps',
  'setPropsOnce',
  'unsetProps',
  'setGroup',
  'reset',
  'anonymize',
  'grantConsent',
  'revokeConsent',
  'getConsent',
  'optOut',
  'optIn',
  'setRestricted',
  'setChildMode',
  'setDataRegion',
  'shouldPrompt',
  'stop',
  'start',
  'registerSuperProps',
  'unregisterSuperProp',
  'trackPurchase',
  'trackPushClick',
  'setAttribution',
  'getDeviceId',
  'getSessionId',
  'getRemoteConfig',
  'reportException',
  'onConsentChange',
  'onSessionStart',
  'onError',
  'ignoreScreen',
  'setElementId',
  'ignoreView',
];

test('core is a pure JVM module, sdk holds the Android adapters', () => {
  for (const f of ['Json.kt', 'Types.kt', 'Util.kt', 'Queue.kt', 'Core.kt']) {
    assert.ok(existsSync(join(root, CORE, f)), `missing core/${f}`);
  }
  for (const f of [
    'TapCub.kt',
    'Brand.kt',
    'Worker.kt',
    'Storage.kt',
    'Transport.kt',
    'Device.kt',
    'Lifecycle.kt',
    'AutoTrack.kt',
    'WindowCallbackWrapper.kt',
    'Crash.kt',
    'Perf.kt',
  ]) {
    assert.ok(existsSync(join(root, SDK, f)), `missing sdk/${f}`);
  }
  for (const f of ['Json.kt', 'Types.kt', 'Util.kt', 'Queue.kt', 'Core.kt']) {
    assert.doesNotMatch(src(`${CORE}/${f}`), /^import android\./m, `core/${f} must not import android.*`);
  }
  assert.ok(existsSync(join(root, 'core/src/test/kotlin/com/tapcub/core/VectorTest.kt')));
});

test('facade exposes the phase3/01 surface as @JvmStatic', () => {
  const kt = src(`${SDK}/TapCub.kt`);
  assert.match(kt, /^object TapCub/m);
  for (const m of FACADE) assert.match(kt, new RegExp(`fun ${m}\\(`), `missing TapCub.${m}`);
  const statics = kt.match(/@JvmStatic/g) || [];
  assert.ok(statics.length >= FACADE.length, `only ${statics.length} @JvmStatic`);
});

test('core keeps the shared contract markers', () => {
  const core = src(`${CORE}/Core.kt`);
  for (const s of ['android_id', 'ios_idfv', 'harmony_odid', 'tc_end_pending', '"tapcub-android"', '$app_install', '$app_start', '$app_crashed', '$resume_from_background']) {
    assert.ok(core.includes(s) || core.includes(s.replace('$', '\\$')), `core lost ${s}`);
  }
});

test('brand strings live in Brand.kt, core storage keys are tc_*', () => {
  const brand = src(`${SDK}/Brand.kt`);
  assert.match(brand, /PREFS\s*=\s*"tapcub_sdk"/);
  assert.match(brand, /WORKER_THREAD\s*=\s*"tapcub-worker"/);
  for (const f of ['Storage.kt', 'Worker.kt', 'Transport.kt', 'Crash.kt']) {
    const code = src(`${SDK}/${f}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /"tapcub_sdk|"tapcub-worker"|"tapcub-net"/, `${f} hardcodes a brand string`);
  }
});

test('privacy: no IMEI / MAC / advertising id, INTERNET only', () => {
  const all = ['Device.kt', 'Storage.kt', 'TapCub.kt'].map((f) => src(`${SDK}/${f}`)).join('\n');
  assert.doesNotMatch(all, /getImei|getDeviceId\(\)\s*\/\/\s*imei|getMacAddress|AdvertisingIdClient|OAID/);
  const manifest = src('sdk/src/main/AndroidManifest.xml');
  const perms = [...manifest.matchAll(/uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(perms, ['android.permission.INTERNET']);
});

test('consumer ProGuard keeps the public API and screen annotation', () => {
  const pro = src('sdk/consumer-rules.pro');
  assert.match(pro, /com\.tapcub\.TapCub/);
  assert.match(pro, /TapCubScreen/);
  assert.match(pro, /RuntimeVisibleAnnotations/);
  assert.match(src('sdk/build.gradle.kts'), /consumerProguardFiles/);
});
