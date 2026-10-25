# tapcub_flutter example

Initialize TapCub at startup, report named routes as screens, and record events, identity and consent.

```dart
import 'package:flutter/material.dart';
import 'package:tapcub_flutter/tapcub_flutter.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Stores the configuration only: no collection, no device reads, no network.
  await TapCub.preInit(const TapCubConfig(siteKey: 'YOUR_SITE_KEY'));

  // Start collecting. If your app needs consent first, call this after the
  // user accepts your privacy policy, together with TapCub.grantConsent.
  await TapCub.init();

  runApp(const ShopApp());
}

class ShopApp extends StatelessWidget {
  const ShopApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      // Named routes are reported as screens.
      navigatorObservers: [TapCub.navigatorObserver],
      routes: {
        '/': (_) => const HomePage(),
        '/checkout': (_) => const CheckoutPage(),
      },
    );
  }
}

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ElevatedButton(
          onPressed: () async {
            await TapCub.track('add_to_cart', {'sku': 'sku-1', 'price': 19.9});
            if (context.mounted) Navigator.pushNamed(context, '/checkout');
          },
          child: const Text('Add to cart'),
        ),
      ),
    );
  }
}

class CheckoutPage extends StatelessWidget {
  const CheckoutPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ElevatedButton(
          onPressed: () async {
            // Identify the user after sign-in; profile properties follow.
            await TapCub.login('user-1');
            await TapCub.setProps({'plan': 'pro'});
            await TapCub.trackPurchase({
              'revenue': 19.9,
              'currency': 'USD',
              'order_id': 'order-1',
            });
          },
          child: const Text('Pay'),
        ),
      ),
    );
  }
}
```

## Consent

```dart
// Projects that require consent: collection waits until this call.
await TapCub.grantConsent(['analytics']);

// Withdraw consent: the device ID and queued events are dropped.
await TapCub.revokeConsent();
```

## Native setup

- **iOS**: with Swift Package Manager (the default since Flutter 3.44) there is nothing to add. With CocoaPods, add `pod 'TapCub', :git => 'https://github.com/tapcub/tapcub-ios.git', :tag => '0.1.0'` to `ios/Podfile`, then run `pod install`.
- **Android**: nothing to add; `com.tapcub:android` comes from Maven Central.
