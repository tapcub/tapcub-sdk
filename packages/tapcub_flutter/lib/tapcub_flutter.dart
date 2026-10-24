/// TapCub analytics for Flutter.
///
/// A thin bridge over `MethodChannel('tapcub')`: every call is forwarded to the
/// native TapCub iOS and Android SDKs, which do the collection, queueing,
/// consent handling and crash capture.
///
/// ```dart
/// await TapCub.preInit(const TapCubConfig(siteKey: 'YOUR_SITE_KEY'));
/// await TapCub.init();
/// await TapCub.track('purchase', {'revenue': 19.9, 'currency': 'USD'});
/// ```
library tapcub_flutter;

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// Configuration passed to [TapCub.preInit].
///
/// Field names match the native SDKs; a `null` field keeps the native default.
///
/// Flutter draws every page inside one native view, so the native screen and
/// click autotracking cannot see Dart widgets. Both are off by default: report
/// screens with [TapCub.navigatorObserver] or [TapCub.trackScreen], and taps
/// with [TapCub.track].
class TapCubConfig {
  /// Creates a configuration. Only [siteKey] is required.
  const TapCubConfig({
    required this.siteKey,
    this.endpoint,
    this.endpoints,
    this.appId,
    this.region,
    this.autoTrack = false,
    this.autoTrackScreens = false,
    this.crashReport,
    this.perf,
    this.sessionTimeoutSec,
    this.requireConsent,
    this.holdUntilIdentified,
    this.debug,
    this.deviceId,
    this.appVersion,
    this.rejectCooldownDays,
  });

  /// The project's site key, shown in the TapCub console.
  final String siteKey;

  /// Leave unset: the TapCub collection address is built in. Set it only
  /// when TapCub gives you a dedicated address (private deployment).
  final String? endpoint;

  /// Ordered list of collection addresses; the SDK falls back to the next one
  /// after repeated failures. Leave unset unless TapCub gives you a list.
  final List<String>? endpoints;

  /// App identifier registered in the console. Defaults to the bundle ID /
  /// application ID.
  final String? appId;

  /// Data region: `auto`, `eu`, `us` or `cn`. `cn` enables China mode (no
  /// network and no device reads before consent).
  final String? region;

  /// Native click autotracking. Off by default (see the class docs).
  final bool autoTrack;

  /// Native screen autotracking. Off by default (see the class docs).
  final bool autoTrackScreens;

  /// Capture native crashes. Defaults to on in the native SDKs.
  final bool? crashReport;

  /// Collect launch time and performance samples.
  final bool? perf;

  /// Seconds in the background before a new session starts.
  final int? sessionTimeoutSec;

  /// Hold collection until [TapCub.grantConsent] even if the project does
  /// not require consent.
  final bool? requireConsent;

  /// Briefly hold events after launch so they can carry the login ID set by
  /// an early [TapCub.login].
  final bool? holdUntilIdentified;

  /// Log SDK activity to the native console.
  final bool? debug;

  /// Use your own device ID instead of the native one.
  final String? deviceId;

  /// Override the app version reported with events.
  final String? appVersion;

  /// Days to wait before [TapCub.shouldPrompt] returns `true` again after the
  /// user rejected consent (China mode).
  final int? rejectCooldownDays;

  /// The configuration as the map sent over the method channel, without
  /// `null` fields.
  Map<String, Object?> toMap() {
    final m = <String, Object?>{
      'siteKey': siteKey,
      'endpoint': endpoint,
      'endpoints': endpoints,
      'appId': appId,
      'region': region,
      'autoTrack': autoTrack,
      'autoTrackScreens': autoTrackScreens,
      'crashReport': crashReport,
      'perf': perf,
      'sessionTimeoutSec': sessionTimeoutSec,
      'requireConsent': requireConsent,
      'holdUntilIdentified': holdUntilIdentified,
      'debug': debug,
      'deviceId': deviceId,
      'appVersion': appVersion,
      'rejectCooldownDays': rejectCooldownDays,
    };
    m.removeWhere((_, v) => v == null);
    return m;
  }
}

/// Called when the consent state changes; [bits] is the purpose bit mask
/// (see [TapCub.getConsent]).
typedef TapCubConsentListener = void Function(int bits);

