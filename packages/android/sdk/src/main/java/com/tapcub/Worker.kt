package com.tapcub

import android.util.Log
import com.tapcub.core.Timers
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.ScheduledThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** The single thread that owns all core state. Tasks never throw into the host app. */
internal class Worker(name: String = Brand.WORKER_THREAD) {
    private val executor = ScheduledThreadPoolExecutor(1) { r ->
        Thread(r, name).apply { isDaemon = true }
    }.apply { removeOnCancelPolicy = true }

    @Volatile
    var thread: Thread? = null
        private set

    init {
        executor.execute { thread = Thread.currentThread() }
    }

    val isCurrent: Boolean get() = Thread.currentThread() === thread

    fun execute(fn: () -> Unit) {
        executor.execute { guard(fn) }
    }

    fun schedule(ms: Long, fn: () -> Unit): ScheduledFuture<*> =
        executor.schedule({ guard(fn) }, maxOf(0L, ms), TimeUnit.MILLISECONDS)

    fun scheduleRepeating(ms: Long, fn: () -> Unit): ScheduledFuture<*> {
        val p = maxOf(1L, ms)
        return executor.scheduleWithFixedDelay({ guard(fn) }, p, p, TimeUnit.MILLISECONDS)
    }

    private fun guard(fn: () -> Unit) {
        try {
            fn()
        } catch (t: Throwable) {
            Log.e(Brand.LOG_TAG, "internal error", t)
        }
    }
}

/** Core timers on the worker thread; wall-clock `now()` and `SecureRandom`. */
internal class WorkerTimers(private val worker: Worker) : Timers {
    private val seq = AtomicInteger()
    private val tasks = ConcurrentHashMap<Int, ScheduledFuture<*>>()
    private val rng = SecureRandom()

    override fun now(): Long = System.currentTimeMillis()

    override fun setTimeout(ms: Long, fn: () -> Unit): Int {
        val id = seq.incrementAndGet()
        tasks[id] = worker.schedule(ms) {
            tasks.remove(id)
            fn()
        }
        return id
    }

    override fun clearTimeout(id: Int) {
        tasks.remove(id)?.cancel(false)
    }

    override fun setInterval(ms: Long, fn: () -> Unit): Int {
        val id = seq.incrementAndGet()
        tasks[id] = worker.scheduleRepeating(ms, fn)
        return id
    }

    override fun clearInterval(id: Int) = clearTimeout(id)

    override fun random(): Double = rng.nextDouble()
}
