package com.tapcub

import android.annotation.TargetApi
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Process
import com.tapcub.core.CrashEvent
import com.tapcub.core.CrashHook
import com.tapcub.core.Json
import com.tapcub.core.jsonObjectOf
import java.io.File

/**
 * Crash capture. Nothing is sent while the process dies: an uncaught exception is written synchronously to
 * `files/tapcub_crash_pending.json`, then the previous handler runs; the record is reported on the next launch
 * with the original crash time. API 30+: ANRs and native crashes are read from the system exit history.
 */
internal class CrashReporter(private val context: Context, private val worker: Worker) : CrashHook {
    private val file = File(context.filesDir, Brand.CRASH_FILE)
    private val prefs = context.getSharedPreferences(Brand.PREFS, Context.MODE_PRIVATE)
    private var handler: Handler? = null

    override fun enable(cb: (CrashEvent) -> Unit) {
        if (handler != null) return
        val pending = consumePending()
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        val h = Handler(file, previous)
        handler = h
        Thread.setDefaultUncaughtExceptionHandler(h)
        worker.execute {
            pending?.let(cb)
            exitReasons().forEach(cb)
        }
    }

    override fun disable() {
        val h = handler ?: return
        handler = null
        h.active = false
        if (Thread.getDefaultUncaughtExceptionHandler() === h) Thread.setDefaultUncaughtExceptionHandler(h.previous)
    }

    fun consumePending(): CrashEvent? {
        if (!file.exists()) return null
        val o = Json.parseObject(runCatching { file.readText() }.getOrNull())
        file.delete()
        o ?: return null
        return CrashEvent(
            kind = "crash",
            type = o["type"] as? String,
            message = o["message"] as? String,
            stack = o["stack"] as? String,
            fatal = true,
            foreground = o["foreground"] as? Boolean,
            ts = (o["ts"] as? Number)?.toLong(),
        )
    }

    /** ANR / native crash records newer than the last one handled. The first run only sets the mark. */
    private fun exitReasons(): List<CrashEvent> {
        if (Build.VERSION.SDK_INT < 30) return emptyList()
        val am = context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return emptyList()
        val list = try {
            am.getHistoricalProcessExitReasons(context.packageName, 0, 10)
        } catch (_: Exception) {
            return emptyList()
        }
        val mark = prefs.getLong(EXIT_MARK, -1L)
        val newest = list.maxOfOrNull { it.timestamp } ?: 0L
        if (newest > mark) prefs.edit().putLong(EXIT_MARK, newest).apply()
        if (mark < 0) return emptyList()
        return list.filter { it.timestamp > mark }.sortedBy { it.timestamp }.mapNotNull { info ->
            val fg = info.importance <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
            when (info.reason) {
                ApplicationExitInfo.REASON_ANR -> CrashEvent(
                    kind = "anr", type = "ANR", message = info.description ?: "", stack = trace(info),
                    fatal = true, foreground = fg, ts = info.timestamp,
                )
                ApplicationExitInfo.REASON_CRASH_NATIVE -> CrashEvent(
                    kind = "crash", type = "NativeCrash", message = info.description ?: "", stack = null,
                    fatal = true, foreground = fg, ts = info.timestamp,
                )
                else -> null
            }
        }
    }

    @TargetApi(30)
    private fun trace(info: ApplicationExitInfo): String? = try {
        info.traceInputStream?.use { s ->
            val buf = ByteArray(16_384)
            val n = s.read(buf)
            if (n <= 0) null else String(buf, 0, n, Charsets.UTF_8).take(4000)
        }
    } catch (_: Exception) {
        null
    }

    class Handler(private val file: File, val previous: Thread.UncaughtExceptionHandler?) : Thread.UncaughtExceptionHandler {
        @Volatile
        var active = true

        override fun uncaughtException(t: Thread, e: Throwable) {
            if (active) {
                try {
                    write(e)
                } catch (_: Throwable) {
                }
            }
            if (previous != null) {
                previous.uncaughtException(t, e)
            } else {
                Process.killProcess(Process.myPid())
                System.exit(10)
            }
        }

        private fun write(e: Throwable) {
            val json = Json.stringify(jsonObjectOf(
                "type" to e.javaClass.name,
                "message" to (e.message ?: ""),
                "stack" to stack(e),
                "foreground" to true,
                "ts" to System.currentTimeMillis(),
            ))
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(json)
            if (!tmp.renameTo(file)) file.writeText(json)
        }

        /** `at Class.method(File.kt:12)` lines with causes, capped at 4000 chars (core limit). */
        private fun stack(e: Throwable): String {
            val sb = StringBuilder()
            var cur: Throwable? = e
            var depth = 0
            while (cur != null && depth < 5 && sb.length < 4000) {
                if (depth > 0) sb.append("Caused by: ").append(cur.javaClass.name).append(": ").append(cur.message ?: "").append('\n')
                for (f in cur.stackTrace) {
                    sb.append("at ").append(f.className).append('.').append(f.methodName)
                        .append('(').append(f.fileName ?: "Unknown").append(':').append(f.lineNumber).append(")\n")
                    if (sb.length >= 4000) break
                }
                cur = cur.cause
                depth++
            }
            return sb.toString().take(4000)
        }
    }

    companion object {
        private const val EXIT_MARK = "tapcub_exit_mark"
    }
}
