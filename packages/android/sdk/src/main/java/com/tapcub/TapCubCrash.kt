package com.tapcub

import android.content.Context
import com.tapcub.core.CrashEvent

/**
 * Crash capture without the analytics core, for hosts whose core runs elsewhere (the React Native bridge runs
 * the TS core in JS). Records are kept until [drain] hands them over; do not combine with [TapCub.preInit],
 * which captures crashes itself.
 */
object TapCubCrash {
    private val lock = Any()
    private var reporter: CrashReporter? = null
    private val pending = ArrayList<CrashEvent>()

    /** Call from `Application.onCreate` so crashes during startup are caught too. Idempotent. */
    @JvmStatic
    fun install(context: Context) {
        synchronized(lock) {
            if (reporter != null) return
            val r = CrashReporter(context.applicationContext, Worker(Brand.WORKER_THREAD))
            reporter = r
            r.enable { ev -> synchronized(lock) { pending.add(ev) } }
        }
    }

    /** Crashes, ANRs and native crashes recorded on earlier launches; each one is returned once. */
    @JvmStatic
    fun drain(): List<Map<String, Any?>> {
        val out = synchronized(lock) {
            val copy = ArrayList(pending)
            pending.clear()
            copy
        }
        return out.map { ev ->
            linkedMapOf(
                "kind" to ev.kind,
                "type" to ev.type,
                "message" to ev.message,
                "stack" to ev.stack,
                "fatal" to ev.fatal,
                "durationMs" to ev.durationMs,
                "foreground" to ev.foreground,
                "ts" to ev.ts,
            )
        }
    }
}
