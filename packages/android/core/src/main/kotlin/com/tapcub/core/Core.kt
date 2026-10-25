package com.tapcub.core

// Line-by-line port of packages/app-sdk/src/core/sdk.ts. Method order and storage keys match the TS core;
// change the shared vectors and the TS core first, then this file. Not thread-safe: the `TapCub`
// facade confines every call to one worker thread.

const val TC_LIB_VERSION = "0.1.1"

internal fun libName(pt: String) = when (pt) {
    "ios" -> "tapcub-ios"
    "harmony" -> "tapcub-harmony"
    else -> "tapcub-android"
}

private const val HOLD_MAX = 200
private const val IDENTITY_HOLD_MS = 800L
private const val SESSION_COOLDOWN_MS = 15000L
private const val SESSION_MAX_MS = 86_400_000L
private const val CFG_CACHE_MS = 86_400_000.0
private const val MAX_BACKOFF_MS = 300_000.0
private const val FAILURES_BEFORE_SWITCH = 10

private object K {
    const val CFG = "tc_cfg"
    const val DID = "tc_did"
    const val CONSENT = "tc_consent"
    const val REJECT_AT = "tc_consent_reject_at"
    const val OPTOUT = "tc_optout"
    const val CHILD = "tc_child"
    const val LOGIN = "tc_login"
    const val GROUP = "tc_group"
    const val SUPER_PROPS = "tc_sp"
    const val FIRST = "tc_first"
}

private val PRESET_EVENT_RE = Regex("^\\$((app_(install|start|end|click|update|crashed))|anr|ui_freeze|rage_tap|deeplink_launch|push_click|in_app_purchase|ad_impression|fps_sample|memory_sample|screen_view|screen_leave|os_update|user_engagement)$")
private val GROUP_TYPE_RE = Regex("^[a-z][a-z0-9_]{0,23}$")
private val CUSTOM_ID_RE = Regex("^[A-Za-z0-9_-]{8,64}$")
private val DIGITS_RE = Regex("\\d+")
private val DEEPLINK_SECRET_RE = Regex("([?&])(token|code|auth|password|pwd)=[^&]*", RegexOption.IGNORE_CASE)
private val LEADING_SLASHES_RE = Regex("^/+")
private val TRAILING_SLASHES_RE = Regex("/+$")

private class HoldItem(val ts: Long, val mid: String, val build: () -> JsonObject)

private class LoginState(val id: String, val type: String) {
    fun json() = Json.stringify(jsonObjectOf("id" to id, "type" to type))
}

/** `hasVer == false` means the key is absent (TS `undefined`). */
private class Consent(val c: Int, val hasVer: Boolean, val ver: Any?)

class TapCubCore(private val A: Adapters) {
    private var cfg = TapCubConfig("")
    private var policy = ReportPolicy()
    private var qLimits = QueueLimits()
    private var endpoints: List<String> = emptyList()
    private var endpointIdx = 0
    private val platform: String = A.device.platform

    private var preInited = false
    private var initialized = false
    private var ready = false
    private var stopped = false
    private var server = ServerCfg.conservative
    private var rc = RemoteConfig()
    private var device = DeviceSnapshot()
    private var deviceRead = false
    private var networkType = "unknown"

    private var did: String? = null
    private var consent: Consent? = null
    private var optout = false
    private var child = false
    private var auth: LoginState? = null
    private var group: String? = null
    private var superProps = JsonObject()
    private var firstTs = 0L
    private var firstLaunch = false

    private var sid: String? = null
    private var sessionStart = 0L
    private var sessionCount = 0
    private var hideAt = 0L
    private var fgSince = 0L
    private var fgAccum = 0L
    private var foreground = false

    private var launch: LaunchInfo? = null
    private var launchPending = false
    private var pageViewPending = false
    private var pendingConsentReceipt = false
    private var latestScene: Any? = null
    private var page: PageInfo? = null
    private var pageShownAt = 0L
    private var pageAccum = 0L
    private var previousScreen: String? = null
    private var shareDepth = 0
    private var shareFrom: String? = null

    private var hold = ArrayList<HoldItem>()
    private var pending = ArrayList<() -> Unit>()
    private var identityHold = false
    private var identityHoldTimer: Int? = null
    private var queue = makeQueue()
    private var sending = false
    private var failures = 0
    private var attempt = 0
    private var retryTimer: Int? = null
    private var intervalTimer: Int? = null
    private var sampled = true
    private var enabled = true
    private var outdated = false

    private val consentListeners = ArrayList<(Int) -> Unit>()
    private val sessionListeners = ArrayList<(String, String) -> Unit>()
    private val errorListeners = ArrayList<(String, String) -> Unit>()
    val errors = ArrayList<Pair<String, String>>()

    private fun makeQueue() = PersistentQueue(A.storage, qLimits, { A.timers.now() }, { c, m -> fail(c, m) })

    private fun lib() = "${libName(platform)}/$TC_LIB_VERSION"

    // ---- init ----

