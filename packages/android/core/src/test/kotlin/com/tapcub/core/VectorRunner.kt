package com.tapcub.core

// Kotlin port of packages/app-sdk/test/{mock,runner}.mjs. Same vectors, same matcher tokens.

class VectorError(message: String) : Exception(message)

class VectorMock(v: JsonObject) {
    val start: Long = (v["now"].asNum() ?: 1_700_000_000_000.0).toLong()
    var now = start
    private var seq = 0
    private class Timer(var at: Long, val fn: () -> Unit, val every: Long)
    private val timers = LinkedHashMap<Int, Timer>()
    val deferred = ArrayList<() -> Unit>()
    private val rng = Mulberry32((v["seed"].asNum() ?: 42.0).toLong())

    val store = HashMap<String, String>()
    var storageFail = false

    var cfgScript: Any? = v["cfg"] ?: jsonObjectOf("t" to 3.0, "i" to 1.0, "cs" to jsonObjectOf("req" to false))
    var collect: Any? = v["collect"] ?: 202.0
    var collectSeq: MutableList<Any?>? = v["collect"].asList()?.toMutableList()

    class Request(val url: String, val body: JsonObject?, val at: Long, val bytes: Int)
    val requests = ArrayList<Request>()
    var cfgRequests = 0

    var handlers: LifecycleHandlers? = null
    var deviceReads = 0
    var autoCb: ((Element, PageInfo?) -> Unit)? = null
    var crashCb: ((CrashEvent) -> Unit)? = null
    val platform: String = v["platform"] as? String ?: "android"
    val nativeDeviceId: String? = v["nativeDeviceId"] as? String

    init {
        v["storage"].asObj()?.forEach { (k, x) -> store[k] = x as? String ?: Json.stringify(x) }
    }

    fun drain() {
        var guard = 0
        while (deferred.isNotEmpty() && guard < 100_000) {
            deferred.removeAt(0)()
            guard++
        }
    }

    fun clearTimers() = timers.clear()

    fun advance(ms: Long) {
        val target = now + ms
        while (true) {
            val next = timers.entries.filter { it.value.at <= target }
                .minWithOrNull(compareBy<MutableMap.MutableEntry<Int, Timer>> { it.value.at }.thenBy { it.key }) ?: break
            val t = next.value
            now = maxOf(now, t.at)
            if (t.every > 0) t.at += t.every else timers.remove(next.key)
            t.fn()
            drain()
        }
        now = target
        drain()
    }

    private fun respond(script: Any?, cb: (Result<TransportResponse>) -> Unit) {
        val r: Result<TransportResponse> = when (script) {
            "fail" -> Result.failure(VectorError("network"))
            is Number -> Result.success(TransportResponse(script.toInt(), ""))
            else -> Result.success(TransportResponse(200, Json.stringify(script)))
        }
        deferred.add { cb(r) }
    }

    fun adapters() = Adapters(
        storage = object : Storage {
            override fun get(key: String) = store[key]
            override fun set(key: String, value: String) {
                if (storageFail) throw VectorError("storage quota")
                store[key] = value
            }
            override fun remove(key: String) { store.remove(key) }
        },
        transport = object : Transport {
            override fun get(url: String, cb: (Result<TransportResponse>) -> Unit) {
                cfgRequests++
                respond(cfgScript, cb)
            }
            override fun post(url: String, body: String, headers: Map<String, String>, cb: (Result<TransportResponse>) -> Unit) {
                requests.add(Request(url, Json.parseObject(body), now, byteLength(body)))
                var script = collect
                val s = collectSeq
                if (s != null) script = if (s.size > 1) s.removeAt(0) else s[0]
                respond(script, cb)
            }
        },
        lifecycle = object : Lifecycle {
            override fun bind(handlers: LifecycleHandlers) { this@VectorMock.handlers = handlers }
        },
        device = object : DeviceInfo {
            override val platform get() = this@VectorMock.platform
            override fun read(): DeviceSnapshot {
                deviceReads++
                return DeviceSnapshot("Android", "14", "Google", "Pixel 8", "phone", 1080, 2400, 2.75, "zh-CN", "Asia/Shanghai", "14")
            }
            override fun networkType(cb: (String?) -> Unit) { deferred.add { cb("wifi") } }
            override fun deviceId() = nativeDeviceId
        },
        timers = object : Timers {
            override fun now() = this@VectorMock.now
            override fun setTimeout(ms: Long, fn: () -> Unit): Int {
                seq++
                timers[seq] = Timer(now + maxOf(0, ms), fn, 0)
                return seq
            }
            override fun clearTimeout(id: Int) { timers.remove(id) }
            override fun setInterval(ms: Long, fn: () -> Unit): Int {
                seq++
                timers[seq] = Timer(now + maxOf(1, ms), fn, maxOf(1, ms))
                return seq
            }
            override fun clearInterval(id: Int) { timers.remove(id) }
            override fun random() = rng.next()
        },
        autoTrack = object : AutoTrackHook {
            override fun enable(cb: (Element, PageInfo?) -> Unit) { autoCb = cb }
            override fun disable() { autoCb = null }
        },
        crash = object : CrashHook {
            override fun enable(cb: (CrashEvent) -> Unit) { crashCb = cb }
            override fun disable() { crashCb = null }
        },
    )
}

