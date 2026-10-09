package com.tapcub.core

import java.security.MessageDigest

// Mirrors packages/app-sdk/src/core/util.ts. Kotlin strings are UTF-16, so `length` / `substring`
// already match JS `length` / `slice`.

internal object Limits {
    const val NAME = 100
    const val PROP_KEY = 50
    const val PROP_VALUE = 200
    const val PROP_KEYS = 30
    const val PRESET_PROP_KEYS = 40
    const val PROFILE_KEYS = 50
    const val STACK = 4000
    const val MESSAGE = 1000
    const val URL = 4000
    const val TITLE = 200
}

internal const val LOGIN_ID_MAX = 200

internal val BLOCKED_ID_RE = Regex("^([0-]*|-1|null|undefined|NaN|anonymous|guest|true|false|\\[object Object\\])$", RegexOption.IGNORE_CASE)
internal val DEVICE_ID_RE = Regex("^(web_cookie|web_cookieless|mp_openid|mp_uuid|ios_idfv|android_id|harmony_odid|custom):[A-Za-z0-9_-]{8,64}$")
internal val HEX64 = Regex("^[a-f0-9]{64}$", RegexOption.IGNORE_CASE)

internal fun String.jsSlice(n: Int): String = if (length <= n) this else substring(0, maxOf(0, n))

/** JS `String.prototype.trim`. */
internal fun String.jsTrim(): String = trim { it.isWhitespace() || it == '\uFEFF' }

/** JS `Math.round`. */
internal fun jsRound(x: Double): Double = Math.floor(x + 0.5)

/** JS `Number(v)` for values the remote config can carry. */
internal fun jsNumber(v: Any?): Double = when (v) {
    is Number -> Json.toDouble(v)
    is String -> v.jsTrim().let { if (it.isEmpty()) 0.0 else it.toDoubleOrNull() ?: Double.NaN }
    else -> Double.NaN
}

internal fun clampInt(v: Any?, lo: Int, hi: Int, d: Int): Int {
    var n = when (v) {
        is Number -> Json.toDouble(v)
        is String -> jsNumber(v)
        else -> Double.NaN
    }
    if (n.isNaN() || n.isInfinite()) return d
    n = jsRound(n)
    return minOf(hi.toDouble(), maxOf(lo.toDouble(), n)).toInt()
}

internal fun strList(v: Any?, max: Int, len: Int): List<String> =
    (v as? List<*>)?.filterIsInstance<String>()?.filter { it.isNotEmpty() && it.length <= len }?.take(max) ?: emptyList()

private val SEMVER_RE = Regex("^\\d+\\.\\d+\\.\\d+$")

internal fun normalizeRc(raw: Any?): RemoteConfig {
    val r = raw.asObj() ?: JsonObject()
    val d = RemoteConfig()
    val mv = (r["minVersion"] as? String)?.jsTrim()?.takeIf { SEMVER_RE.containsMatchIn(it) }
    return RemoteConfig(
        enabled = r["enabled"] != false,
        blacklist = strList(r["blacklist"], 50, 100),
        sample = clampInt(r["sample"], 1, 100, d.sample),
        interval = clampInt(r["interval"], 10, 1800, d.interval),
        threshold = clampInt(r["threshold"], 10, 1000, d.threshold),
        deviceBlacklist = strList(r["deviceBlacklist"], 50, 80),
        requireConsent = r["requireConsent"] == true,
        autotrack = r["autotrack"] != false,
        textCapture = r["textCapture"] == true,
        elementBlacklist = strList(r["elementBlacklist"], 50, 120),
        perf = r["perf"] == true,
        minVersion = mv,
        ttl = clampInt(r["ttl"], 300, 604800, d.ttl),
    )
}

/** JS `parseInt(x, 10) || 0`. */
private fun leadingInt(s: String): Int {
    var t = s.jsTrim()
    var sign = 1
    if (t.startsWith("-")) { sign = -1; t = t.substring(1) } else if (t.startsWith("+")) t = t.substring(1)
    val digits = t.takeWhile { it in '0'..'9' }
    return (digits.toIntOrNull() ?: 0) * sign
}

