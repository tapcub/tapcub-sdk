import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, '..', rel), 'utf8');
const dart = read('lib/tapcub_flutter.dart');
const ios = read('ios/tapcub_flutter/Sources/tapcub_flutter/TapCubFlutterPlugin.swift');
const and = read('android/src/main/kotlin/com/tapcub/flutter/TapCubFlutterPlugin.kt');

// Same names as packages/app-sdk TapCubCore (requiredPrivacyApis is answered in Dart).
const METHODS = [
  'preInit', 'init', 'track', 'trackScreen', 'flush',
  'login', 'logout', 'bind', 'setProps', 'setPropsOnce', 'unsetProps', 'setGroup', 'reset', 'anonymize',
  'grantConsent', 'revokeConsent', 'getConsent', 'optOut', 'optIn', 'setRestricted', 'setChildMode',
  'setDataRegion', 'shouldPrompt', 'stop', 'start',
  'registerSuperProps', 'unregisterSuperProp', 'trackPurchase', 'trackPushClick', 'setAttribution', 'trackDeeplink',
  'getDeviceId', 'getSessionId', 'getRemoteConfig',
];
const EVENTS = ['onConsentChange', 'onSessionStart', 'onError'];

test('Dart forwards every core method over MethodChannel tapcub', () => {
  assert.ok(dart.includes("MethodChannel('tapcub')"));
  for (const m of METHODS) assert.ok(dart.includes(`invokeMethod('${m}'`) || dart.includes(`invokeMethod<int>('${m}'`) || dart.includes(`invokeMethod<bool>('${m}'`) || dart.includes(`invokeMethod<String>('${m}'`) || dart.includes(`invokeMethod<Map>('${m}'`), `dart missing ${m}`);
  for (const e of EVENTS) assert.ok(dart.includes(`'${e}'`), `dart missing listener ${e}`);
  assert.ok(dart.includes('TapCubNavigatorObserver'));
});

test('Flutter turns off native auto screens and clicks by default', () => {
  assert.match(dart, /this\.autoTrack = false/);
  assert.match(dart, /this\.autoTrackScreens = false/);
});

test('native plugins handle every method and emit listener events', () => {
  for (const m of METHODS) {
    assert.ok(ios.includes(`case "${m}"`), `ios missing ${m}`);
    assert.ok(and.includes(`"${m}" ->`), `android missing ${m}`);
  }
  for (const e of EVENTS) {
    assert.ok(ios.includes(`"${e}"`), `ios missing emit ${e}`);
    assert.ok(and.includes(`"${e}"`), `android missing emit ${e}`);
  }
  assert.ok(ios.includes('TapCubConfig(json:'));
  assert.ok(and.includes('TapCubConfig.fromJson('));
  assert.ok(ios.includes('TapCub.initialize {'), 'ios init must complete the Future from the native callback');
  assert.ok(and.includes('TapCub.init {'), 'android init must complete the Future from the native callback');
});
