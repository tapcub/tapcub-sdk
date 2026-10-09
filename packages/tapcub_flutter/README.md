# tapcub_flutter

`flutter pub add tapcub_flutter`

TapCub analytics for Flutter. Dart only boxes calls over `MethodChannel('tapcub')`; the iOS / Android plugins forward them to the native `TapCub` SDK (iOS: [tapcub-ios](https://github.com/tapcub/tapcub-ios), Android: `packages/android` in [tapcub-sdk](https://github.com/tapcub/tapcub-sdk)). Collection, queueing, consent and crash capture all run in the native SDK.

```dart
await TapCub.preInit(const TapCubConfig(siteKey: 's_xxx'));
await TapCub.init();   // after the user consents; returns once native init is done
MaterialApp(navigatorObservers: [TapCub.navigatorObserver]);

TapCub.track('checkout', {'amount': 99.0});
TapCub.login('u_123');
TapCub.onSessionStart((sid, reason) => debugPrint('session $sid ($reason)'));
```

Method names and parameters match the native and TypeScript cores; see `lib/tapcub_flutter.dart` for the full list.

- Flutter draws every page inside a single native view, so `autoTrack` and `autoTrackScreens` are off by default: screens come from `navigatorObserver` (only routes with a `settings.name`) or `trackScreen`, and taps from `track`.
- Native crashes, launch time and performance sampling work as usual. Report Dart exceptions yourself with `track` from `FlutterError.onError` / `PlatformDispatcher.instance.onError`.
- Android depends on `com.tapcub:android`. Until the SDK is on Maven Central, run `./gradlew publishToMavenLocal` in `packages/android` of [tapcub-sdk](https://github.com/tapcub/tapcub-sdk) first. iOS depends on the `TapCub` pod.