    /** Callable before consent: stores config and binds lifecycle only (no collection, no device reads, no network). */
    fun preInit(config: TapCubConfig): TapCubCore {
        if (preInited) return this
        preInited = true
        cfg = config.copy()
        val p = ReportPolicy()
        config.reportPolicy?.let { rp ->
            rp.onLaunch?.let { p.onLaunch = it }
            rp.onBackground?.let { p.onBackground = it }
            rp.intervalSec?.let { p.intervalSec = it }
            rp.threshold?.let { p.threshold = it }
        }
        policy = p
        if (config.autoTrack == null) cfg.autoTrack = true
        val q = QueueLimits()
        config.queue?.let { ql ->
            ql.maxEvents?.let { q.maxEvents = it }
            ql.maxDays?.let { q.maxDays = it }
            ql.maxBatch?.let { q.maxBatch = it }
            ql.maxBytes?.let { q.maxBytes = it }
            ql.maxStorageBytes?.let { q.maxStorageBytes = it }
        }
        qLimits = q
        queue = makeQueue()
        val single = config.endpoint?.takeIf { it.isNotEmpty() }?.let { listOf(it) } ?: emptyList()
        val list = (config.endpoints?.takeIf { it.isNotEmpty() } ?: single).map { TRAILING_SLASHES_RE.replace(it, "") }
        endpoints = list.ifEmpty { listOf("https://api.pathclue.com") }
        A.lifecycle.bind(LifecycleHandlers(
            onLaunch = { handleLaunch(it) },
            onShow = { handleShow(it) },
            onHide = { handleHide() },
            onPageShow = { handlePageShow(it) },
            onPageHide = { handlePageHide(it) },
            onShare = { p2, m -> handleShare(p2, m) },
        ))
        A.crash?.enable { reportException(it) }
        return this
    }

    /** After consent (or when the site needs none): fetch cfg → consent gate → device info / device id / session / flush. */
    @JvmOverloads
    fun init(config: TapCubConfig? = null, completion: (() -> Unit)? = null) {
        if (config != null && !preInited) preInit(config)
        if (initialized) { completion?.invoke(); return }
        if (cfg.siteKey.isEmpty()) {
            fail("internal", "siteKey required")
            completion?.invoke()
            return
        }
        initialized = true
        loadState()
        if (optout) {
            ready = true
            hold.clear()
            completion?.invoke()
            return
        }
        fetchCfg {
            ready = true
            if (pendingConsentReceipt) {
                pendingConsentReceipt = false
                idOp("consent", jsonObjectOf("c" to consentBits()), receipt = true)
            }
            applyGate()
            val calls = pending
            pending = ArrayList()
            for (c in calls) c()
            completion?.invoke()
        }
    }

    private fun loadState() {
        val c = Json.parseObject(get(K.CONSENT))
        val bits = c?.get("c").asNum()
        consent = if (c != null && bits != null) Consent(bits.toInt(), c.containsKey("ver"), c["ver"]) else null
        optout = get(K.OPTOUT) == "1"
        child = get(K.CHILD) == "1"
        val l = Json.parseObject(get(K.LOGIN))
        val id = l?.get("id") as? String
        auth = if (id != null) LoginState(id, l["type"] as? String ?: "login") else null
        group = get(K.GROUP)?.takeIf { it.isNotEmpty() }
        superProps = Json.parseObject(get(K.SUPER_PROPS)) ?: JsonObject()
        val first = get(K.FIRST)?.toDoubleOrNull() ?: 0.0
        if (first > 0) {
            firstTs = first.toLong()
        } else {
            firstTs = now()
            firstLaunch = true
            set(K.FIRST, firstTs.toString())
        }
        get(K.DID)?.let { if (DEVICE_ID_RE.containsMatchIn(it)) did = it }
    }

    private fun fetchCfg(done: () -> Unit) {
        val cached = Json.parseObject(get(K.CFG))
        val url = "${endpoint()}/api/v1/pulse/cfg?s=${encodeURIComponent(cfg.siteKey)}&pt=$platform"
        A.transport.get(url) { result ->
            var fetched: JsonObject? = null
            result.fold(
                onSuccess = { res ->
                    if (res.status == 200 && !res.body.isNullOrEmpty()) {
                        val j = Json.parseObject(res.body)
                        if (j != null && j["t"] is Number) fetched = j
                    } else if (res.status == 404) {
                        fail("cfg_failed", "site not found or paused")
                    }
                },
                onFailure = { e -> fail("cfg_failed", "Error: ${e.message ?: e}") },
            )
            val f = fetched
            val ccfg = cached?.get("cfg").asObj()
            if (f != null) {
                server = ServerCfg(f)
                set(K.CFG, Json.stringify(jsonObjectOf("cfg" to f, "at" to now())))
            } else if (ccfg != null &&
                now().toDouble() - (cached?.get("at").asNum() ?: Double.NaN) < maxOf(CFG_CACHE_MS, (ccfg["rc"].asObj()?.get("ttl").asNum() ?: 0.0) * 1000)
            ) {
                server = ServerCfg(ccfg)
            } else {
                server = ServerCfg.conservative
                fail("cfg_failed", "no cfg; conservative defaults (t=2)")
            }
            rc = normalizeRc(server.rc)
            rc.minVersion?.let { mv ->
                if (compareSemver(TC_LIB_VERSION, mv) < 0) {
                    outdated = true
                    fail("sdk_outdated", "sdk $TC_LIB_VERSION < minVersion $mv")
                }
            }
            done()
        }
    }

    // ---- consent gate ----

