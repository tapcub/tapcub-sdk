package com.tapcub.core

import java.math.BigDecimal
import java.util.Date

/**
 * JSON with JS semantics. Values are plain Kotlin objects: `null`, Boolean, Number, String,
 * List, and [JsonObject] (insertion-ordered; re-assigning a key keeps its position, like a JS object).
 * A missing key means `undefined`; a key mapped to `null` is JSON `null`.
 */
typealias JsonObject = LinkedHashMap<String, Any?>

fun jsonObjectOf(vararg pairs: Pair<String, Any?>): JsonObject {
    val o = JsonObject()
    for ((k, v) in pairs) o[k] = v
    return o
}

class JsonException(message: String) : Exception(message)

object Json {
    fun stringify(v: Any?): String {
        val sb = StringBuilder()
        write(v, sb)
        return sb.toString()
    }

    private fun write(v: Any?, sb: StringBuilder) {
        when (v) {
            null -> sb.append("null")
            is Boolean -> sb.append(if (v) "true" else "false")
            is Number -> sb.append(formatNumber(v))
            is CharSequence -> quote(v.toString(), sb)
            is Map<*, *> -> {
                sb.append('{')
                var first = true
                for ((k, x) in v) {
                    if (!first) sb.append(',')
                    first = false
                    quote(k.toString(), sb)
                    sb.append(':')
                    write(x, sb)
                }
                sb.append('}')
            }
            is Iterable<*> -> {
                sb.append('[')
                var first = true
                for (x in v) {
                    if (!first) sb.append(',')
                    first = false
                    write(x, sb)
                }
                sb.append(']')
            }
            is Array<*> -> write(v.asList(), sb)
            else -> quote(v.toString(), sb)
        }
    }

    /** `Number.prototype.toString()` for finite numbers; NaN / Infinity become `null` as in JSON.stringify. */
    fun formatNumber(n: Number): String {
        when (n) {
            is Int, is Long, is Short, is Byte -> return n.toString()
        }
        val d = toDouble(n)
        if (d.isNaN() || d.isInfinite()) return "null"
        val a = Math.abs(d)
        if (d == Math.floor(d) && a < 1e21) {
            return if (a < 9.2e18) d.toLong().toString() else BigDecimal(d).toPlainString()
        }
        if (a >= 1e-6 && a < 1e21) return BigDecimal(d.toString()).stripTrailingZeros().toPlainString()
        val s = d.toString()
        val e = s.indexOf('E')
        if (e < 0) return s
        val mant = s.substring(0, e).removeSuffix(".0")
        val exp = s.substring(e + 1).toInt()
        return mant + "e" + (if (exp >= 0) "+" else "") + exp
    }

    /** Float goes through its decimal string so `9.9f` stays `9.9`, as a JS caller would expect. */
    fun toDouble(n: Number): Double = if (n is Float) n.toString().toDouble() else n.toDouble()