class Matcher {
    private val vars = HashMap<String, Any?>()
    private val uuidRe = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    private val didRe = Regex("^(web_cookie|web_cookieless|mp_openid|mp_uuid|ios_idfv|android_id|harmony_odid|custom):[A-Za-z0-9_-]{8,64}$")

    /** `present == false` means the actual value is `undefined` (missing key). */
    fun match(expected: Any?, actual: Any?, present: Boolean, path: String, out: MutableList<String>) {
        if (expected is String && expected.startsWith("<") && expected.endsWith(">")) {
            token(expected.substring(1, expected.length - 1), actual, present, path, out)
            return
        }
        when (expected) {
            is List<*> -> {
                val a = actual as? List<*>
                if (a == null) { out.add("$path: expected array, got ${desc(actual, present)}"); return }
                if (expected.size != a.size) { out.add("$path: expected ${expected.size} items, got ${a.size}"); return }
                expected.forEachIndexed { i, x -> match(x, a[i], true, "$path[$i]", out) }
            }
            is Map<*, *> -> {
                val a = actual as? Map<*, *>
                if (a == null) { out.add("$path: expected object, got ${desc(actual, present)}"); return }
                for ((k, x) in expected) match(x, a[k], a.containsKey(k), "$path.$k", out)
            }
            else -> if (!present || !Json.equal(expected, actual)) out.add("$path: expected ${Json.stringify(expected)}, got ${desc(actual, present)}")
        }
    }

    private fun desc(v: Any?, present: Boolean) = if (!present) "undefined" else Json.stringify(v)

    private fun token(t: String, actual: Any?, present: Boolean, path: String, out: MutableList<String>) {
        fun fail(why: String) { out.add("$path: $why (got ${desc(actual, present)})") }
        val str = actual as? String
        when (t) {
            "any" -> if (!present) fail("expected present")
            "absent" -> if (present) fail("expected absent")
            "uuid" -> if (str == null || !uuidRe.containsMatchIn(str)) fail("expected uuid v4")
            "ts", "num" -> if (actual.asNum()?.let { !it.isNaN() && !it.isInfinite() } != true) fail("expected number")
            "str" -> if (str.isNullOrEmpty()) fail("expected non-empty string")
            "bool" -> if (actual !is Boolean) fail("expected boolean")
            "hex64" -> if (str == null || !Regex("^[a-f0-9]{64}$").containsMatchIn(str)) fail("expected sha256 hex")
            "did" -> if (str == null || !didRe.containsMatchIn(str)) fail("expected device id")
            "sid" -> if (str == null || !Regex("^[A-Za-z0-9]{8,32}$").containsMatchIn(str)) fail("expected session id")
            else -> when {
                t.startsWith("did:") -> {
                    val prefix = t.substring(4) + ":"
                    if (str == null || !didRe.containsMatchIn(str) || !str.startsWith(prefix)) fail("expected device id with prefix $prefix")
                }
                t.startsWith("re:") -> if (str == null || !Regex(t.substring(3)).containsMatchIn(str)) fail("expected /${t.substring(3)}/")
                t.startsWith("$") -> {
                    if (!present) { fail("expected present (capture)"); return }
                    if (vars.containsKey(t)) {
                        if (Json.stringify(vars[t]) != Json.stringify(actual)) fail("expected same as $t=${Json.stringify(vars[t])}")
                    } else vars[t] = actual
                }
                t.startsWith("!$") -> {
                    val name = t.substring(1)
                    if (!present) { fail("expected present"); return }
                    if (!vars.containsKey(name)) { fail("$name not captured yet"); return }
                    if (Json.stringify(vars[name]) == Json.stringify(actual)) fail("expected different from $name")
                }
                else -> if (actual != "<$t>") out.add("$path: expected \"<$t>\", got ${desc(actual, present)}")
            }
        }
    }
}