    private fun requireConsent() = cfg.requireConsent == true || truthy(server.cs?.get("req")) || rc.requireConsent || cnMode()
    private fun cnMode() = cfg.region == "cn" || server.cn || truthy(server.cs?.get("cn"))
    private fun consentBits() = consent?.c ?: 0
    private fun granted() = !requireConsent() || (consentBits() and 1) != 0
    private fun dropMode() = server.cs?.get("pre") == "drop"
    private fun canDid() = !child && server.t >= 3 && granted()
    private fun isOpen() = ready && granted() && !optout && !stopped
    private fun canSend() = isOpen() && enabled && !outdated

    private fun applyGate() {
        if (optout) return
        if (!granted()) {
            if (dropMode()) hold.clear()
            return
        }
        ensureDid()
        enabled = rc.enabled && !(did?.let { rc.deviceBlacklist.contains(it) } ?: false)
        if (!deviceRead) readDevice()
        if (!queue.loaded) queue.load()
        if (sid == null) startSession("init")
        sampled = rc.sample >= 100 || (fnv1a(did ?: sid ?: "") % 100).toInt() < rc.sample
        val pg = page
        if (launchPending) emitLaunch() else if (pageViewPending && pg != null) emitPageView(pg)
        val holdIdentity = (cfg.holdUntilIdentified == true || server.h) && auth == null
        if (holdIdentity) {
            identityHold = true
            identityHoldTimer = A.timers.setTimeout(IDENTITY_HOLD_MS) { releaseIdentityHold() }
        } else {
            releaseHold()
        }
        startInterval()
        applyAutoTrack()
        if (policy.onLaunch) flush()
    }

    private var autoTrackOn = false
    private fun applyAutoTrack() {
        val hook = A.autoTrack ?: return
        val want = cfg.autoTrack == true && rc.autotrack
        if (want == autoTrackOn) return
        autoTrackOn = want
        if (!want) {
            hook.disable()
            return
        }
        hook.enable { el, pg ->
            val bl = rc.elementBlacklist
            if (bl.isNotEmpty() && ((el.id != null && bl.contains(el.id)) || (el.path != null && bl.contains(el.path)))) return@enable
            val p = JsonObject()
            p["\$element_type"] = el.type
            p["\$element_id"] = el.id
            p["\$element_path"] = el.path
            p["\$screen_name"] = pg?.path ?: page?.path
            val c = el.content
            if (rc.textCapture && !c.isNullOrEmpty()) p["\$element_content"] = sha256(c).substring(0, 16)
            trackInternal("\$app_click", p, pg)
        }
    }

    private fun releaseIdentityHold() {
        if (!identityHold) return
        identityHold = false
        identityHoldTimer?.let { A.timers.clearTimeout(it) }
        identityHoldTimer = null
        releaseHold()
        flush()
    }

    private fun releaseHold() {
        if (!isOpen() || identityHold) return
        val items = hold
        hold = ArrayList()
        for (h in items) {
            if (!sampled) continue
            val p = h.build()
            val n = p["n"] as? String
            if (n != null && rc.blacklist.contains(n)) continue
            p["ts"] = h.ts
            p["mid"] = h.mid
            queue.push(p)
        }
        maybeFlushByThreshold()
    }

    private fun readDevice() {
        deviceRead = true
        device = A.device.read()
        A.device.networkType { t -> networkType = if (!t.isNullOrEmpty()) t else "unknown" }
    }

    private fun ensureDid() {
        if (!canDid()) return
        if (did == null) {
            val custom = cfg.deviceId
            val native = if (custom == null || (!CUSTOM_ID_RE.containsMatchIn(custom) && !DEVICE_ID_RE.containsMatchIn(custom))) A.device.deviceId() else null
            did = when {
                custom != null && CUSTOM_ID_RE.containsMatchIn(custom) -> "custom:$custom"
                custom != null && DEVICE_ID_RE.containsMatchIn(custom) -> custom
                native != null && DEVICE_ID_RE.containsMatchIn(native) -> native
                else -> {
                    val prefix = when (platform) { "ios" -> "ios_idfv"; "harmony" -> "harmony_odid"; else -> "android_id" }
                    "$prefix:${(now().toString(16) + "000000000000").substring(0, 12)}${randomHex(A.timers::random, 10)}"
                }
            }
        }
        did?.let { set(K.DID, it) }
    }

    private fun dropDid() {
        did = null
        remove(K.DID)
    }

    // ---- session ----

    private fun startSession(reason: String) {
        val s = randomHex(A.timers::random, 16)
        sid = s
        sessionStart = now()
        sessionCount++
        fgAccum = 0
        if (foreground) fgSince = sessionStart
        for (f in sessionListeners.toList()) f(s, reason)
    }

    private fun sessionExpired(): Boolean {
        if (sid == null) return true
        val n = now()
        if (n - sessionStart > SESSION_MAX_MS) return true
        if (hideAt == 0L) return false
        val timeout = (cfg.sessionTimeoutSec ?: 30).toLong() * 1000
        return n - hideAt >= timeout + SESSION_COOLDOWN_MS
    }

    private fun foregroundSeconds(): Long {
        var ms = fgAccum
        if (foreground && fgSince != 0L) ms += now() - fgSince
        return maxOf(0L, jsRound(ms / 1000.0).toLong())
    }

    // ---- lifecycle ----

