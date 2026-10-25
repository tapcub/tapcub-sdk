# Changelog

All notable changes to this package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## 0.1.1

- `preInit` called after the first Activity is already on screen (Flutter calls it from Dart) now reports the app launch (`$app_start` / `$app_install`) when the current Activity is passed as `context`, instead of waiting for the next resume. Same behaviour as iOS.
- `getConsent`, `shouldPrompt`, `getDeviceId`, `getSessionId`, `getRemoteConfig` and `getState` now see calls made just before them (for example `grantConsent` then `getConsent`), waiting at most 500 ms for queued calls, like the iOS getters.

## 0.1.0

- First release of `com.tapcub:android` (minSdk 21, Kotlin 2.0, Java 8 bytecode) and its pure-JVM core `com.tapcub:core`.
- Same public API as the other App SDKs; activity / fragment screen autotrack, click autotrack, crash capture, startup and frame performance samples.
- Behaviour pinned down by the shared client vectors.
