package com.tapcub

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.pm.PackageInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.view.WindowManager
import com.tapcub.core.Adapters
import com.tapcub.core.CrashEvent
import com.tapcub.core.PartialQueue
import com.tapcub.core.RemoteConfig
import com.tapcub.core.State
import com.tapcub.core.TapCubCore

typealias TapCubConfig = com.tapcub.core.TapCubConfig

fun interface ConsentListener {
    fun onConsentChange(bits: Int)
}

fun interface SessionListener {
    /** reason: init | timeout | login | max_age | logout */
    fun onSessionStart(sessionId: String, reason: String)
}

fun interface ErrorListener {
    fun onError(code: String, message: String)
}

/**
 * Public entry point. Every call is handed to one worker thread and returns immediately; getters read a
 * snapshot refreshed after each call, so they never block the caller. Listeners run on the main thread.
 *
 *     TapCub.preInit(this, TapCubConfig("s_xxx"))   // Application.onCreate
 *     TapCub.init()                                    // after consent, or right away when none is needed
 */
object TapCub {
    private val lock = Any()
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var created = false
    private var worker: Worker? = null
    private var core: TapCubCore? = null
    private var perfEnabled = false
    private var refreshHz = 60f

    private class Snapshot(
        val deviceId: String? = null,
        val sessionId: String? = null,
        val consent: Int = 0,
        val shouldPrompt: Boolean = true,
        val rc: RemoteConfig = RemoteConfig(),
        val state: State? = null,
    )

    @Volatile private var snap = Snapshot()

    /** Native default: a larger on-disk queue than the mini-program 1 MB limit. */
    private val NATIVE_QUEUE = PartialQueue(maxEvents = 10000, maxDays = 7, maxStorageBytes = 8 * 1_048_576)

    // ---- lifecycle ----

    /**
     * Stores config and binds lifecycle only: no collection, no device reads, no network until [init].
     * Call from `Application.onCreate`.
     */
    @JvmStatic
    fun preInit(context: Context, config: TapCubConfig) {
        require(config.siteKey.isNotEmpty()) { "siteKey required" }
        synchronized(lock) {
            if (created) return
            created = true
        }
        val app = context.applicationContext as Application
        val cfg = config.copy()
        if (cfg.queue == null) cfg.queue = NATIVE_QUEUE
        val pi = packageInfo(app)
        if (cfg.appId == null) cfg.appId = app.packageName
        if (cfg.appVersion == null) cfg.appVersion = pi?.versionName
        if (cfg.appBuild == null) cfg.appBuild = pi?.let { versionCode(it) }
        perfEnabled = cfg.perf == true
        refreshHz = displayHz(app)

        val w = Worker()
        worker = w
        val storage = DeviceStorage(app)
        val lifecycle = AppLifecycle(app, w, cfg.autoTrackScreens != false)
        val autoTrack = if (cfg.autoTrack != false) AutoTrack(w) else null
        if (autoTrack != null) lifecycle.onActivityResumedHook = { autoTrack.attach(it) }
        val debug = cfg.debug == true
        val adapters = Adapters(
            storage = storage,
            transport = HttpTransport(w, Worker(Brand.NET_THREAD)),
            lifecycle = lifecycle,
            device = SystemDevice(app, storage),
            timers = WorkerTimers(w),
            autoTrack = autoTrack,
            crash = if (cfg.crashReport == false) null else CrashReporter(app, w),
            log = { level, msg -> if (debug) Log.println(if (level == "error") Log.WARN else Log.DEBUG, Brand.LOG_TAG, msg) },
        )
        w.execute {
            val c = TapCubCore(adapters)
            c.onSessionStart { _, _ ->
                refresh(c)
                samplePerf(c)
            }
            c.onConsentChange { refresh(c) }
            c.preInit(cfg)
            core = c
            refresh(c)
        }
    }