    private fun handleLaunch(info: LaunchInfo) {
        launch = info
        latestScene = info.scene
        val sd = info.query["tc_sd"]
        if (!sd.isNullOrEmpty()) {
            shareFrom = sd.jsSlice(64)
            val parsed = (info.query["tc_sdp"] ?: "1").toIntOrNull() ?: 0
            shareDepth = minOf(99, if (parsed == 0) 1 else parsed)
        }
        launchPending = true
        if (isOpen()) emitLaunch()
    }

    private fun emitLaunch() {
        if (!launchPending) return
        launchPending = false
        replayPendingAppEnd()
        foreground = true
        fgSince = now()
        if (firstLaunch) trackInternal("\$app_install", jsonObjectOf("\$install_time" to firstTs))
        val dur = launchDurationMs()
        trackInternal("\$app_start", jsonObjectOf("\$start_type" to "cold", "\$resume_from_background" to false, "\$duration_ms" to dur))
        val pg = page
        if (pageViewPending && pg != null) emitPageView(pg)
    }

    private fun launchDurationMs(): Long {
        val v = launch?.query?.get("duration_ms")?.toDoubleOrNull() ?: return 0
        if (v.isNaN() || v.isInfinite() || v <= 0) return 0
        return jsRound(v).toLong()
    }

    private fun replayPendingAppEnd() {
        val raw = get("tc_end_pending") ?: return
        remove("tc_end_pending")
        val sec = raw.toDoubleOrNull() ?: 0.0
        if (sec > 0) trackInternal("\$app_end", jsonObjectOf("\$event_duration" to sec), null, if (hideAt != 0L) hideAt else now())
    }

    private fun handleShow(info: LaunchInfo) {
        if (info.scene != null) latestScene = info.scene
        if (launchPending) return
        if (foreground) return
        foreground = true
        fgSince = now()
        if (page != null) pageShownAt = now()
        if (!isOpen()) return
        if (sessionExpired()) {
            emitAppEnd()
            startSession(if (now() - sessionStart > SESSION_MAX_MS) "max_age" else "timeout")
            hideAt = 0
            trackInternal("\$app_start", jsonObjectOf("\$start_type" to "hot", "\$resume_from_background" to true, "\$duration_ms" to 0))
        }
    }

    private fun handleHide() {
        if (!foreground) return
        foreground = false
        val n = now()
        hideAt = n
        if (fgSince != 0L) fgAccum += n - fgSince
        fgSince = 0
        if (page != null && pageShownAt != 0L) {
            pageAccum += n - pageShownAt
            pageShownAt = 0
        }
        set("tc_end_pending", jsRound(fgAccum / 1000.0).toLong().toString())
        if (!isOpen()) return
        if (policy.onBackground) flush()
    }

    private fun emitAppEnd() {
        val sec = foregroundSeconds()
        remove("tc_end_pending")
        if (sec >= 0) trackInternal("\$app_end", jsonObjectOf("\$event_duration" to sec))
        fgAccum = 0
    }

    private fun handlePageShow(p: PageInfo) {
        val cur = page
        if (cur != null && cur.path != p.path) previousScreen = cur.path
        page = p
        pageShownAt = now()
        pageAccum = 0
        if (cfg.autoTrackScreens == false) return
        if (stopped || optout) return
        if (!isOpen() || launchPending) {
            pageViewPending = true
            return
        }
        emitPageView(p)
    }

    private fun emitPageView(p: PageInfo) {
        pageViewPending = false
        trackInternal("\$screen_view", screenProps(p, previousScreen), p)
    }

    private fun screenProps(p: PageInfo, prev: String?): JsonObject {
        val o = JsonObject()
        o["\$path"] = p.path
        o["\$screen_name"] = p.path
        val q = p.query
        o["\$query"] = if (!q.isNullOrEmpty()) {
            val qo = JsonObject()
            for (k in q.keys.sorted()) qo[k] = q[k]
            Json.stringify(qo)
        } else null
        o["\$title"] = p.title
        o["\$previous_screen"] = prev
        return o
    }

    private fun handlePageHide(p: PageInfo) {
        var ms = pageAccum
        if (pageShownAt != 0L) ms += now() - pageShownAt
        pageShownAt = 0
        pageAccum = 0
        if (cfg.autoTrackScreens == false) return
        trackInternal("\$screen_leave", jsonObjectOf("\$path" to p.path, "\$screen_name" to p.path, "\$duration" to jsRound(ms / 1000.0)), p)
    }

    private fun handleShare(p: PageInfo, method: String) {
        trackInternal("\$deeplink_launch", jsonObjectOf("\$deeplink_url" to p.path, "\$referrer_app" to method.ifEmpty { null }), p)
    }

    // ---- event building ----

    private fun now() = A.timers.now()

    private fun pageUrl(p: PageInfo?): String {
        val host = (cfg.appId?.takeIf { it.isNotEmpty() } ?: platform).lowercase()
        val path = (p ?: page)?.let { LEADING_SLASHES_RE.replace(it.path, "") } ?: ""
        return "https://$host/$path".jsSlice(Limits.URL)
    }

