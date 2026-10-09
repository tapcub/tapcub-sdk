package com.tapcub.core

// Mirrors packages/app-sdk/src/core/queue.ts: in-memory mirror + storage chunks `tc_q_{n}`, index `tc_q_i`.

private const val CHUNK_ITEMS = 40
private const val IDX = "tc_q_i"
private fun key(n: Int) = "tc_q_$n"

internal class PersistentQueue(
    private val storage: Storage,
    private val limits: QueueLimits,
    private val now: () -> Long,
    private val onError: (String, String) -> Unit,
) {
    private class Chunk(val n: Int, val items: MutableList<JsonObject>, var bytes: Int)

    private val chunks = ArrayList<Chunk>()
    private val mids = HashSet<String>()
    private var first = 0
    private var last = -1
    private var persistent = false

    fun load() {
        persistent = true
        val idx = Json.parseObject(storage.get(IDX))
        val mem = ArrayList(chunks)
        chunks.clear()
        mids.clear()
        val f = idx?.get("f").asNum()
        val l = idx?.get("l").asNum()
        if (f != null && l != null && !f.isNaN() && !l.isNaN() && !f.isInfinite() && !l.isInfinite() && l >= f && l - f < 10000) {
            val minTs = now().toDouble() - limits.maxDays.toDouble() * 86_400_000
            for (n in f.toInt()..l.toInt()) {
                val raw = storage.get(key(n))
                val items = (Json.parseArray(raw) ?: emptyList()).mapNotNull { v ->
                    val p = v.asObj() ?: return@mapNotNull null
                    if (p["mid"] !is String) return@mapNotNull null
                    val ts = p["ts"].asNum()
                    if (ts != null && ts < minTs) null else p
                }
                if (items.isEmpty()) {
                    safeRemove(key(n))
                    continue
                }
                for (p in items) mids.add(p["mid"] as String)
                chunks.add(Chunk(n, items.toMutableList(), raw?.let { byteLength(it) } ?: 0))
            }
            first = f.toInt()
            last = l.toInt()
        }
        if (chunks.isEmpty()) {
            first = 0
            last = -1
        }
        for (c in mem) for (p in c.items) push(p)
        enforce()
        writeIndex()
    }

    fun purge() {
        for (c in chunks) safeRemove(key(c.n))
        safeRemove(IDX)
        chunks.clear()
        mids.clear()
        first = 0
        last = -1
        persistent = false
    }

    val length: Int get() = chunks.sumOf { it.items.size }
    val bytes: Int get() = chunks.sumOf { it.bytes }
    val loaded: Boolean get() = persistent

    fun push(p: JsonObject): Boolean {
        val mid = p["mid"] as? String ?: return false
        if (mids.contains(mid)) return false
        if (chunks.isEmpty() || chunks.last().items.size >= CHUNK_ITEMS) {
            last += 1
            if (chunks.isEmpty()) first = last
            chunks.add(Chunk(last, ArrayList(), 0))
            writeIndex()
        }
        chunks.last().items.add(p)
        mids.add(mid)
        writeChunk(chunks.size - 1)
        enforce()
        return true
    }

    fun peek(): List<JsonObject> {
        val out = ArrayList<JsonObject>()
        var size = 2
        for (c in chunks) {
            for (p in c.items) {
                val b = byteLength(Json.stringify(p)) + 1
                if (out.isNotEmpty() && (out.size >= limits.maxBatch || size + b > limits.maxBytes)) return out
                out.add(p)
                size += b
                if (out.size >= limits.maxBatch) return out
            }
        }
        return out
    }

    fun ack(items: List<JsonObject>) {
        val set = items.mapNotNull { it["mid"] as? String }.toMutableSet()
        var i = 0
        while (i < chunks.size && set.isNotEmpty()) {
            val c = chunks[i]
            val before = c.items.size
            c.items.removeAll { p ->
                val m = p["mid"] as? String
                if (m != null && set.remove(m)) {
                    mids.remove(m)
                    true
                } else false
            }
            if (c.items.size == before) {
                i++
                continue
            }
            if (c.items.isEmpty()) {
                chunks.removeAt(i)
                safeRemove(key(c.n))
                first = chunks.firstOrNull()?.n ?: (last + 1)
                writeIndex()
            } else {
                writeChunk(i)
                i++
            }
        }
    }

    private fun enforce() {
        var dropped = 0
        while (length > limits.maxEvents || bytes > limits.maxStorageBytes) {
            if (chunks.isEmpty()) break
            val head = chunks[0]
            val headCount = head.items.size
            val excess = length - limits.maxEvents
            val take = if (bytes > limits.maxStorageBytes) maxOf(1, Math.ceil(headCount / 2.0).toInt())
            else minOf(maxOf(1, excess), headCount)
            val n = minOf(take, headCount)
            for (j in 0 until n) (head.items[j]["mid"] as? String)?.let { mids.remove(it) }
            repeat(n) { head.items.removeAt(0) }
            dropped += take
            if (head.items.isEmpty()) {
                chunks.removeAt(0)
                safeRemove(key(head.n))
                first = chunks.firstOrNull()?.n ?: (last + 1)
                writeIndex()
            } else {
                writeChunk(0)
            }
        }
        if (dropped > 0) onError("queue_overflow", "dropped $dropped oldest events")
    }

    private fun writeChunk(i: Int) {
        val s = Json.stringify(chunks[i].items)
        chunks[i].bytes = byteLength(s)
        if (!persistent) return
        try {
            storage.set(key(chunks[i].n), s)
        } catch (e: Exception) {
            onError("storage_failed", e.toString())
        }
    }

    private fun writeIndex() {
        if (!persistent) return
        try {
            if (chunks.isNotEmpty()) storage.set(IDX, Json.stringify(jsonObjectOf("f" to first, "l" to last)))
            else storage.remove(IDX)
        } catch (e: Exception) {
            onError("storage_failed", e.toString())
        }
    }

    private fun safeRemove(k: String) {
        if (!persistent) return
        storage.remove(k)
    }
}