internal fun compareSemver(a: String, b: String): Int {
    val pa = a.split(".").map { leadingInt(it) }
    val pb = b.split(".").map { leadingInt(it) }
    for (i in 0 until 3) {
        val d = (pa.getOrNull(i) ?: 0) - (pb.getOrNull(i) ?: 0)
        if (d != 0) return if (d < 0) -1 else 1
    }
    return 0
}

private val HEX = "0123456789abcdef".toCharArray()

internal fun hex(bytes: ByteArray): String {
    val sb = StringBuilder(bytes.size * 2)
    for (b in bytes) {
        val v = b.toInt() and 0xff
        sb.append(HEX[v ushr 4]).append(HEX[v and 15])
    }
    return sb.toString()
}

internal fun randomHex(random: () -> Double, n: Int): String {
    val a = ByteArray(n)
    for (i in 0 until n) a[i] = (Math.floor(random() * 256).toInt() and 255).toByte()
    return hex(a)
}

internal fun uuidV4(random: () -> Double): String {
    val h = randomHex(random, 16).toCharArray()
    h[12] = '4'
    h[16] = HEX[(Character.digit(h[16], 16) and 3) or 8]
    val s = String(h)
    return "${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-${s.substring(16, 20)}-${s.substring(20, 32)}"
}

/** FNV-1a 32-bit over UTF-16 code units (sampling by device id). Returned as an unsigned value. */
internal fun fnv1a(s: String): Long {
    var h = 0x811c9dc5.toInt()
    for (c in s) {
        h = h xor c.code
        h *= 0x01000193
    }
    return h.toLong() and 0xffffffffL
}

internal fun sha256(text: String): String =
    hex(MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)))

private val SPACES_DASHES = Regex("[\\s-]")

internal fun normId(t: String, v: String): String = when (t) {
    "email" -> v.jsTrim().lowercase()
    "mobile" -> SPACES_DASHES.replace(v, "")
    else -> v.jsTrim()
}

/** Property normalization: keys ≤ 50, values ≤ 200; `$` preset keys and user keys counted separately. */
internal fun normProps(input: Map<String, Any?>?, userMax: Int = Limits.PROP_KEYS, presetMax: Int = Limits.PRESET_PROP_KEYS): JsonObject? {
    if (input == null) return null
    val out = JsonObject()
    var user = 0
    var preset = 0
    for ((k, v) in input) {
        if (v == null || k.isEmpty() || k.length > Limits.PROP_KEY) continue
        if (k.startsWith("$")) {
            if (preset >= presetMax) continue
            preset++
        } else {
            if (user >= userMax) continue
            user++
        }
        out[k] = when (v) {
            is String -> v.jsSlice(Limits.PROP_VALUE)
            is Number -> Json.toDouble(v).let { if (it.isNaN() || it.isInfinite()) 0 else v }
            is Boolean -> v
            else -> Json.stringify(v).jsSlice(Limits.PROP_VALUE)
        }
    }
    return out
}

internal fun byteLength(s: String): Int {
    var n = 0
    var i = 0
    while (i < s.length) {
        val c = s[i]
        n += when {
            c.code < 0x80 -> 1
            c.code < 0x800 -> 2
            Character.isHighSurrogate(c) && i + 1 < s.length && Character.isLowSurrogate(s[i + 1]) -> { i++; 4 }
            else -> 3
        }
        i++
    }
    return n
}

/** JS `encodeURIComponent`. */
internal fun encodeURIComponent(s: String): String {
    val sb = StringBuilder()
    for (b in s.toByteArray(Charsets.UTF_8)) {
        val c = b.toInt() and 0xff
        val ch = c.toChar()
        if (ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || "-_.!~*'()".indexOf(ch) >= 0) sb.append(ch)
        else sb.append('%').append(HEX[c ushr 4].uppercaseChar()).append(HEX[c and 15].uppercaseChar())
    }
    return sb.toString()
}

/** Deterministic PRNG used by the test vectors (same as mock.mjs `mulberry32`). */
class Mulberry32(seed: Long) {
    private var a: Int = seed.toInt()
    fun next(): Double {
        a += 0x6d2b79f5
        var t = a
        t = (t xor (t ushr 15)) * (t or 1)
        t = t xor (t + ((t xor (t ushr 7)) * (t or 61)))
        return ((t xor (t ushr 14)).toLong() and 0xffffffffL).toDouble() / 4294967296.0
    }
}