    /** Fetches remote config and starts collecting (after consent when the site requires it). */
    @JvmStatic
    @JvmOverloads
    fun init(callback: Runnable? = null) {
        exec { c ->
            c.init {
                refresh(c)
                if (callback != null) main.post(callback)
            }
        }
    }

    private fun exec(fn: (TapCubCore) -> Unit) {
        val w = worker
        if (w == null) {
            Log.w(Brand.LOG_TAG, "call preInit(context, config) first")
            return
        }
        w.execute {
            val c = core ?: return@execute
            fn(c)
            refresh(c)
        }
    }

    private fun refresh(c: TapCubCore) {
        snap = Snapshot(c.getDeviceId(), c.getSessionId(), c.getConsent(), c.shouldPrompt(), c.getRemoteConfig(), c.getState())
    }

    private fun samplePerf(c: TapCubCore) {
        if (!perfEnabled && !c.getRemoteConfig().perf) return
        PerfSampler.sampleFps(refreshHz) { fps ->
            worker?.execute {
                if (fps != null) c.track("\$fps_sample", fps)
                c.track("\$memory_sample", PerfSampler.memorySample())
            }
        }
    }

    // ---- collection ----

    @JvmStatic
    @JvmOverloads
    fun track(name: String, props: Map<String, Any?>? = null) {
        val p = com.tapcub.core.Json.boxObject(props)
        exec { it.track(name, p) }
    }

    @JvmStatic
    @JvmOverloads
    fun trackScreen(name: String, props: Map<String, Any?>? = null) {
        val p = com.tapcub.core.Json.boxObject(props)
        exec { it.trackScreen(name, p) }
    }

    @JvmStatic
    fun flush() = exec { it.flush() }

    // ---- identity ----

    /** type: login | email | mobile | unionid | openid | custom (email / mobile are hashed on device). */
    @JvmStatic
    @JvmOverloads
    fun login(id: String, props: Map<String, Any?>? = null, type: String = "login") {
        val p = com.tapcub.core.Json.boxObject(props)
        exec { it.login(id, p, type) }
    }

    @JvmStatic
    fun logout() = exec { it.logout() }

    @JvmStatic
    fun bind(ids: Map<String, String>) {
        val p = HashMap<String, Any?>(ids)
        exec { it.bind(p) }
    }

    /** User profile set (not super properties; see [registerSuperProps]). */
    @JvmStatic
    fun setProps(props: Map<String, Any?>) {
        val p = com.tapcub.core.Json.boxObject(props)!!
        exec { it.setProps(p) }
    }

    @JvmStatic
    fun setPropsOnce(props: Map<String, Any?>) {
        val p = com.tapcub.core.Json.boxObject(props)!!
        exec { it.setPropsOnce(p) }
    }

    @JvmStatic
    fun unsetProps(keys: List<String>) {
        val k = keys.toList()
        exec { it.unsetProps(k) }
    }

    @JvmStatic
    @JvmOverloads
    fun setGroup(type: String, id: String?, traits: Map<String, Any?>? = null) {
        val p = com.tapcub.core.Json.boxObject(traits)
        exec { it.setGroup(type, id, p) }
    }

    @JvmStatic
    fun reset() = exec { it.reset() }

    @JvmStatic
    fun anonymize() = exec { it.anonymize() }

    // ---- consent ----

    /** purposes: analytics | functional | marketing */
    @JvmStatic
    fun grantConsent(purposes: List<String>) {
        val p = purposes.toList()
        exec { it.grantConsent(p) }
    }

    @JvmStatic
    fun grantConsent(bits: Int) = exec { it.grantConsent(bits) }

    @JvmStatic
    fun revokeConsent() = exec { it.revokeConsent() }

    @JvmStatic
    fun getConsent(): Int = snap.consent

    @JvmStatic
    fun optOut() = exec { it.optOut() }

    @JvmStatic
    fun optIn() = exec { it.optIn() }

    @JvmStatic
    fun setRestricted(on: Boolean) = exec { it.setRestricted(on) }