/// Called when a new session starts, with its ID and the reason (`launch`,
/// `timeout`, `login`, ...).
typedef TapCubSessionListener = void Function(String sessionId, String reason);

/// Called when the native SDK reports an internal error.
typedef TapCubErrorListener = void Function(String code, String message);

/// The TapCub API. All members are static.
///
/// Call [preInit] early (it only stores the configuration), then [init] once
/// the user has accepted your privacy policy, if your app needs consent.
class TapCub {
  TapCub._();

  /// The method channel shared with the native plugins.
  static const MethodChannel channel = MethodChannel('tapcub');

  /// Add to `MaterialApp.navigatorObservers` to report named routes as
  /// screens.
  static final TapCubNavigatorObserver navigatorObserver =
      TapCubNavigatorObserver();

  static final List<TapCubConsentListener> _consent = [];
  static final List<TapCubSessionListener> _session = [];
  static final List<TapCubErrorListener> _error = [];
  static bool _listening = false;

  static void _listen() {
    if (_listening) return;
    _listening = true;
    channel.setMethodCallHandler((call) async {
      final a = call.arguments;
      switch (call.method) {
        case 'onConsentChange':
          for (final f in List.of(_consent)) {
            f(a as int);
          }
        case 'onSessionStart':
          final m = Map<String, Object?>.from(a as Map);
          for (final f in List.of(_session)) {
            f(m['sessionId'] as String, m['reason'] as String);
          }
        case 'onError':
          final m = Map<String, Object?>.from(a as Map);
          for (final f in List.of(_error)) {
            f(m['code'] as String, m['message'] as String);
          }
      }
      return null;
    });
  }

  // ---- lifecycle ----

  /// Stores the configuration and hooks the app lifecycle. Collects nothing,
  /// reads no device information and makes no network request.
  static Future<void> preInit(TapCubConfig config) {
    _listen();
    return channel.invokeMethod('preInit', config.toMap());
  }

  /// Loads the remote configuration and starts collecting. Completes when the
  /// native SDK is initialized.
  static Future<void> init() => channel.invokeMethod('init');

  // ---- collection ----

  /// Records a custom event with optional properties.
  static Future<void> track(String name, [Map<String, Object?>? props]) =>
      channel.invokeMethod('track', {'name': name, 'props': props});

  /// Records a screen view.
  static Future<void> trackScreen(String name, [Map<String, Object?>? props]) =>
      channel.invokeMethod('trackScreen', {'name': name, 'props': props});

  /// Sends queued events now.
  static Future<void> flush() => channel.invokeMethod('flush');

  // ---- identity ----

  /// Identifies the user. [type] is `login`, `email`, `mobile`, `unionid`,
  /// `openid` or `custom`; email and mobile values are hashed on the device.
  static Future<void> login(
    String id, {
    Map<String, Object?>? props,
    String type = 'login',
  }) => channel.invokeMethod('login', {'id': id, 'props': props, 'type': type});

  /// Ends the login session; later events are anonymous.
  static Future<void> logout() => channel.invokeMethod('logout');

  /// Attaches more identities (email, mobile, unionid, ...) to the user.
  static Future<void> bind(Map<String, String> ids) =>
      channel.invokeMethod('bind', ids);

  /// Sets user profile properties.
  static Future<void> setProps(Map<String, Object?> props) =>
      channel.invokeMethod('setProps', props);

  /// Sets user profile properties that are not set yet.
  static Future<void> setPropsOnce(Map<String, Object?> props) =>
      channel.invokeMethod('setPropsOnce', props);

  /// Removes user profile properties.
  static Future<void> unsetProps(List<String> keys) =>
      channel.invokeMethod('unsetProps', keys);

  /// Puts later events in an account (group) such as a company; `null` [id]
  /// clears the group of that [type].
  static Future<void> setGroup(
    String type,
    String? id, [
    Map<String, Object?>? traits,
  ]) => channel.invokeMethod('setGroup', {
    'type': type,
    'id': id,
    'traits': traits,
  });

  /// Logs out and rotates the device ID and session.
  static Future<void> reset() => channel.invokeMethod('reset');

  /// Drops the stored identity and continues anonymously.
  static Future<void> anonymize() => channel.invokeMethod('anonymize');

  // ---- consent ----

  /// Grants consent for the given purposes: `analytics`, `functional`,
  /// `marketing`.
  static Future<void> grantConsent(List<String> purposes) =>
      channel.invokeMethod('grantConsent', purposes);

