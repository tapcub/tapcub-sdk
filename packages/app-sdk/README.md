# @tapcub/app-sdk

The core shared by the TapCub Android, iOS and HarmonyOS SDKs. Every SDK exposes the same public API; preset events are `$app_*` / `$screen_*`.

```js
import { createTapCub } from '@tapcub/app-sdk';
const tc = createTapCub(adapters);
tc.preInit({ siteKey, appId: 'com.example.app' }); // the collection address is built in
await tc.init();
tc.track('purchase', { revenue: 19.9, currency: 'CNY' });
```

Device ID prefixes: `android_id` / `ios_idfv` / `harmony_odid`. Conformance tests: `pnpm --filter @tapcub/app-sdk test` (shared vectors live in `packages/shared/test-vectors/sdk`). Build: `pnpm --filter @tapcub/app-sdk build` (tsup → `dist`, plus a gzip ≤ 30 KB size check).

The `tapcub-source` condition in `exports` points at `src`. It is only for the uni-app / React Native tests and type checks inside this repository (`node --conditions=tapcub-source`, tsconfig `customConditions`). The published package has no `src`, so regular hosts never match it.

HarmonyOS wrapper: `@tapcub/harmony`. Native SDKs: Android in `packages/android` of this repository, iOS in [tapcub-ios](https://github.com/tapcub/tapcub-ios).
