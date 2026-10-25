package com.tapcub

import android.app.Activity
import android.app.Application
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import com.tapcub.core.LaunchInfo
import com.tapcub.core.Lifecycle
import com.tapcub.core.LifecycleHandlers
import com.tapcub.core.PageInfo
import java.lang.ref.WeakReference
import java.util.Collections
import java.util.WeakHashMap

/** Screen name for automatic `$screen_view` (defaults to the Activity's simple class name). */
@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
annotation class TapCubScreen(val value: String)

/**
 * App lifecycle from ActivityLifecycleCallbacks (same semantics as ProcessLifecycleOwner, without AndroidX):
 * the first Activity resume (or the Activity passed to preInit) → onLaunch (with cold-start time), started count 0→1 → onShow, 1→0 → onHide.
 * Activity resume / pause → page show / hide. Handlers run on the worker thread.
 */
internal class AppLifecycle(
    private val app: Application,
    private val worker: Worker,
    private val autoTrackScreens: Boolean,
    /** The Activity on screen when preInit runs late (Flutter calls preInit from Dart, after the Activity is up). */
    current: Activity? = null,
) : Lifecycle, Application.ActivityLifecycleCallbacks {
    private var handlers: LifecycleHandlers? = null
    private var started = 0
    private var launched = false
    private val pages = WeakHashMap<Activity, PageInfo>()
    private var adopted = current?.let { WeakReference(it) }

    /** Extra per-activity hooks (autotrack wraps the window callback here). */
    var onActivityResumedHook: ((Activity) -> Unit)? = null

    override fun bind(handlers: LifecycleHandlers) {
        this.handlers = handlers
        // Call preInit from Application.onCreate. When it runs later with only the Application context,
        // the launch is reported on the next resume; with the current Activity it is reported now (same as iOS
        // checking applicationState == .active). That Activity's own page / autotrack hooks start on its next resume.
        app.runOnMain {
            app.registerActivityLifecycleCallbacks(this)
            val a = adopted?.get()
            if (a == null || a.isFinishing) {
                adopted = null
                return@runOnMain
            }
            started = 1
            launch(a)
        }
    }

    private fun post(fn: (LifecycleHandlers) -> Unit) {
        val h = handlers ?: return
        worker.execute { fn(h) }
    }

    private fun launch(activity: Activity) {
        if (launched) return
        launched = true
        val query = coldStartMs()?.let { mapOf("duration_ms" to it.toString()) } ?: emptyMap()
        val path = activity.intent?.dataString
        post { it.onLaunch(LaunchInfo(path = path, query = query)) }
    }

    override fun onActivityStarted(activity: Activity) {
        // Adopted before its onStart: already counted.
        if (adopted?.get() === activity) {
            adopted = null
            return
        }
        started++
        if (started == 1 && launched) post { it.onShow(LaunchInfo()) }
    }

    override fun onActivityResumed(activity: Activity) {
        launch(activity)
        onActivityResumedHook?.invoke(activity)
        if (autoTrackScreens) {
            val name = screenName(activity) ?: return
            val page = PageInfo(name)
            pages[activity] = page
            post { it.onPageShow(page) }
        }
    }

    override fun onActivityPaused(activity: Activity) {
        val page = pages.remove(activity) ?: return
        post { it.onPageHide(page) }
    }

    override fun onActivityStopped(activity: Activity) {
        if (adopted?.get() === activity) adopted = null
        started = maxOf(0, started - 1)
        if (started == 0 && !activity.isChangingConfigurations) post { it.onHide() }
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}

    /** Process start → first Activity resume (API 24+); null when unknown or implausible. */
    private fun coldStartMs(): Long? {
        if (Build.VERSION.SDK_INT < 24) return null
        val ms = SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime()
        return if (ms in 1..59_999) ms else null
    }

    companion object {
        val ignored: MutableSet<String> = Collections.synchronizedSet(HashSet())

        fun screenName(activity: Activity): String? {
            val cls = activity.javaClass
            if (ignored.contains(cls.name)) return null
            val name = cls.getAnnotation(TapCubScreen::class.java)?.value ?: cls.simpleName
            if (name.isEmpty() || ignored.contains(name)) return null
            return name
        }
    }
}

internal fun Application.runOnMain(fn: () -> Unit) {
    if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) fn()
    else android.os.Handler(android.os.Looper.getMainLooper()).post(fn)
}