    private fun presetProps(): JsonObject {
        val d = device
        val out = JsonObject()
        out["\$lib"] = libName(platform)
        out["\$lib_version"] = TC_LIB_VERSION
        out["\$app_state"] = if (foreground) "foreground" else "background"
        cfg.appId?.takeIf { it.isNotEmpty() }?.let { out["\$app_id"] = it }
        cfg.appVersion?.takeIf { it.isNotEmpty() }?.let { out["\$app_version"] = it }
        d.os?.takeIf { it.isNotEmpty() }?.let { out["\$os"] = it }
        d.osVersion?.takeIf { it.isNotEmpty() }?.let { out["\$os_version"] = it }
        d.brand?.takeIf { it.isNotEmpty() }?.let { out["\$device_brand"] = it }
        d.model?.takeIf { it.isNotEmpty() }?.let { out["\$device_model"] = it }
        out["\$device_type"] = d.deviceType?.takeIf { it.isNotEmpty() } ?: "phone"
        d.screenWidth?.takeIf { it != 0 }?.let { out["\$screen_width"] = it }
        d.screenHeight?.takeIf { it != 0 }?.let { out["\$screen_height"] = it }
        d.hostVersion?.takeIf { it.isNotEmpty() }?.let { out["\$host_version"] = it }
        out["\$network_type"] = networkType
        launch?.scene?.let { out["\$scene"] = it }
        latestScene?.let { out["\$latest_scene"] = it }
        val sf = shareFrom
        if (!sf.isNullOrEmpty()) {
            out["\$share_distinct_id"] = sf
            out["\$share_depth"] = shareDepth
        }
        out["\$is_first_day"] = now() - firstTs < 86_400_000
        out["\$is_first_time"] = firstLaunch
        return out
    }

    private fun base(t: String, p: PageInfo? = null): JsonObject {
        val o = JsonObject()
        o["v"] = 2
        o["s"] = cfg.siteKey
        o["t"] = t
        o["u"] = pageUrl(p)
        o["pt"] = platform
        o["lib"] = lib()
        o["ts"] = now()
        o["mid"] = uuidV4(A.timers::random)
        sid?.let { o["sid"] = it }
        did?.let { o["did"] = it }
        consent?.let { o["c"] = it.c }
        if (child) o["cm"] = 1
        group?.let { o["g"] = it }
        val d = device
        val w = d.screenWidth
        val h = d.screenHeight
        if (w != null && h != null && w != 0 && h != 0) o["sc"] = "${w}x$h"
        d.locale?.takeIf { it.isNotEmpty() }?.let { o["l"] = it.jsSlice(20) }
        d.timezone?.takeIf { it.isNotEmpty() }?.let { o["tz"] = it.jsSlice(50) }
        return o
    }

    private fun buildEvent(name: String, props: Map<String, Any?>?, p: PageInfo?, extra: JsonObject?): JsonObject {
        val o = base("ev", p)
        o["n"] = name
        (p ?: page)?.title?.takeIf { it.isNotEmpty() }?.let { o["ti"] = it.jsSlice(Limits.TITLE) }
        val merged = presetProps()
        merged.putAll(superProps)
        if (props != null) merged.putAll(props)
        normProps(merged)?.let { o["p"] = it }
        if (extra != null) o.putAll(extra)
        return o
    }

    // ---- enqueue / hold ----

    private fun holdOrDrop(build: () -> JsonObject, ts: Long? = null) {
        if (optout || stopped) return
        if (ready && dropMode() && !granted()) return
        if (hold.size >= HOLD_MAX) {
            hold.removeAt(0)
            fail("hold_overflow", "pre-consent hold full, dropped oldest")
        }
        hold.add(HoldItem(ts ?: now(), uuidV4(A.timers::random), build))
    }

    private fun enqueue(build: () -> JsonObject, ts: Long? = null) {
        if (optout || stopped) return
        if (!isOpen() || identityHold) {
            holdOrDrop(build, ts)
            return
        }
        if (!sampled) return
        val p = build()
        if (ts != null && ts != 0L) p["ts"] = ts
        queue.push(p)
        maybeFlushByThreshold()
    }

    private fun maybeFlushByThreshold() {
        val th = if (rc.threshold != RemoteConfig().threshold) rc.threshold else policy.threshold
        if (th > 0 && queue.length >= th) flush()
    }

    private fun trackInternal(name: String, props: Map<String, Any?>?, p: PageInfo? = null, ts: Long? = null, extra: JsonObject? = null) {
        if (rc.blacklist.contains(name)) return
        enqueue({ buildEvent(name, props, p, extra) }, ts)
    }

    // ---- sending ----

    private fun endpoint() = if (endpoints.isEmpty()) "https://api.pathclue.com" else endpoints[endpointIdx % endpoints.size]

    private fun startInterval() {
        if (intervalTimer != null) return
        val sec = if (rc.interval != RemoteConfig().interval) rc.interval else policy.intervalSec
        if (sec > 0) {
            intervalTimer = A.timers.setInterval(sec.toLong() * 1000) {
                if (retryTimer == null && !sending) flush()
            }
        }
    }

    private fun stopTimers() {
        intervalTimer?.let { A.timers.clearInterval(it) }
        intervalTimer = null
        retryTimer?.let { A.timers.clearTimeout(it) }
        retryTimer = null
    }

    fun flush() {
        if (sending || !canSend()) return
        val batch = queue.peek()
        if (batch.isEmpty()) return
        sending = true
        val req = jsonObjectOf("sent" to now(), "items" to batch)
        val url = "${endpoint()}/api/v1/pulse"
        log("debug", "POST $url ×${batch.size}")
        A.transport.post(url, Json.stringify(req), mapOf("Content-Type" to "text/plain", "X-Tc-Lib" to lib())) { result ->
            result.fold(
                onSuccess = { onSent(it.status, batch) },
                onFailure = {
                    log("debug", "network error: $it")
                    onSent(0, batch)
                },
            )
        }
    }

