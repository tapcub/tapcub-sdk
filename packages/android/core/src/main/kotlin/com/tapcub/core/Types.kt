package com.tapcub.core

// Mirrors packages/app-sdk/src/core/types.ts. Keep field names and defaults in sync.

data class ReportPolicy(
    var onLaunch: Boolean = true,
    var onBackground: Boolean = true,
    var intervalSec: Int = 30,
    var threshold: Int = 30,
)

data class QueueLimits(
    var maxEvents: Int = 10000,
    var maxDays: Int = 7,
    var maxBatch: Int = 50,
    var maxBytes: Int = 65536,
    var maxStorageBytes: Int = 1_048_576,
)

data class PartialPolicy(
    var onLaunch: Boolean? = null,
    var onBackground: Boolean? = null,
    var intervalSec: Int? = null,
    var threshold: Int? = null,
)

data class PartialQueue(
    var maxEvents: Int? = null,
    var maxDays: Int? = null,
    var maxBatch: Int? = null,
    var maxBytes: Int? = null,
    var maxStorageBytes: Int? = null,
)

/** SDK configuration. `null` means "not set" (same as `undefined` in the TS core). */
data class TapCubConfig @JvmOverloads constructor(
    var siteKey: String,
    var endpoint: String? = null,
    var endpoints: List<String>? = null,
    var appId: String? = null,
    /** auto | eu | us | cn */
    var region: String? = null,
    var autoTrack: Boolean? = null,
    var autoTrackScreens: Boolean? = null,
    var crashReport: Boolean? = null,
    var perf: Boolean? = null,
    var reportPolicy: PartialPolicy? = null,
    var queue: PartialQueue? = null,
    var sessionTimeoutSec: Int? = null,
    var requireConsent: Boolean? = null,
    var holdUntilIdentified: Boolean? = null,
    var debug: Boolean? = null,
    var deviceId: String? = null,
    var appName: String? = null,
    var appBuild: String? = null,
    var rejectCooldownDays: Int? = null,
    var appVersion: String? = null,
) {
    companion object {
        /** Builds a config from the TS field names (bridges and test vectors). */
        @JvmStatic
        fun fromJson(o: Map<String, Any?>): TapCubConfig {
            fun s(k: String) = o[k] as? String
            fun b(k: String) = o[k] as? Boolean
            fun i(k: String) = (o[k] as? Number)?.toInt()
            val c = TapCubConfig(s("siteKey") ?: "")
            c.endpoint = s("endpoint")
            c.endpoints = (o["endpoints"] as? List<*>)?.filterIsInstance<String>()
            c.appId = s("appId")
            c.region = s("region")
            c.autoTrack = b("autoTrack")
            c.autoTrackScreens = b("autoTrackScreens")
            c.crashReport = b("crashReport")
            c.perf = b("perf")
            (o["reportPolicy"] as? Map<*, *>)?.let { p ->
                c.reportPolicy = PartialPolicy(
                    p["onLaunch"] as? Boolean,
                    p["onBackground"] as? Boolean,
                    (p["intervalSec"] as? Number)?.toInt(),
                    (p["threshold"] as? Number)?.toInt(),
                )
            }
            (o["queue"] as? Map<*, *>)?.let { q ->
                c.queue = PartialQueue(
                    (q["maxEvents"] as? Number)?.toInt(),
                    (q["maxDays"] as? Number)?.toInt(),
                    (q["maxBatch"] as? Number)?.toInt(),
                    (q["maxBytes"] as? Number)?.toInt(),
                    (q["maxStorageBytes"] as? Number)?.toInt(),
                )
            }
            c.sessionTimeoutSec = i("sessionTimeoutSec")
            c.requireConsent = b("requireConsent")
            c.holdUntilIdentified = b("holdUntilIdentified")
            c.debug = b("debug")
            c.deviceId = s("deviceId")
            c.appName = s("appName")
            c.appBuild = s("appBuild")
            c.rejectCooldownDays = i("rejectCooldownDays")
            c.appVersion = s("appVersion")
            return c
        }
    }
}

data class RemoteConfig(
    var enabled: Boolean = true,
    var blacklist: List<String> = emptyList(),
    var sample: Int = 100,
    var interval: Int = 30,
    var threshold: Int = 30,
    var deviceBlacklist: List<String> = emptyList(),
    var requireConsent: Boolean = false,
    var autotrack: Boolean = true,
    var textCapture: Boolean = false,
    var elementBlacklist: List<String> = emptyList(),
    var perf: Boolean = false,
    var minVersion: String? = null,
    var ttl: Int = 86400,
) {
    fun toJson(): JsonObject = jsonObjectOf(
        "enabled" to enabled,
        "blacklist" to blacklist,
        "sample" to sample,
        "interval" to interval,
        "threshold" to threshold,
        "deviceBlacklist" to deviceBlacklist,
        "requireConsent" to requireConsent,
        "autotrack" to autotrack,
        "textCapture" to textCapture,
        "elementBlacklist" to elementBlacklist,
        "perf" to perf,
        "minVersion" to minVersion,
        "ttl" to ttl,
    )
}

