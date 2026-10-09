package com.tapcub.rn

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.tapcub.TapCubCrash

/**
 * `NativeModules.TapCubCrash`: hands crashes recorded by the native SDK to the JS core. Capture starts when
 * the module is created; to catch startup crashes call `TapCubCrash.install(this)` in `Application.onCreate`.
 */
class TapCubCrashModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName(): String = "TapCubCrash"

    override fun initialize() {
        super.initialize()
        TapCubCrash.install(ctx)
    }

    @ReactMethod
    fun drain(promise: Promise) {
        val out = Arguments.createArray()
        for (ev in TapCubCrash.drain()) {
            val m = Arguments.createMap()
            for ((k, v) in ev) {
                when (v) {
                    null -> m.putNull(k)
                    is String -> m.putString(k, v)
                    is Boolean -> m.putBoolean(k, v)
                    is Long -> m.putDouble(k, v.toDouble())
                    is Number -> m.putDouble(k, v.toDouble())
                    else -> m.putString(k, v.toString())
                }
            }
            out.pushMap(m)
        }
        promise.resolve(out)
    }
}