object VectorRunner {
    fun run(v: JsonObject): List<String> {
        val m = VectorMock(v)
        val errors = ArrayList<String>()
        val sessions = ArrayList<Any?>()
        val consents = ArrayList<Any?>()
        val out = ArrayList<String>()
        val mt = Matcher()

        fun boot(): TapCubCore {
            val sdk = TapCubCore(m.adapters())
            sdk.onError { code, _ -> errors.add(code) }
            sdk.onSessionStart { sid, reason -> sessions.add(jsonObjectOf("sid" to sid, "reason" to reason)) }
            sdk.onConsentChange { c -> consents.add(c) }
            if (!(v.containsKey("config") && v["config"] == null)) {
                val c = jsonObjectOf("siteKey" to "k_vector_site", "endpoint" to "https://c.test", "appId" to "wxvector")
                v["config"].asObj()?.let { c.putAll(it) }
                sdk.preInit(TapCubConfig.fromJson(c))
            }
            return sdk
        }
        var sdk = boot()

        for (step in v["steps"].asList() ?: emptyList()) {
            val s = step.asObj() ?: continue
            val call = s["call"] as? String
            when {
                call != null -> {
                    val (present, value) = dispatch(sdk, call, s["args"].asList() ?: emptyList(), m)
                    if (s.containsKey("expect")) mt.match(s["expect"], value, present, "call $call() return", out)
                }
                s["advance"] is Number -> m.advance(s["advance"].asNum()!!.toLong())
                s.containsKey("restart") -> {
                    m.clearTimers()
                    sdk = boot()
                }
                s["tap"] is Map<*, *> -> {
                    val tap = s["tap"].asObj()!!
                    val page = (s["page"] as? String)?.let { PageInfo(it) }
                    m.autoCb?.invoke(Element(tap["type"] as? String, tap["id"] as? String, tap["content"] as? String, tap["path"] as? String), page)
                }
                s["crash"] is Map<*, *> -> {
                    val c = s["crash"].asObj()!!
                    m.crashCb?.invoke(CrashEvent(
                        c["kind"] as? String ?: "crash", c["type"] as? String, c["message"] as? String, c["stack"] as? String,
                        c["fatal"] as? Boolean, c["durationMs"].asNum()?.toLong(), c["foreground"] as? Boolean, c["ts"].asNum()?.toLong(),
                    ))
                }
                s["lifecycle"] is String -> {
                    val h = m.handlers ?: throw VectorError("lifecycle not bound (preInit not called)")
                    val info = launchInfo(s["info"].asObj())
                    when (s["lifecycle"]) {
                        "launch" -> h.onLaunch(info)
                        "show" -> h.onShow(info)
                        "hide" -> h.onHide()
                        else -> throw VectorError("unknown lifecycle ${s["lifecycle"]}")
                    }
                }
                s["page"] is String -> {
                    val h = m.handlers ?: throw VectorError("lifecycle not bound")
                    val info = PageInfo(s["path"] as? String ?: "", strMap(s["query"].asObj()), s["title"] as? String)
                    if (s["page"] == "show") h.onPageShow(info) else h.onPageHide(info)
                }
                s.containsKey("share") -> m.handlers?.onShare(PageInfo(s["path"] as? String ?: "pages/index/index"), s["share"] as? String ?: "")
                s.containsKey("favorite") -> Unit
                s["net"] is Map<*, *> -> {
                    val net = s["net"].asObj()!!
                    if (net.containsKey("cfg")) m.cfgScript = net["cfg"]
                    if (net.containsKey("collect")) {
                        m.collect = net["collect"]
                        m.collectSeq = net["collect"].asList()?.toMutableList()
                    }
                }
                s.containsKey("storageFail") -> m.storageFail = truthy(s["storageFail"])
                else -> throw VectorError("unknown step ${Json.stringify(step)}")
            }
            m.drain()
        }

        val e = v["expect"].asObj() ?: JsonObject()
        val items: List<Any?> = m.requests.flatMap { it.body?.get("items").asList() ?: emptyList() }
        fun check(key: String, actual: Any?) { if (e.containsKey(key)) mt.match(e[key], actual, true, key, out) }
        check("items", items)
        if (e.containsKey("itemNames")) {
            val names = items.map { i ->
                val o = i.asObj()
                if (o?.get("t") == "id") "id:${o["op"] as? String ?: ""}" else o?.get("n")
            }
            check("itemNames", names)
        }
        if (e.containsKey("requests")) {
            check("requests", m.requests.map { r ->
                val o = JsonObject()
                o["url"] = r.url
                r.body?.let { b ->
                    if (b.containsKey("sent")) o["sent"] = b["sent"]
                    if (b.containsKey("items")) o["items"] = b["items"]
                    b["items"].asList()?.let { o["count"] = it.size }
                }
                o["bytes"] = r.bytes
                o["at"] = r.at - m.start
                o
            })
        }
        check("requestCount", m.requests.size)
        check("cfgRequests", m.cfgRequests)
        check("deviceReads", m.deviceReads)
        if (e.containsKey("state")) check("state", sdk.getState().toJson())
        check("errors", errors)
        e["errorsInclude"].asList()?.forEach { c -> if (!errors.contains(c as? String)) out.add("errors: expected to include ${Json.stringify(c)}, got $errors") }
        check("sessions", sessions)
        check("consents", consents)
        val dump = JsonObject()
        for (k in m.store.keys.sorted()) dump[k] = m.store[k]
        check("storage", dump)
        check("storageKeys", dump.keys.toList())
        return out
    }