/** Server cfg (GET /api/v1/pulse/cfg). `raw` is cached verbatim. */
internal class ServerCfg(val raw: JsonObject) {
    val t: Double get() = raw["t"].asNum() ?: 2.0
    val i: Boolean get() = truthy(raw["i"])
    val h: Boolean get() = truthy(raw["h"])
    val cn: Boolean get() = truthy(raw["cn"])
    val cs: JsonObject? get() = raw["cs"].asObj()
    val rc: Any? get() = raw["rc"]

    companion object {
        val conservative get() = ServerCfg(jsonObjectOf("t" to 2.0))
    }
}

internal fun truthy(v: Any?): Boolean = when (v) {
    null -> false
    is Boolean -> v
    is Number -> Json.toDouble(v).let { it != 0.0 && !it.isNaN() }
    is String -> v.isNotEmpty()
    else -> true
}

data class TransportResponse @JvmOverloads constructor(val status: Int, val body: String? = null)

data class LaunchInfo @JvmOverloads constructor(
    val scene: Any? = null,
    val path: String? = null,
    val query: Map<String, String> = emptyMap(),
)

data class PageInfo @JvmOverloads constructor(
    val path: String,
    val query: Map<String, String>? = null,
    val title: String? = null,
)

data class Element @JvmOverloads constructor(
    val type: String? = null,
    val id: String? = null,
    val content: String? = null,
    val path: String? = null,
)

data class CrashEvent @JvmOverloads constructor(
    /** crash | anr | freeze */
    val kind: String,
    val type: String? = null,
    val message: String? = null,
    val stack: String? = null,
    val fatal: Boolean? = null,
    val durationMs: Long? = null,
    val foreground: Boolean? = null,
    /** Crash time in ms; kept when the crash is reported on the next launch. */
    val ts: Long? = null,
)

data class DeviceSnapshot(
    val os: String? = null,
    val osVersion: String? = null,
    val brand: String? = null,
    val model: String? = null,
    /** phone | tablet | tv | other */
    val deviceType: String? = null,
    val screenWidth: Int? = null,
    val screenHeight: Int? = null,
    val pixelRatio: Double? = null,
    val locale: String? = null,
    val timezone: String? = null,
    val hostVersion: String? = null,
)

class LifecycleHandlers(
    val onLaunch: (LaunchInfo) -> Unit,
    val onShow: (LaunchInfo) -> Unit,
    val onHide: () -> Unit,
    val onPageShow: (PageInfo) -> Unit,
    val onPageHide: (PageInfo) -> Unit,
    val onShare: (PageInfo, String) -> Unit,
)

// ---- adapter interfaces (six protocols + optional hooks) ----

interface Storage {
    fun get(key: String): String?
    /** Throws when the write fails (quota, IO); the core reports `storage_failed` and keeps going. */
    fun set(key: String, value: String)
    fun remove(key: String)
}

interface Transport {
    /** Network errors are reported as a failed [Result]. */
    fun get(url: String, cb: (Result<TransportResponse>) -> Unit)
    fun post(url: String, body: String, headers: Map<String, String>, cb: (Result<TransportResponse>) -> Unit)
}

interface Lifecycle {
    fun bind(handlers: LifecycleHandlers)
}

interface DeviceInfo {
    /** android | ios | harmony */
    val platform: String
    /** Only called after consent (or when the site does not require consent). */
    fun read(): DeviceSnapshot
    fun networkType(cb: (String?) -> Unit)
    /** Full platform device id such as `android_id:<hex>`; null lets the core generate one. Only called after consent. */
    fun deviceId(): String? = null
}

interface Timers {
    fun now(): Long
    fun setTimeout(ms: Long, fn: () -> Unit): Int
    fun clearTimeout(id: Int)
    fun setInterval(ms: Long, fn: () -> Unit): Int
    fun clearInterval(id: Int)
    fun random(): Double
}

interface AutoTrackHook {
    fun enable(cb: (Element, PageInfo?) -> Unit)
    fun disable()
}

interface CrashHook {
    fun enable(cb: (CrashEvent) -> Unit)
    fun disable()
}

class Adapters @JvmOverloads constructor(
    val storage: Storage,
    val transport: Transport,
    val lifecycle: Lifecycle,
    val device: DeviceInfo,
    val timers: Timers,
    val autoTrack: AutoTrackHook? = null,
    val crash: CrashHook? = null,
    val log: ((level: String, message: String) -> Unit)? = null,
)

data class State(
    val initialized: Boolean,
    val deviceId: String?,
    val sessionId: String?,
    val consent: Int?,
    val optedOut: Boolean,
    val loginId: String?,
    val loginType: String?,
    val queueLength: Int,
    val holdLength: Int,
    val enabled: Boolean,
    val sampled: Boolean,
    val tier: Double,
    val endpoint: String,
    val sessionCount: Int,
) {
    fun toJson(): JsonObject = jsonObjectOf(
        "initialized" to initialized,
        "deviceId" to deviceId,
        "sessionId" to sessionId,
        "consent" to consent,
        "optedOut" to optedOut,
        "loginId" to loginId,
        "loginType" to loginType,
        "queueLength" to queueLength,
        "holdLength" to holdLength,
        "enabled" to enabled,
        "sampled" to sampled,
        "tier" to tier,
        "endpoint" to endpoint,
        "sessionCount" to sessionCount,
    )
}
