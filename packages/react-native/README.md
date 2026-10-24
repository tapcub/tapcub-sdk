# @tapcub/react-native

TapCub for React Native. Runs the `@tapcub/app-sdk` core directly in JS (AsyncStorage + fetch), with no dependency on the native SDKs. Screen events come from a React Navigation hook.

## Setup

```tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Dimensions, NativeModules, Platform } from 'react-native';
import { TapCub, hydrateRnStorage, createRnStorage, rnAdapters } from '@tapcub/react-native';

const host = { asyncStorage: AsyncStorage, appState: AppState, dimensions: Dimensions, platform: Platform, nativeCrash: NativeModules.TapCubCrash };
const seed = await hydrateRnStorage(host);
TapCub.attach(rnAdapters(host, { storage: createRnStorage(host, seed) }));
TapCub.preInit({ siteKey: 's_xxx' });
await TapCub.init();

<NavigationContainer onStateChange={TapCub.navigationHook}>
```

`TapCub.track / login / setProps / grantConsent / …` have the same names as on every other platform.

## Optional: native crashes

The JS core only sees JS exceptions. If the host also installs the native SDK, this package's native module `TapCubCrash` hands crashes, ANRs (Android 11+) and freezes (iOS) recorded by the native SDK to the JS core on the next launch, keeping the original crash time.

1. Android: add `implementation 'com.tapcub:android:0.1.0'` to `android/app/build.gradle`, and call `TapCubCrash.install(this)` in `Application.onCreate` (optional, but crashes during startup are missed without it). The module is registered through autolinking.
2. iOS: the `TapCub` pod is not on the CocoaPods trunk, so add it to `ios/Podfile` (inside the app target) before `pod install`, then call `[TapCubCrash install]` in `didFinishLaunchingWithOptions:`.

   ```ruby
   pod 'TapCub', :git => 'https://github.com/tapcub/tapcub-ios.git', :tag => '0.1.0'
   ```

   Autolinking adds this package's pod to every iOS build, and that pod depends on `TapCub`, so the Podfile line is needed even if you skip native crashes.
3. JS: `host.nativeCrash = NativeModules.TapCubCrash`. Without the native module it is `undefined` and everything else still works.

Do not also call `TapCub.preInit` on the native side: that starts a second native core and events are sent twice.

## Development

```bash
pnpm test     # node --test, JS-side behavior (including native crash forwarding); --conditions=tapcub-source resolves @tapcub/app-sdk from src
pnpm build    # tsup → dist: index.js (CJS, main / "react-native" field), index.mjs (ESM), index.d.ts
```

Published files: `dist`, `android/`, `ios/`, `tapcub-react-native.podspec`, `react-native.config.js`, README. `@tapcub/app-sdk` is a dependency and is not bundled.
The package does not declare `"type": "module"` because the RN CLI loads `react-native.config.js` with CommonJS `require`; `src/package.json` only makes Node treat the sources as ESM in tests.
Publish with `pnpm publish` (it replaces `workspace:^` with real version numbers), not `npm publish`.

The native modules under `android/` and `ios/` are a few dozen lines each, depend on the host's React Native and the native SDK, and are compiled in an example app.
