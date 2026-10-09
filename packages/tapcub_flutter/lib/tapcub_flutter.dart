/// TapCub Flutter 桥接：只做参数装箱与 MethodChannel 转发，采集逻辑全部在原生 SDK。
library tapcub_flutter;

import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// 字段名与原生 / TS 核心一致；`null` 表示用原生默认值。
///
/// Flutter 页面都画在一个原生视图里，原生自动页面和全埋点拿不到 Dart 层信息，所以这里默认关掉：
/// 页面用 [TapCub.navigatorObserver] 或 [TapCub.trackScreen]，点击用 [TapCub.track]。
class TapCubConfig {
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

  final String siteKey;
  final String? endpoint;
  final List<String>? endpoints;
  final String? appId;

  /// auto | eu | us | cn
  final String? region;
  final bool autoTrack;
  final bool autoTrackScreens;
  final bool? crashReport;
  final bool? perf;
  final int? sessionTimeoutSec;
  final bool? requireConsent;
  final bool? holdUntilIdentified;
  final bool? debug;
  final String? deviceId;
  final String? appVersion;
  final int? rejectCooldownDays;

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

typedef TapCubConsentListener = void Function(int bits);
typedef TapCubSessionListener = void Function(String sessionId, String reason);
typedef TapCubErrorListener = void Function(String code, String message);

class TapCub {
  TapCub._();

  static const MethodChannel channel = MethodChannel('tapcub');
  static final TapCubNavigatorObserver navigatorObserver = TapCubNavigatorObserver();

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

  /// 只保存配置、挂生命周期：不采集、不读设备、不联网。
  static Future<void> preInit(TapCubConfig config) {
    _listen();
    return channel.invokeMethod('preInit', config.toMap());
  }

  /// 拉远程配置并开始采集；原生初始化完成后返回。
  static Future<void> init() => channel.invokeMethod('init');

  // ---- collection ----

  static Future<void> track(String name, [Map<String, Object?>? props]) =>
      channel.invokeMethod('track', {'name': name, 'props': props});
  static Future<void> trackScreen(String name, [Map<String, Object?>? props]) =>
      channel.invokeMethod('trackScreen', {'name': name, 'props': props});
  static Future<void> flush() => channel.invokeMethod('flush');

  // ---- identity ----

  /// type: login | email | mobile | unionid | openid | custom
  static Future<void> login(String id, {Map<String, Object?>? props, String type = 'login'}) =>
      channel.invokeMethod('login', {'id': id, 'props': props, 'type': type});
  static Future<void> logout() => channel.invokeMethod('logout');
  static Future<void> bind(Map<String, String> ids) => channel.invokeMethod('bind', ids);
  static Future<void> setProps(Map<String, Object?> props) => channel.invokeMethod('setProps', props);
  static Future<void> setPropsOnce(Map<String, Object?> props) => channel.invokeMethod('setPropsOnce', props);
  static Future<void> unsetProps(List<String> keys) => channel.invokeMethod('unsetProps', keys);
  static Future<void> setGroup(String type, String? id, [Map<String, Object?>? traits]) =>
      channel.invokeMethod('setGroup', {'type': type, 'id': id, 'traits': traits});
  static Future<void> reset() => channel.invokeMethod('reset');
  static Future<void> anonymize() => channel.invokeMethod('anonymize');

  // ---- consent ----

  /// purposes: analytics | functional | marketing
  static Future<void> grantConsent(List<String> purposes) => channel.invokeMethod('grantConsent', purposes);
  static Future<void> revokeConsent() => channel.invokeMethod('revokeConsent');
  static Future<int> getConsent() async => await channel.invokeMethod<int>('getConsent') ?? 0;
  static Future<void> optOut() => channel.invokeMethod('optOut');
  static Future<void> optIn() => channel.invokeMethod('optIn');
  static Future<void> setRestricted(bool on) => channel.invokeMethod('setRestricted', on);
  static Future<void> setChildMode(bool on) => channel.invokeMethod('setChildMode', on);

  /// eu | us | cn — 在 [init] 之前调用。
  static Future<void> setDataRegion(String region) => channel.invokeMethod('setDataRegion', region);
  static Future<bool> shouldPrompt() async => await channel.invokeMethod<bool>('shouldPrompt') ?? true;
  static Future<void> stop() => channel.invokeMethod('stop');
  static Future<void> start() => channel.invokeMethod('start');

  // ---- properties / commerce ----

  static Future<void> registerSuperProps(Map<String, Object?> props) => channel.invokeMethod('registerSuperProps', props);
  static Future<void> unregisterSuperProp(String key) => channel.invokeMethod('unregisterSuperProp', key);
  static Future<void> trackPurchase(Map<String, Object?> info) => channel.invokeMethod('trackPurchase', info);
  static Future<void> trackPushClick(Map<String, Object?> payload) => channel.invokeMethod('trackPushClick', payload);
  static Future<void> setAttribution(Map<String, Object?> attrs) => channel.invokeMethod('setAttribution', attrs);
  static Future<void> trackDeeplink(String url, {String? referrer}) =>
      channel.invokeMethod('trackDeeplink', {'url': url, 'referrer': referrer});

  // ---- getters / listeners ----

  static Future<String?> getDeviceId() => channel.invokeMethod<String>('getDeviceId');
  static Future<String?> getSessionId() => channel.invokeMethod<String>('getSessionId');
  static Future<Map<String, Object?>> getRemoteConfig() async =>
      Map<String, Object?>.from(await channel.invokeMethod<Map>('getRemoteConfig') ?? const {});
  static List<String> requiredPrivacyApis() => const [];

  static void onConsentChange(TapCubConsentListener f) {
    _listen();
    _consent.add(f);
  }

  static void onSessionStart(TapCubSessionListener f) {
    _listen();
    _session.add(f);
  }

  static void onError(TapCubErrorListener f) {
    _listen();
    _error.add(f);
  }
}

/// MaterialApp(navigatorObservers: [TapCub.navigatorObserver])，只上报带 `settings.name` 的路由。
class TapCubNavigatorObserver extends NavigatorObserver {
  String? _last;

  void _screen(Route<dynamic>? route) {
    final name = route?.settings.name;
    if (name == null || name.isEmpty || name == _last) return;
    _last = name;
    unawaited(TapCub.trackScreen(name));
  }

  @override
  void didPush(Route<dynamic> route, Route<dynamic>? previousRoute) => _screen(route);

  @override
  void didReplace({Route<dynamic>? newRoute, Route<dynamic>? oldRoute}) => _screen(newRoute);

  @override
  void didPop(Route<dynamic> route, Route<dynamic>? previousRoute) => _screen(previousRoute);
}