    private fun sendDirect(p: JsonObject) {
        val req = jsonObjectOf("sent" to now(), "items" to listOf(p))
        A.transport.post("${endpoint()}/api/v1/pulse", Json.stringify(req), mapOf("Content-Type" to "text/plain", "X-Tc-Lib" to lib())) { }
    }

    private fun onSent(status: Int, batch: List<JsonObject>) {
        sending = false
        val count = batch.size
        if (status in 200..299) {
            queue.ack(batch)
            failures = 0
            attempt = 0
            if (queue.length > 0) flush()
            return
        }
        if (status == 429 || status >= 500 || status == 0) {
            failures++
            attempt++
            if (failures >= FAILURES_BEFORE_SWITCH && endpoints.size > 1) {
                endpointIdx = (endpointIdx + 1) % endpoints.size
                failures = 0
                log("debug", "switch endpoint → ${endpoint()}")
            }
            val delay = minOf(MAX_BACKOFF_MS, 1000 * Math.pow(2.0, minOf(attempt - 1, 20).toDouble()))
            retryTimer?.let { A.timers.clearTimeout(it) }
            retryTimer = A.timers.setTimeout(delay.toLong()) {
                retryTimer = null
                flush()
            }
            return
        }
        queue.ack(batch)
        fail("send_failed", "HTTP $status, batch of $count dropped")
        if (queue.length > 0) flush()
    }

    // ---- public API: collection ----

    @JvmOverloads
    fun track(name: String, props: Map<String, Any?>? = null) {
        if (optout || stopped) return
        var n = name.jsTrim()
        if (n.isEmpty()) return
        if (n.length > Limits.NAME) n = n.jsSlice(Limits.NAME)
        if (n.startsWith("$") && !PRESET_EVENT_RE.containsMatchIn(n)) n = n.substring(1)
        if (!initialized) {
            val ts = now()
            val nn = n
            pending.add { trackInternal(nn, props, null, ts) }
            return
        }
        trackInternal(n, props)
    }

    @JvmOverloads
    fun trackScreen(name: String, props: Map<String, Any?>? = null) {
        val path = name.jsTrim().jsSlice(200)
        if (path.isEmpty()) return
        val pg = PageInfo(path, null, props?.get("\$title") as? String)
        val prev = page?.path
        page = pg
        pageShownAt = now()
        val p = screenProps(pg, prev)
        if (props != null) p.putAll(props)
        trackInternal("\$screen_view", p, pg)
    }

    // ---- public API: identity ----

    private fun identityAllowed(): Boolean {
        if (!ready) return true
        if (server.t < 3) {
            fail("identity_blocked_by_tier", "tier < 3")
            return false
        }
        if (!server.i) {
            log("debug", "identity ops ignored: site is anonymous mode")
            return false
        }
        return true
    }

    private fun idOp(op: String, extra: JsonObject? = null, receipt: Boolean = false) {
        val build = {
            val p = base("id")
            p["op"] = op
            if (extra != null) p.putAll(extra)
            p
        }
        if (receipt) {
            sendDirect(build())
            return
        }
        if (!isOpen()) {
            holdOrDrop(build)
            return
        }
        queue.push(build())
        flush()
    }

    private fun idsFromProps(props: Map<String, Any?>?): JsonObject? {
        if (props == null) return null
        val ids = JsonObject()
        (props["\$email"] as? String)?.takeIf { it.isNotEmpty() }?.let { ids["email"] = sha256(normId("email", it)) }
        (props["\$phone"] as? String)?.takeIf { it.isNotEmpty() }?.let { ids["mobile"] = sha256(normId("mobile", it)) }
        return ids.ifEmpty { null }
    }

    private fun hashedId(type: String, v: String) =
        if (type == "email" || type == "mobile") (if (HEX64.containsMatchIn(v)) v.lowercase() else sha256(normId(type, v))) else v

    /** type: login | email | mobile | unionid | openid | custom */
    @JvmOverloads
    fun login(id: String, props: Map<String, Any?>? = null, type: String? = null) {
        if (!initialized || !ready) {
            pending.add { login(id, props, type) }
            return
        }
        if (optout) return
        var v = id.jsTrim()
        val t = type?.takeIf { it.isNotEmpty() } ?: "login"
        if (v.isEmpty() || v.length > LOGIN_ID_MAX || BLOCKED_ID_RE.containsMatchIn(v)) {
            fail("invalid_login_id", "blocked or empty id for type $t")
            return
        }
        if (!identityAllowed()) return
        v = hashedId(t, v)
        val a = auth
        val switching = a != null && (a.id != v || a.type != t)
        val same = a != null && !switching
        auth = LoginState(v, t)
        set(K.LOGIN, auth!!.json())
        if (switching) {
            hideAt = 0
            fgAccum = 0
            if (foreground) fgSince = now()
            startSession("login")
        }
        ensureDid()
        if (!same || props != null) {
            val extra = JsonObject()
            extra["id"] = v
            extra["idt"] = t
            extra["h"] = 1
            normProps(props, Limits.PROFILE_KEYS)?.let { extra["props"] = it }
            idsFromProps(props)?.let { extra["ids"] = it }
            extra["src"] = "sdk"
            idOp("login", extra)
        }
        releaseIdentityHold()
    }