    @JvmStatic
    fun setChildMode(on: Boolean) = exec { it.setChildMode(on) }

    /** eu | us | cn — before [init]. */
    @JvmStatic
    fun setDataRegion(region: String) = exec { it.setDataRegion(region) }

    @JvmStatic
    fun shouldPrompt(): Boolean = snap.shouldPrompt

    @JvmStatic
    fun stop() = exec { it.stop() }

    @JvmStatic
    fun start() = exec { it.start() }

    // ---- properties / commerce ----

    @JvmStatic
    fun registerSuperProps(props: Map<String, Any?>) {
        val p = com.tapcub.core.Json.boxObject(props)!!
        exec { it.registerSuperProps(p) }
    }

    @JvmStatic
    fun unregisterSuperProp(key: String) = exec { it.unregisterSuperProp(key) }

    @JvmStatic
    fun trackPurchase(info: Map<String, Any?>) {
        val p = com.tapcub.core.Json.boxObject(info)!!
        exec { it.trackPurchase(p) }
    }

    @JvmStatic
    fun trackPushClick(payload: Map<String, Any?>) {
        val p = com.tapcub.core.Json.boxObject(payload)!!
        exec { it.trackPushClick(p) }
    }

    @JvmStatic
    fun setAttribution(attrs: Map<String, Any?>) {
        val p = com.tapcub.core.Json.boxObject(attrs)!!
        exec { it.setAttribution(p) }
    }

    @JvmStatic
    @JvmOverloads
    fun trackDeeplink(url: String, referrer: String? = null) = exec { it.trackDeeplink(url, referrer) }

    @JvmStatic
    fun reportException(ev: CrashEvent) = exec { it.reportException(ev) }

    // ---- getters / listeners ----

    @JvmStatic
    fun getDeviceId(): String? = snap.deviceId

    @JvmStatic
    fun getSessionId(): String? = snap.sessionId

    @JvmStatic
    fun getRemoteConfig(): RemoteConfig = snap.rc

    @JvmStatic
    fun getState(): State? = snap.state

    @JvmStatic
    fun requiredPrivacyApis(): List<String> = emptyList()

    @JvmStatic
    fun onConsentChange(l: ConsentListener) = exec { c -> c.onConsentChange { bits -> main.post { l.onConsentChange(bits) } } }

    @JvmStatic
    fun onSessionStart(l: SessionListener) = exec { c -> c.onSessionStart { s, r -> main.post { l.onSessionStart(s, r) } } }

    @JvmStatic
    fun onError(l: ErrorListener) = exec { c -> c.onError { code, msg -> main.post { l.onError(code, msg) } } }

    // ---- autotrack controls ----

    /** Skips automatic `$screen_view` for an Activity class. */
    @JvmStatic
    fun ignoreScreen(cls: Class<out Activity>) {
        AppLifecycle.ignored.add(cls.name)
    }

    /** Skips automatic `$screen_view` for a screen name. */
    @JvmStatic
    fun ignoreScreen(name: String) {
        AppLifecycle.ignored.add(name)
    }

    /** Stable `$element_id` for a view (defaults to its resource id name). */
    @JvmStatic
    fun setElementId(view: View, id: String) = view.setTag(R.id.tapcub_element_id, id)

    /** Excludes a view and its children from `$app_click`. */
    @JvmStatic
    fun ignoreView(view: View) = view.setTag(R.id.tapcub_ignore_clicks, true)

    // ---- helpers ----

    private fun packageInfo(app: Application): PackageInfo? = try {
        app.packageManager.getPackageInfo(app.packageName, 0)
    } catch (_: Exception) {
        null
    }

    @Suppress("DEPRECATION")
    private fun versionCode(pi: PackageInfo): String =
        if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode.toString() else pi.versionCode.toString()

    @Suppress("DEPRECATION")
    private fun displayHz(app: Application): Float = try {
        (app.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.refreshRate
    } catch (_: Exception) {
        60f
    }
}
