import Flutter
import TapCub

/// MethodChannel `tapcub` → native TapCub. No collection logic here.
public final class TapCubFlutterPlugin: NSObject, FlutterPlugin {
    private let channel: FlutterMethodChannel

    init(channel: FlutterMethodChannel) {
        self.channel = channel
    }

    public static func register(with registrar: FlutterPluginRegistrar) {
        let channel = FlutterMethodChannel(name: "tapcub", binaryMessenger: registrar.messenger())
        registrar.addMethodCallDelegate(TapCubFlutterPlugin(channel: channel), channel: channel)
    }

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        let args = call.arguments
        let m = args as? [String: Any] ?? [:]
        func s(_ k: String) -> String? { m[k] as? String }
        func props(_ k: String) -> [String: Any]? { m[k] as? [String: Any] }
        func list() -> [String] { (args as? [Any])?.compactMap { $0 as? String } ?? [] }
        switch call.method {
        case "preInit":
            TapCub.preInit(TapCubConfig(json: JSONValue.from(m).objectValue ?? JSONObject()))
            TapCub.onConsentChange { [weak self] bits in self?.channel.invokeMethod("onConsentChange", arguments: bits) }
            TapCub.onSessionStart { [weak self] sid, reason in
                self?.channel.invokeMethod("onSessionStart", arguments: ["sessionId": sid, "reason": reason])
            }
            TapCub.onError { [weak self] code, msg in self?.channel.invokeMethod("onError", arguments: ["code": code, "message": msg]) }
        case "init":
            TapCub.initialize { result(nil) }
            return
        case "track": TapCub.track(s("name") ?? "", props: props("props"))
        case "trackScreen": TapCub.trackScreen(s("name") ?? "", props: props("props"))
        case "flush": TapCub.flush()
        case "login": TapCub.login(s("id") ?? "", props: props("props"), type: s("type") ?? "login")
        case "logout": TapCub.logout()
        case "bind": TapCub.bind(m.compactMapValues { $0 as? String })
        case "setProps": TapCub.setProps(m)
        case "setPropsOnce": TapCub.setPropsOnce(m)
        case "unsetProps": TapCub.unsetProps(list())
        case "setGroup": TapCub.setGroup(s("type") ?? "", id: s("id"), traits: props("traits"))
        case "reset": TapCub.reset()
        case "anonymize": TapCub.anonymize()
        case "grantConsent": TapCub.grantConsent(list())
        case "revokeConsent": TapCub.revokeConsent()
        case "getConsent": result(TapCub.getConsent()); return
        case "optOut": TapCub.optOut()
        case "optIn": TapCub.optIn()
        case "setRestricted": TapCub.setRestricted(args as? Bool ?? false)
        case "setChildMode": TapCub.setChildMode(args as? Bool ?? false)
        case "setDataRegion": TapCub.setDataRegion(args as? String ?? "")
        case "shouldPrompt": result(TapCub.shouldPrompt()); return
        case "stop": TapCub.stop()
        case "start": TapCub.start()
        case "registerSuperProps": TapCub.registerSuperProps(m)
        case "unregisterSuperProp": TapCub.unregisterSuperProp(args as? String ?? "")
        case "trackPurchase": TapCub.trackPurchase(m)
        case "trackPushClick": TapCub.trackPushClick(m)
        case "setAttribution": TapCub.setAttribution(m)
        case "trackDeeplink": TapCub.trackDeeplink(s("url") ?? "", referrer: s("referrer"))
        case "getDeviceId": result(TapCub.getDeviceId()); return
        case "getSessionId": result(TapCub.getSessionId()); return
        case "getRemoteConfig": result(JSONValue.object(TapCub.getRemoteConfig().toJSON()).foundationValue); return
        default:
            result(FlutterMethodNotImplemented)
            return
        }
        result(nil)
    }
}