    fun logout() {
        if (!initialized || !ready) {
            pending.add { logout() }
            return
        }
        if (auth == null) return
        auth = null
        remove(K.LOGIN)
        hideAt = 0
        startSession("logout")
        if (identityAllowed()) idOp("logout")
    }

    fun bind(ids: Map<String, Any?>) {
        if (!ready) {
            pending.add { bind(ids) }
            return
        }
        if (!identityAllowed()) return
        val out = JsonObject()
        for ((k, raw) in ids) {
            val s0 = when (raw) {
                is String -> raw
                is Number -> Json.formatNumber(raw)
                else -> null
            }
            if (s0.isNullOrEmpty()) continue
            val s = s0.jsTrim()
            if (s.isEmpty() || s.length > LOGIN_ID_MAX || BLOCKED_ID_RE.containsMatchIn(s)) continue
            out[k] = hashedId(k, s)
        }
        if (out.isNotEmpty()) idOp("bind", jsonObjectOf("ids" to out, "h" to 1))
    }

    fun setProps(props: Map<String, Any?>) = profileOp("set", props)
    fun setPropsOnce(props: Map<String, Any?>) = profileOp("set_once", props)

    fun unsetProps(keys: List<String>) {
        if (!ready) {
            pending.add { unsetProps(keys) }
            return
        }
        if (!identityAllowed()) return
        val list = keys.filter { it.isNotEmpty() && it.length <= Limits.PROP_KEY }.take(Limits.PROFILE_KEYS)
        if (list.isNotEmpty()) idOp("unset", jsonObjectOf("unset" to list, "h" to 1))
    }

    private fun profileOp(op: String, props: Map<String, Any?>) {
        if (!ready) {
            pending.add { profileOp(op, props) }
            return
        }
        if (!identityAllowed()) return
        val p = normProps(props, Limits.PROFILE_KEYS)
        if (p.isNullOrEmpty()) return
        val extra = JsonObject()
        extra[if (op == "set") "props" else "once"] = p
        idsFromProps(props)?.let { extra["ids"] = it }
        extra["h"] = 1
        idOp(op, extra)
    }

    @JvmOverloads
    fun setGroup(type: String, id: String?, traits: Map<String, Any?>? = null) {
        val t = type.lowercase()
        val v = (id ?: "").jsTrim()
        if (!GROUP_TYPE_RE.containsMatchIn(t) || v.length > 80) return
        group = if (v.isEmpty()) null else "$t:$v"
        group?.let { set(K.GROUP, it) } ?: remove(K.GROUP)
        fun extra(g: String?): JsonObject {
            val e = JsonObject()
            e["g"] = g
            normProps(traits, Limits.PROFILE_KEYS)?.let { e["props"] = it }
            e["h"] = 1
            return e
        }
        if (!ready) {
            if (group != null) pending.add { idOp("group", extra(group)) }
            return
        }
        val g = group
        if (g != null && identityAllowed()) idOp("group", extra(g))
    }

    fun reset() {
        if (!ready) {
            pending.add { reset() }
            return
        }
        dropDid()
        auth = null
        remove(K.LOGIN)
        hideAt = 0
        startSession("logout")
        ensureDid()
        if (identityAllowed()) idOp("reset")
    }

    fun anonymize() = reset()

    // ---- public API: consent / compliance ----

    /** purposes: analytics | functional | marketing */
    fun grantConsent(purposes: List<String>) {
        var c = 0
        for (p in purposes) c = c or when (p) { "analytics" -> 1; "functional" -> 2; "marketing" -> 4; else -> 0 }
        grantConsent(c)
    }

    fun grantConsent(bits: Int) {
        val c = bits and 7
        val cs = server.cs
        val hasVer = cs == null || cs.containsKey("ver")
        val ver = cs?.get("ver")
        consent = Consent(c, hasVer, ver)
        val stored = JsonObject()
        stored["c"] = c
        if (hasVer) stored["ver"] = ver
        set(K.CONSENT, Json.stringify(stored))
        if (c and 1 == 0) {
            set(K.REJECT_AT, now().toString())
            dropDid()
            queue.purge()
            if (cnMode()) hold.clear()
        } else {
            remove(K.REJECT_AT)
        }
        if (initialized && ready && !optout) {
            idOp("consent", jsonObjectOf("c" to c), receipt = true)
            if (c and 1 != 0) applyGate() else stopTimers()
        } else if (!optout) {
            pendingConsentReceipt = true
        }
        for (f in consentListeners.toList()) f(c)
    }

    fun revokeConsent() = grantConsent(0)
    fun getConsent(): Int = consentBits()

    fun optOut() {
        if (optout) return
        optout = true
        set(K.OPTOUT, "1")
        if (initialized && ready) idOp("optout", jsonObjectOf("c" to 0), receipt = true)
        dropDid()
        queue.purge()
        hold.clear()
        stopTimers()
    }

    fun optIn() {
        if (!optout) return
        optout = false
        remove(K.OPTOUT)
        if (initialized && ready) {
            idOp("optin", jsonObjectOf("c" to consentBits()), receipt = true)
            applyGate()
        }
    }

    fun setRestricted(on: Boolean) = if (on) optOut() else optIn()

