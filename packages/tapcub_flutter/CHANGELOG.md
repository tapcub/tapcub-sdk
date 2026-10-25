## 0.2.0

- **Requires Flutter 3.44 / Dart 3.12 or later.** Apps on older Flutter versions keep using 0.1.x.
- iOS: Swift Package Manager support (on by default since Flutter 3.44). With SwiftPM the native TapCub iOS SDK is fetched automatically, so the `pod 'TapCub', :git => …` line in the Podfile is no longer needed. CocoaPods keeps working as before.
- Android: migrated to built-in Kotlin (the `kotlin-android` plugin is no longer applied).
- Android: the plugin passes the current Activity to the native SDK, so the app launch is reported on cold start (`com.tapcub:android` 0.1.1).

## 0.1.1

- API documentation: every public class, field and method now has an English dartdoc comment.
- Added an example (`example/example.md`): startup, named-route screens, events, identity, purchase and consent.
- Code formatted with `dart format`. No behaviour changes; same native SDKs (iOS `TapCub` 0.1.0, Android `com.tapcub:android` 0.1.0).

## 0.1.0

- First release of the Flutter plugin. Dart forwards calls over `MethodChannel('tapcub')` to the native TapCub SDKs (iOS via the `TapCub` pod, Android via `com.tapcub:android`); collection, queueing, consent and crash capture run natively.
- API matches the native and TypeScript cores: `preInit` / `init`, `track`, `trackScreen`, `login` / `logout` / `bind`, user and group properties, super properties, consent (`grantConsent`, `revokeConsent`, `optOut` / `optIn`, `shouldPrompt`), child mode, data region, purchase / push / deep-link / attribution helpers, and consent, session and error listeners.
- `TapCub.navigatorObserver` reports screens for named routes. `autoTrack` and `autoTrackScreens` are off by default because Flutter renders inside a single native view.

## 0.0.1

- Placeholder release to reserve the package name. No code.