    private fun strMap(o: JsonObject?): Map<String, String>? = o?.mapValues { (_, v) -> v as? String ?: Json.stringify(v) }

    private fun launchInfo(o: JsonObject?) = LaunchInfo(o?.get("scene"), o?.get("path") as? String, strMap(o?.get("query").asObj()) ?: emptyMap())

    private fun str(v: Any?): String? = when (v) {
        is String -> v
        is Number -> Json.formatNumber(v)
        else -> null
    }

    /** Returns (present, value); present == false means the call returns undefined. */
    fun dispatch(sdk: TapCubCore, call: String, a: List<Any?>, m: VectorMock): Pair<Boolean, Any?> {
        fun arg(i: Int) = a.getOrNull(i)
        fun obj(i: Int) = arg(i).asObj()
        when (call) {
            "init" -> { sdk.init(); m.drain() }
            "flush" -> sdk.flush()
            "track" -> sdk.track(str(arg(0)) ?: "", obj(1))
            "trackScreen" -> sdk.trackScreen(str(arg(0)) ?: "", obj(1))
            "login" -> sdk.login(str(arg(0)) ?: "", obj(1), obj(2)?.get("type") as? String)
            "logout" -> sdk.logout()
            "bind" -> sdk.bind(obj(0) ?: JsonObject())
            "setProps" -> sdk.setProps(obj(0) ?: JsonObject())
            "setPropsOnce" -> sdk.setPropsOnce(obj(0) ?: JsonObject())
            "unsetProps" -> sdk.unsetProps(arg(0).asList()?.filterIsInstance<String>() ?: emptyList())
            "setGroup" -> sdk.setGroup(str(arg(0)) ?: "", str(arg(1)), obj(2))
            "reset" -> sdk.reset()
            "anonymize" -> sdk.anonymize()
            "grantConsent" -> {
                val x = arg(0)
                if (x is Number) sdk.grantConsent(x.toInt()) else sdk.grantConsent(x.asList()?.filterIsInstance<String>() ?: emptyList())
            }
            "revokeConsent" -> sdk.revokeConsent()
            "getConsent" -> return true to sdk.getConsent()
            "optOut" -> sdk.optOut()
            "optIn" -> sdk.optIn()
            "setRestricted" -> sdk.setRestricted(arg(0) != false)
            "setChildMode" -> sdk.setChildMode(arg(0) != false)
            "setDataRegion" -> sdk.setDataRegion(str(arg(0)) ?: "")
            "shouldPrompt" -> return true to sdk.shouldPrompt()
            "stop" -> sdk.stop()
            "start" -> sdk.start()
            "registerSuperProps" -> sdk.registerSuperProps(obj(0) ?: JsonObject())
            "unregisterSuperProp" -> sdk.unregisterSuperProp(str(arg(0)) ?: "")
            "getState" -> return true to sdk.getState().toJson()
            "getRemoteConfig" -> return true to sdk.getRemoteConfig().toJson()
            "getDeviceId" -> return true to sdk.getDeviceId()
            "getSessionId" -> return true to sdk.getSessionId()
            "trackDeeplink" -> sdk.trackDeeplink(str(arg(0)) ?: "", str(arg(1)))
            "trackPurchase" -> sdk.trackPurchase(obj(0) ?: JsonObject())
            "withShareParams" -> return true to sdk.withShareParams(str(arg(0)) ?: "")
            "requiredPrivacyApis" -> return true to sdk.requiredPrivacyApis()
            else -> throw VectorError("unknown call $call")
        }
        return false to null
    }
}