    fun setChildMode(on: Boolean) {
        child = on
        if (child) {
            set(K.CHILD, "1")
            dropDid()
        } else {
            remove(K.CHILD)
        }
    }

    /** eu | us | cn — only before `init`. */
    fun setDataRegion(region: String) {
        if (initialized) {
            fail("internal", "setDataRegion must be called before init()")
            return
        }
        cfg.region = region
    }

    fun shouldPrompt(): Boolean {
        consent?.let { if (it.c and 1 != 0) return false }
        val r = get(K.REJECT_AT)?.toDoubleOrNull() ?: 0.0
        val rej = server.cs?.get("rej").asNum() ?: 0.0
        val cd = cfg.rejectCooldownDays ?: 0
        val days = if (cd != 0) cd.toDouble() else if (rej != 0.0) rej else 7.0
        return r == 0.0 || now().toDouble() - r > days * 86_400_000
    }

    fun stop() {
        stopped = true
        stopTimers()
    }

    fun start() {
        if (!stopped) return
        stopped = false
        if (ready) applyGate()
    }

    // ---- public API: properties / getters / listeners ----

    fun registerSuperProps(props: Map<String, Any?>) {
        val p = normProps(props) ?: JsonObject()
        for ((k, v) in p) if (!k.startsWith("$")) superProps[k] = v
        set(K.SUPER_PROPS, Json.stringify(superProps))
    }

    fun unregisterSuperProp(key: String) {
        superProps.remove(key)
        set(K.SUPER_PROPS, Json.stringify(superProps))
    }

    fun withShareParams(path: String): String {
        val sd = did?.let { java.lang.Long.toString(fnv1a(it), 36) } ?: sid?.take(8) ?: ""
        if (sd.isEmpty()) return path
        val sep = if (path.contains("?")) "&" else "?"
        return "$path${sep}tc_sd=$sd&tc_sdp=${shareDepth + 1}"
    }

    fun getDeviceId(): String? = did
    fun getSessionId(): String? = sid
    fun getConfig(): TapCubConfig = cfg
    fun getRemoteConfig(): RemoteConfig = rc
    fun requiredPrivacyApis(): List<String> = emptyList()

    fun reportException(ev: CrashEvent) {
        if (cfg.crashReport == false) return
        val type = (ev.type?.takeIf { it.isNotEmpty() } ?: ev.kind).jsSlice(80)
        val msg = (ev.message ?: "").jsSlice(Limits.MESSAGE)
        val st = (ev.stack ?: "").jsSlice(Limits.STACK)
        val top = st.split("\n").firstOrNull { it.jsTrim().isNotEmpty() } ?: type
        val grp = sha256(type + DIGITS_RE.replace(top, "")).substring(0, 40)
        val name = when (ev.kind) { "anr" -> "\$anr"; "freeze" -> "\$ui_freeze"; else -> "\$app_crashed" }
        val p = JsonObject()
        p["\$fatal"] = ev.fatal != false
        p["\$exception_type"] = type
        p["\$exception_message"] = msg
        p["\$group"] = grp
        p["\$foreground"] = ev.foreground != false
        p["\$duration_ms"] = ev.durationMs
        p["\$stack_top"] = top.jsSlice(200)
        val ts = ev.ts?.takeIf { it > 0 }
        trackInternal(name, p, null, ts, if (st.isEmpty()) null else jsonObjectOf("st" to st))
    }

    fun trackPurchase(info: Map<String, Any?>) = track("\$in_app_purchase", info)
    fun trackPushClick(payload: Map<String, Any?>) = track("\$push_click", payload)
    fun setAttribution(attrs: Map<String, Any?>) = registerSuperProps(attrs)

    @JvmOverloads
    fun trackDeeplink(url: String, referrer: String? = null) {
        val clean = DEEPLINK_SECRET_RE.replace(url, "$1$2=")
        trackInternal("\$deeplink_launch", jsonObjectOf("\$deeplink_url" to clean.jsSlice(500), "\$referrer_app" to referrer))
    }

    fun onConsentChange(cb: (Int) -> Unit) { consentListeners.add(cb) }
    /** reason: init | timeout | login | max_age | logout */
    fun onSessionStart(cb: (sessionId: String, reason: String) -> Unit) { sessionListeners.add(cb) }
    fun onError(cb: (code: String, message: String) -> Unit) { errorListeners.add(cb) }

    fun getState() = State(
        initialized = initialized,
        deviceId = did,
        sessionId = sid,
        consent = consent?.c,
        optedOut = optout,
        loginId = auth?.id,
        loginType = auth?.type,
        queueLength = queue.length,
        holdLength = hold.size,
        enabled = enabled && !outdated,
        sampled = sampled,
        tier = server.t,
        endpoint = endpoint(),
        sessionCount = sessionCount,
    )

    // ---- helpers ----

    private fun fail(code: String, message: String) {
        if (errors.size < 100) errors.add(code to message)
        log("error", "[$code] $message")
        for (f in errorListeners.toList()) f(code, message)
    }

    private fun log(level: String, msg: String) {
        if (level == "debug" && cfg.debug != true) return
        A.log?.invoke(level, msg)
    }

    private fun get(k: String): String? = A.storage.get(k)

    private fun set(k: String, v: String) {
        try {
            A.storage.set(k, v)
        } catch (e: Exception) {
            fail("storage_failed", "$k: $e")
        }
    }

    private fun remove(k: String) = A.storage.remove(k)
}
