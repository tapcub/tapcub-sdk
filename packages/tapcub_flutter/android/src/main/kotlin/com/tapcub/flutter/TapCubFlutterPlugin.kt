package com.tapcub.flutter

import android.app.Activity
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.tapcub.TapCub
import com.tapcub.TapCubConfig
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/** MethodChannel `tapcub` → com.tapcub.TapCub. No collection logic here. */
class TapCubFlutterPlugin : FlutterPlugin, ActivityAware, MethodChannel.MethodCallHandler {
    private var channel: MethodChannel? = null
    private var context: Context? = null
    private var activity: Activity? = null
    private val main = Handler(Looper.getMainLooper())

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        context = binding.applicationContext
        channel = MethodChannel(binding.binaryMessenger, "tapcub").also { it.setMethodCallHandler(this) }
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel?.setMethodCallHandler(null)
        channel = null
    }

    // preInit runs from Dart after the Activity is up: passing it lets the native SDK report the app launch.
    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivityForConfigChanges() {
        activity = null
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        activity = binding.activity
    }

    override fun onDetachedFromActivity() {
        activity = null
    }

    @Suppress("UNCHECKED_CAST")
    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        val args = call.arguments
        val m = args as? Map<String, Any?> ?: emptyMap()
        fun s(k: String) = m[k] as? String
        fun props(k: String) = m[k] as? Map<String, Any?>
        when (call.method) {
            "preInit" -> {
                val ctx = activity ?: context ?: return result.error("no_context", "plugin not attached", null)
                TapCub.preInit(ctx, TapCubConfig.fromJson(m))
                TapCub.onConsentChange { bits -> emit("onConsentChange", bits) }
                TapCub.onSessionStart { sid, reason -> emit("onSessionStart", mapOf("sessionId" to sid, "reason" to reason)) }
                TapCub.onError { code, msg -> emit("onError", mapOf("code" to code, "message" to msg)) }
            }
            "init" -> return TapCub.init { result.success(null) }
            "track" -> TapCub.track(s("name") ?: "", props("props"))
            "trackScreen" -> TapCub.trackScreen(s("name") ?: "", props("props"))
            "flush" -> TapCub.flush()
            "login" -> TapCub.login(s("id") ?: "", props("props"), s("type") ?: "login")
            "logout" -> TapCub.logout()
            "bind" -> TapCub.bind(m.mapNotNull { (k, v) -> (v as? String)?.let { k to it } }.toMap())
            "setProps" -> TapCub.setProps(m)
            "setPropsOnce" -> TapCub.setPropsOnce(m)
            "unsetProps" -> TapCub.unsetProps((args as? List<*>)?.filterIsInstance<String>() ?: emptyList())
            "setGroup" -> TapCub.setGroup(s("type") ?: "", s("id"), props("traits"))
            "reset" -> TapCub.reset()
            "anonymize" -> TapCub.anonymize()
            "grantConsent" -> TapCub.grantConsent((args as? List<*>)?.filterIsInstance<String>() ?: emptyList())
            "revokeConsent" -> TapCub.revokeConsent()
            "getConsent" -> return result.success(TapCub.getConsent())
            "optOut" -> TapCub.optOut()
            "optIn" -> TapCub.optIn()
            "setRestricted" -> TapCub.setRestricted(args == true)
            "setChildMode" -> TapCub.setChildMode(args == true)
            "setDataRegion" -> TapCub.setDataRegion(args as? String ?: "")
            "shouldPrompt" -> return result.success(TapCub.shouldPrompt())
            "stop" -> TapCub.stop()
            "start" -> TapCub.start()
            "registerSuperProps" -> TapCub.registerSuperProps(m)
            "unregisterSuperProp" -> TapCub.unregisterSuperProp(args as? String ?: "")
            "trackPurchase" -> TapCub.trackPurchase(m)
            "trackPushClick" -> TapCub.trackPushClick(m)
            "setAttribution" -> TapCub.setAttribution(m)
            "trackDeeplink" -> TapCub.trackDeeplink(s("url") ?: "", s("referrer"))
            "getDeviceId" -> return result.success(TapCub.getDeviceId())
            "getSessionId" -> return result.success(TapCub.getSessionId())
            "getRemoteConfig" -> return result.success(TapCub.getRemoteConfig().toJson())
            else -> return result.notImplemented()
        }
        result.success(null)
    }

    private fun emit(method: String, args: Any?) {
        main.post { channel?.invokeMethod(method, args) }
    }
}
