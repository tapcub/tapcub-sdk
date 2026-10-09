## 0.1.0

- First release of the Flutter plugin. Dart forwards calls over `MethodChannel('tapcub')` to the native TapCub SDKs (iOS via the `TapCub` pod, Android via `com.tapcub:android`); collection, queueing, consent and crash capture run natively.
- API matches the native and TypeScript cores: `preInit` / `init`, `track`, `trackScreen`, `login` / `logout` / `bind`, user and group properties, super properties, consent (`grantConsent`, `revokeConsent`, `optOut` / `optIn`, `shouldPrompt`), child mode, data region, purchase / push / deep-link / attribution helpers, and consent, session and error listeners.
- `TapCub.navigatorObserver` reports screens for named routes. `autoTrack` and `autoTrackScreens` are off by default because Flutter renders inside a single native view.

## 0.0.1

- Placeholder release to reserve the package name. No code.
