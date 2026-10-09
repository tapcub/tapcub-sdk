package com.tapcub

import android.os.Debug
import android.os.Handler
import android.os.Looper
import android.view.Choreographer

/**
 * One `$fps_sample` + `$memory_sample` per session when `perf` is on (config or `rc.perf`).
 * Field names match what the backend aggregates (`$fps_avg`, `$fps_min`, `$jank_pct`, `$memory_mb`).
 */
internal object PerfSampler {
    /** Samples frames for [seconds] on the main thread; [done] runs on the main thread with the fps payload. */
    fun sampleFps(refreshHz: Float, seconds: Double = 10.0, done: (Map<String, Any?>?) -> Unit) {
        val hz = if (refreshHz in 30f..240f) refreshHz else 60f
        Handler(Looper.getMainLooper()).post { FrameProbe((seconds * 1e9).toLong(), (1e9 / hz).toLong(), done).start() }
    }

    /** Proportional set size in MB; call off the main thread (it takes a few ms). */
    fun memorySample(): Map<String, Any?> = mapOf("\$memory_mb" to (Debug.getPss() / 1024).toInt())

    private class FrameProbe(
        private val durationNs: Long,
        private val expectedNs: Long,
        private val done: (Map<String, Any?>?) -> Unit,
    ) : Choreographer.FrameCallback {
        private var start = 0L
        private var last = 0L
        private var frames = 0
        private var janks = 0
        private var secondStart = 0L
        private var secondFrames = 0
        private var minFps = Int.MAX_VALUE

        fun start() = Choreographer.getInstance().postFrameCallback(this)

        override fun doFrame(frameTimeNanos: Long) {
            if (start == 0L) {
                start = frameTimeNanos
                last = frameTimeNanos
                secondStart = frameTimeNanos
                Choreographer.getInstance().postFrameCallback(this)
                return
            }
            frames++
            secondFrames++
            if (frameTimeNanos - last > expectedNs * 3 / 2) janks++
            last = frameTimeNanos
            if (frameTimeNanos - secondStart >= 1_000_000_000L) {
                minFps = minOf(minFps, secondFrames)
                secondFrames = 0
                secondStart = frameTimeNanos
            }
            val elapsed = frameTimeNanos - start
            if (elapsed >= durationNs) {
                if (frames == 0) { done(null); return }
                val sec = elapsed / 1e9
                val avg = Math.round(frames / sec * 10) / 10.0
                val jank = Math.round(janks.toDouble() / frames * 1000) / 10.0
                done(mapOf("\$fps_avg" to avg, "\$fps_min" to (if (minFps == Int.MAX_VALUE) avg.toInt() else minFps), "\$jank_pct" to jank))
                return
            }
            Choreographer.getInstance().postFrameCallback(this)
        }
    }
}