  /// Revokes consent: drops the device ID and queued events.
  static Future<void> revokeConsent() => channel.invokeMethod('revokeConsent');

  /// The granted purposes as a bit mask (0 when nothing is granted).
  static Future<int> getConsent() async =>
      await channel.invokeMethod<int>('getConsent') ?? 0;

  /// Stops all collection for this user, persistently.
  static Future<void> optOut() => channel.invokeMethod('optOut');

  /// Resumes collection after [optOut].
  static Future<void> optIn() => channel.invokeMethod('optIn');

  /// Restricted processing: collect without identity.
  static Future<void> setRestricted(bool on) =>
      channel.invokeMethod('setRestricted', on);

  /// Child mode: marks events and never creates a device ID.
  static Future<void> setChildMode(bool on) =>
      channel.invokeMethod('setChildMode', on);

  /// Sets the data region (`eu`, `us` or `cn`). Call it before [init].
  static Future<void> setDataRegion(String region) =>
      channel.invokeMethod('setDataRegion', region);

  /// Whether the app should show its consent prompt now.
  static Future<bool> shouldPrompt() async =>
      await channel.invokeMethod<bool>('shouldPrompt') ?? true;

  /// Pauses collection until [start].
  static Future<void> stop() => channel.invokeMethod('stop');

  /// Resumes collection after [stop].
  static Future<void> start() => channel.invokeMethod('start');

  // ---- properties / commerce ----

  /// Properties added to every later event, kept across launches.
  static Future<void> registerSuperProps(Map<String, Object?> props) =>
      channel.invokeMethod('registerSuperProps', props);

  /// Removes one super property.
  static Future<void> unregisterSuperProp(String key) =>
      channel.invokeMethod('unregisterSuperProp', key);

  /// Records an in-app purchase (`revenue`, `currency`, `order_id`, `items`).
  static Future<void> trackPurchase(Map<String, Object?> info) =>
      channel.invokeMethod('trackPurchase', info);

  /// Records a tap on a push notification.
  static Future<void> trackPushClick(Map<String, Object?> payload) =>
      channel.invokeMethod('trackPushClick', payload);

  /// Sets install attribution reported by your attribution provider.
  static Future<void> setAttribution(Map<String, Object?> attrs) =>
      channel.invokeMethod('setAttribution', attrs);

  /// Records that the app was opened from a deep link.
  static Future<void> trackDeeplink(String url, {String? referrer}) =>
      channel.invokeMethod('trackDeeplink', {'url': url, 'referrer': referrer});

  // ---- getters / listeners ----

  /// The current device ID, or `null` before consent.
  static Future<String?> getDeviceId() =>
      channel.invokeMethod<String>('getDeviceId');

  /// The current session ID.
  static Future<String?> getSessionId() =>
      channel.invokeMethod<String>('getSessionId');

  /// The remote configuration currently in effect.
  static Future<Map<String, Object?>> getRemoteConfig() async =>
      Map<String, Object?>.from(
        await channel.invokeMethod<Map>('getRemoteConfig') ?? const {},
      );

  /// Privacy-sensitive APIs the SDK calls (none), for privacy declarations.
  static List<String> requiredPrivacyApis() => const [];

  /// Registers a listener for consent changes.
  static void onConsentChange(TapCubConsentListener f) {
    _listen();
    _consent.add(f);
  }

  /// Registers a listener for new sessions.
  static void onSessionStart(TapCubSessionListener f) {
    _listen();
    _session.add(f);
  }

  /// Registers a listener for internal SDK errors.
  static void onError(TapCubErrorListener f) {
    _listen();
    _error.add(f);
  }
}

/// Reports routes as screens. Use the shared [TapCub.navigatorObserver]:
/// `MaterialApp(navigatorObservers: [TapCub.navigatorObserver])`.
///
/// Only routes with a `settings.name` are reported.
class TapCubNavigatorObserver extends NavigatorObserver {
  String? _last;

  void _screen(Route<dynamic>? route) {
    final name = route?.settings.name;
    if (name == null || name.isEmpty || name == _last) return;
    _last = name;
    unawaited(TapCub.trackScreen(name));
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) =>
      _screen(route);

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) =>
      _screen(newRoute);

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) =>
      _screen(previousRoute);
}