    private fun quote(s: String, sb: StringBuilder) {
        sb.append('"')
        for (c in s) {
            when (c) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                else -> if (c < ' ') sb.append(String.format("\\u%04x", c.code)) else sb.append(c)
            }
        }
        sb.append('"')
    }

    /** Throws [JsonException] on malformed input. Numbers parse as Double, objects as [JsonObject]. */
    fun parse(text: String): Any? {
        val p = Parser(text)
        val v = p.value()
        p.ws()
        if (p.i != text.length) throw JsonException("trailing data at ${p.i}")
        return v
    }

    fun parseObject(text: String?): JsonObject? {
        if (text.isNullOrEmpty()) return null
        return try {
            @Suppress("UNCHECKED_CAST")
            parse(text) as? JsonObject
        } catch (_: JsonException) {
            null
        }
    }

    fun parseArray(text: String?): List<Any?>? {
        if (text.isNullOrEmpty()) return null
        return try {
            parse(text) as? List<Any?>
        } catch (_: JsonException) {
            null
        }
    }

    /**
     * Converts host values to JSON values: maps keep their iteration order, Float goes through its
     * decimal string, dates become epoch ms, anything else unknown becomes its `toString()`.
     */
    fun box(v: Any?): Any? = when (v) {
        null -> null
        is Boolean, is String -> v
        is Float -> toDouble(v)
        is Number -> v
        is Char -> v.toString()
        is CharSequence -> v.toString()
        is Map<*, *> -> {
            val o = JsonObject()
            for ((k, x) in v) if (k != null) o[k.toString()] = box(x)
            o
        }
        is Iterable<*> -> v.map { box(it) }
        is Array<*> -> v.map { box(it) }
        is IntArray -> v.toList()
        is LongArray -> v.toList()
        is DoubleArray -> v.toList()
        is BooleanArray -> v.toList()
        is Date -> v.time
        is Enum<*> -> v.name
        else -> v.toString()
    }

    fun boxObject(m: Map<String, Any?>?): JsonObject? = if (m == null) null else box(m) as JsonObject

    /** Structural equality with JS number semantics (1 == 1.0) and key order ignored. */
    fun equal(a: Any?, b: Any?): Boolean = when {
        a == null || b == null -> a == null && b == null
        a is Number && b is Number -> toDouble(a) == toDouble(b)
        a is Map<*, *> && b is Map<*, *> -> a.size == b.size && a.all { (k, v) -> b.containsKey(k) && equal(v, b[k]) }
        a is List<*> && b is List<*> -> a.size == b.size && a.indices.all { equal(a[it], b[it]) }
        else -> a == b
    }

    private class Parser(val s: String) {
        var i = 0

        fun ws() {
            while (i < s.length && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++
        }

        fun value(): Any? {
            ws()
            if (i >= s.length) throw JsonException("unexpected end")
            return when (s[i]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> literal("true", true)
                'f' -> literal("false", false)
                'n' -> literal("null", null)
                else -> num()
            }
        }

        private fun literal(w: String, v: Any?): Any? {
            if (!s.startsWith(w, i)) throw JsonException("bad literal at $i")
            i += w.length
            return v
        }

        private fun obj(): JsonObject {
            i++
            val o = JsonObject()
            ws()
            if (i < s.length && s[i] == '}') { i++; return o }
            while (i < s.length) {
                ws()
                if (i >= s.length || s[i] != '"') throw JsonException("expected key at $i")
                val k = str()
                ws()
                if (i >= s.length || s[i] != ':') throw JsonException("expected : at $i")
                i++
                o[k] = value()
                ws()
                if (i >= s.length) break
                if (s[i] == ',') { i++; continue }
                if (s[i] == '}') { i++; return o }
                throw JsonException("expected , or } at $i")
            }
            throw JsonException("unterminated object")
        }

        private fun arr(): List<Any?> {
            i++
            val a = ArrayList<Any?>()
            ws()
            if (i < s.length && s[i] == ']') { i++; return a }
            while (i < s.length) {
                a.add(value())
                ws()
                if (i >= s.length) break
                if (s[i] == ',') { i++; continue }
                if (s[i] == ']') { i++; return a }
                throw JsonException("expected , or ] at $i")
            }
            throw JsonException("unterminated array")
        }

        private fun str(): String {
            i++
            val sb = StringBuilder()
            while (i < s.length) {
                val c = s[i]
                if (c == '"') { i++; return sb.toString() }
                if (c == '\\') {
                    if (i + 1 >= s.length) break
                    val e = s[i + 1]
                    i += 2
                    when (e) {
                        'n' -> sb.append('\n')
                        'r' -> sb.append('\r')
                        't' -> sb.append('\t')
                        'b' -> sb.append('\b')
                        'f' -> sb.append('\u000C')
                        'u' -> {
                            if (i + 4 > s.length) throw JsonException("bad escape")
                            sb.append(s.substring(i, i + 4).toIntOrNull(16)?.toChar() ?: throw JsonException("bad escape"))
                            i += 4
                        }
                        else -> sb.append(e)
                    }
                } else {
                    sb.append(c)
                    i++
                }
            }
            throw JsonException("unterminated string")
        }

        private fun num(): Double {
            val start = i
            while (i < s.length && (s[i] in '0'..'9' || s[i] == '-' || s[i] == '+' || s[i] == '.' || s[i] == 'e' || s[i] == 'E')) i++
            if (i == start) throw JsonException("unexpected char at $i")
            return s.substring(start, i).toDoubleOrNull() ?: throw JsonException("bad number")
        }
    }
}

internal fun Any?.asStr(): String? = this as? String
internal fun Any?.asNum(): Double? = (this as? Number)?.let { Json.toDouble(it) }
internal fun Any?.asBool(): Boolean? = this as? Boolean
@Suppress("UNCHECKED_CAST")
internal fun Any?.asObj(): JsonObject? = this as? JsonObject
internal fun Any?.asList(): List<Any?>? = this as? List<Any?>
