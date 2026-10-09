package com.tapcub

import android.app.Activity
import android.content.res.Resources
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.Window
import android.widget.EditText
import android.widget.TextView
import com.tapcub.core.AutoTrackHook
import com.tapcub.core.Element
import com.tapcub.core.PageInfo
import java.util.WeakHashMap

/**
 * `$app_click` for Views: each Activity's Window.Callback is wrapped once; on a tap (down and up close
 * together) the deepest visible, enabled, clickable View under the finger is reported.
 * Dialogs, popups and Compose content are not covered; use `TapCub.track` there.
 */
internal class AutoTrack(private val worker: Worker) : AutoTrackHook {
    @Volatile
    private var cb: ((Element, PageInfo?) -> Unit)? = null
    private val wrapped = WeakHashMap<Window, Boolean>()

    override fun enable(cb: (Element, PageInfo?) -> Unit) {
        this.cb = cb
    }

    override fun disable() {
        cb = null
    }

    /** Called on the main thread from the lifecycle adapter. */
    fun attach(activity: Activity) {
        val window = activity.window ?: return
        if (wrapped[window] == true) return
        val inner = window.callback ?: return
        wrapped[window] = true
        window.callback = TapCallback(inner, activity)
    }

    private inner class TapCallback(inner: Window.Callback, activity: Activity) : WindowCallbackWrapper(inner) {
        private val activityRef = java.lang.ref.WeakReference(activity)
        private val slop = ViewConfiguration.get(activity).scaledTouchSlop
        private var downX = 0f
        private var downY = 0f
        private var downAt = 0L

        override fun dispatchTouchEvent(event: MotionEvent): Boolean {
            if (cb != null) {
                try {
                    observe(event)
                } catch (_: Throwable) {
                }
            }
            return super.dispatchTouchEvent(event)
        }

        private fun observe(e: MotionEvent) {
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX
                    downY = e.rawY
                    downAt = e.eventTime
                }
                MotionEvent.ACTION_UP -> {
                    if (Math.abs(e.rawX - downX) > slop || Math.abs(e.rawY - downY) > slop) return
                    if (e.eventTime - downAt > ViewConfiguration.getLongPressTimeout()) return
                    val activity = activityRef.get() ?: return
                    val root = activity.window?.decorView ?: return
                    val view = hit(root, e.rawX.toInt(), e.rawY.toInt()) ?: return
                    if (ignoredUp(view)) return
                    report(activity, view)
                }
            }
        }
    }

    private fun report(activity: Activity, view: View) {
        val page = AppLifecycle.screenName(activity)?.let { PageInfo(it) }
        val el = Element(type = widgetType(view), id = elementId(view), content = content(view), path = path(activity, view))
        val c = cb ?: return
        worker.execute { c(el, page) }
    }

    companion object {
        private val loc = IntArray(2)

        /** Deepest visible, enabled, clickable view containing the point; later children are on top. */
        fun hit(v: View, x: Int, y: Int): View? {
            if (v.visibility != View.VISIBLE || v.alpha <= 0f) return null
            v.getLocationOnScreen(loc)
            if (x < loc[0] || y < loc[1] || x >= loc[0] + v.width || y >= loc[1] + v.height) return null
            if (v is ViewGroup) {
                for (i in v.childCount - 1 downTo 0) {
                    hit(v.getChildAt(i), x, y)?.let { return it }
                }
            }
            return if (v.isEnabled && (v.isClickable || v.hasOnClickListeners())) v else null
        }

        fun ignoredUp(view: View): Boolean {
            var v: View? = view
            while (v != null) {
                if (v.getTag(R.id.tapcub_ignore_clicks) == true) return true
                v = v.parent as? View
            }
            return false
        }

        /** Nearest framework class name, so `MaterialButton` / `AppCompatButton` report `Button`. */
        fun widgetType(view: View): String {
            var c: Class<*>? = view.javaClass
            while (c != null) {
                val n = c.name
                if (n.startsWith("android.widget.") || n.startsWith("android.view.")) return c.simpleName
                c = c.superclass
            }
            return view.javaClass.simpleName
        }

        fun elementId(view: View): String? {
            (view.getTag(R.id.tapcub_element_id) as? String)?.let { return it }
            return resourceName(view)
        }

        private fun resourceName(view: View): String? {
            if (view.id == View.NO_ID || (view.id ushr 24) == 0) return null
            return try {
                view.resources.getResourceEntryName(view.id)
            } catch (_: Resources.NotFoundException) {
                null
            }
        }

        /** Visible text of buttons and labels; never the content of an input field. */
        fun content(view: View): String? {
            if (view is EditText) return null
            val text = (view as? TextView)?.text?.toString()?.trim()
            if (!text.isNullOrEmpty()) return text.take(200)
            return view.contentDescription?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.take(200)
        }

        /** `Activity/id_or_Class[index]/…` from the content root down to the view. */
        fun path(activity: Activity, view: View): String {
            val parts = ArrayList<String>()
            var v: View? = view
            while (v != null && v.id != android.R.id.content) {
                val parent = v.parent as? ViewGroup
                val name = resourceName(v) ?: run {
                    val cls = v.javaClass
                    var idx = 0
                    if (parent != null) {
                        for (i in 0 until parent.childCount) {
                            val c = parent.getChildAt(i)
                            if (c === v) break
                            if (c.javaClass == cls) idx++
                        }
                    }
                    "${cls.simpleName}[$idx]"
                }
                parts.add(name)
                v = parent
            }
            parts.add(activity.javaClass.simpleName)
            return parts.asReversed().joinToString("/").take(120)
        }
    }
}
