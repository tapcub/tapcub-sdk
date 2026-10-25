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
## Native SDKs

Requires Flutter 3.44 or later (Dart 3.12). Apps on older Flutter versions can use `tapcub_flutter: ^0.1.0`.

- **iOS, Swift Package Manager** (the default since Flutter 3.44): nothing to add. The plugin's `Package.swift` pulls the native TapCub iOS SDK from [tapcub-ios](https://github.com/tapcub/tapcub-ios).
- **iOS, CocoaPods** (projects that turned Swift Package Manager off): the `TapCub` pod is not on the CocoaPods trunk, so add it to `ios/Podfile` inside `target 'Runner' do`, then run `pod install`:

  ```ruby
  pod 'TapCub', :git => 'https://github.com/tapcub/tapcub-ios.git', :tag => '0.1.0'
  ```

- **Android** depends on `com.tapcub:android` from Maven Central; no extra setup. The plugin uses built-in Kotlin.
