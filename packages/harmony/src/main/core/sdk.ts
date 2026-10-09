// 生成文件：由 scripts/sync-harmony-core.mjs 从 packages/app-sdk/src/core 同步，不要手改。
/**
 * App SDK 核心（dev_behavior_phase3/01）：Android / iOS / HarmonyOS 共用。
 * 预置事件为 $app_* / $screen_*；平台差异在适配层。内部错误不抛到宿主。
 */
import { PersistentQueue } from './queue';
import type {
  Adapters,
  BatchRequest,
  ConsentPurpose,
  CrashEvent,
  DeviceSnapshot,
  ErrorCode,
  IdentityOp,
  LaunchInfo,
  LoginIdType,
  MpPlatform,
  PageInfo,
  Payload,
  PropValue,
  Props,
  QueueLimits,
  RemoteConfig,
  ReportPolicy,
  SdkState,
  ServerCfg,
  TapCubConfig,
} from './types';
import { BLOCKED_ID_RE, DEFAULT_RC, DEVICE_ID_RE, HEX64, LIMITS, LOGIN_ID_MAX, compareSemver, fnv1a, normId, normProps, normalizeRc, randomHex, safeParse, sha256, uuidV4 } from './util';

export const LIB_VERSION = '0.1.0';
function libName(pt: string): string {
  return pt === 'ios' ? 'tapcub-ios' : pt === 'harmony' ? 'tapcub-harmony' : 'tapcub-android';
}

const HOLD_MAX = 200;
const IDENTITY_HOLD_MS = 800;
const SESSION_COOLDOWN_MS = 15000;
const SESSION_MAX_MS = 86400000;
const CFG_CACHE_MS = 86400000;
const MAX_BACKOFF_MS = 300000;
const FAILURES_BEFORE_SWITCH = 10;

const K = {
  cfg: 'tc_cfg',
  did: 'tc_did',
  consent: 'tc_consent',
  rejectAt: 'tc_consent_reject_at',
  optout: 'tc_optout',
  child: 'tc_child',
  login: 'tc_login',
  group: 'tc_group',
  superProps: 'tc_sp',
  first: 'tc_first',
} as const;

const DEFAULT_POLICY: ReportPolicy = { onLaunch: true, onBackground: true, intervalSec: 30, threshold: 30 };
const DEFAULT_QUEUE: QueueLimits = { maxEvents: 10000, maxDays: 7, maxBatch: 50, maxBytes: 65536, maxStorageBytes: 1048576 };

interface HoldItem {
  ts: number;
  mid: string;
  build: () => Payload;
}
interface LoginState {
  id: string;
  type: LoginIdType;
}

export type ConsentListener = (bits: number) => void;
export type SessionListener = (sid: string, reason: 'init' | 'timeout' | 'login' | 'max_age' | 'logout') => void;
export type ErrorListener = (code: ErrorCode, message: string) => void;

export class TapCubCore {
  private cfg: TapCubConfig = { siteKey: '' };
  private policy: ReportPolicy = { ...DEFAULT_POLICY };
  private qLimits: QueueLimits = { ...DEFAULT_QUEUE };
  private endpoints: string[] = [];
  private endpointIdx = 0;
  private readonly platform: MpPlatform;

  private preInited = false;
  private initialized = false;
  /** cfg 已到达（或已回退），可以做同意判定 */
  private ready = false;
  private stopped = false;
  private server: ServerCfg = { t: 2 };
  private rc: RemoteConfig = { ...DEFAULT_RC };
  private device: DeviceSnapshot = {};
  private networkType = 'unknown';

  private did: string | null = null;
  private consent: { c: number; ver?: string | null } | null = null;
  private optout = false;
  private child = false;
  private auth: LoginState | null = null;
  private group: string | null = null;
  private superProps: Record<string, PropValue> = {};
  private firstTs = 0;
  private firstLaunch = false;

  private sid: string | null = null;
  private sessionStart = 0;
  private sessionCount = 0;
  private hideAt = 0;
  private fgSince = 0;
  private fgAccum = 0;
  private foreground = false;

  private launch: LaunchInfo | null = null;
  private launchPending = false;
  private pageViewPending = false;
  private pendingConsentReceipt = false;
  private latestScene: number | string | undefined;
  private page: PageInfo | null = null;
  private pageShownAt = 0;
  private pageAccum = 0;
  private previousScreen: string | undefined;
  private shareDepth = 0;
  private shareFrom: string | undefined;

  private hold: HoldItem[] = [];
  private pending: Array<() => void> = [];
  private identityHold = false;
  private identityHoldTimer: unknown = null;
  private queue: PersistentQueue;
  private sending = false;
  private failures = 0;
  private attempt = 0;
  private retryTimer: unknown = null;
  private intervalTimer: unknown = null;
  private sampled = true;
  private enabled = true;
  private outdated = false;

  private consentListeners: ConsentListener[] = [];
  private sessionListeners: SessionListener[] = [];
  private errorListeners: ErrorListener[] = [];
  private errors: Array<{ code: ErrorCode; message: string }> = [];

  private readonly A: Adapters;

  constructor(A: Adapters) {
    this.A = A;
    this.platform = A.device.platform;
    this.queue = new PersistentQueue(A.storage, this.qLimits, () => A.timers.now(), (c, m) => this.fail(c, m));
  }
  private lib(): string {
    return `${libName(this.platform)}/${LIB_VERSION}`;
  }

  // ---------------------------------------------------------------- 初始化
  /** 同意前可调：只保存配置 + 绑定生命周期（零采集、零设备信息、零网络） */
  preInit(config: TapCubConfig): this {
    if (this.preInited) return this;
    this.preInited = true;
    this.cfg = { ...config, siteKey: String(config.siteKey || '') };
    this.policy = { ...DEFAULT_POLICY, ...(config.reportPolicy || {}) };
    if (config.autoTrack === undefined) this.cfg.autoTrack = true;
    this.qLimits = { ...DEFAULT_QUEUE, ...(config.queue || {}) };
    this.queue = new PersistentQueue(this.A.storage, this.qLimits, () => this.A.timers.now(), (c, m) => this.fail(c, m));
    const eps = (config.endpoints && config.endpoints.length ? config.endpoints : config.endpoint ? [config.endpoint] : []).map((e) => e.replace(/\/+$/, ''));
    this.endpoints = eps.length ? eps : ['https://api.pathclue.com'];
    try {
      this.A.lifecycle.bind({
        onLaunch: (i) => this.guard(() => this.handleLaunch(i)),
        onShow: (i) => this.guard(() => this.handleShow(i)),
        onHide: () => this.guard(() => this.handleHide()),
        onPageShow: (p) => this.guard(() => this.handlePageShow(p)),
        onPageHide: (p) => this.guard(() => this.handlePageHide(p)),
        onShare: (p, m) => this.guard(() => this.handleShare(p, m)),
        onFavorite: () => undefined,
      });
      this.A.crash?.enable((ev) => this.guard(() => this.reportException(ev)));
    } catch (e) {
      this.fail('internal', `lifecycle bind: ${String(e)}`);
    }
    return this;
  }

  /** 同意后（或站点不要求同意时）调用：拉 cfg → 判定同意 → 设备信息 / device_id / 会话 / flush */
  async init(config?: TapCubConfig): Promise<void> {
    if (config && !this.preInited) this.preInit(config);
    if (this.initialized) return;
    if (!this.cfg.siteKey) {
      this.fail('internal', 'siteKey required');
      return;
    }
    this.initialized = true;
    this.loadState();
    if (this.optout) {
      // optOut 持久：不拉配置、不发任何东西（一次回执已在 optOut() 时发出）
      this.ready = true;
      this.hold = [];
      return;
    }
    await this.fetchCfg();
    this.ready = true;
    if (this.pendingConsentReceipt) {
      this.pendingConsentReceipt = false;
      this.idOp('consent', { c: this.consentBits() }, true);
    }
    this.applyGate();
    const calls = this.pending;
    this.pending = [];
    for (const c of calls) this.guard(c);
  }

  private loadState(): void {
    const s = this.A.storage;
    const g = (k: string) => {
      try {
        return s.get(k);
      } catch {
        return null;
      }
    };
    this.consent = safeParse(g(K.consent), null);
    this.optout = g(K.optout) === '1';
    this.child = g(K.child) === '1';
    this.auth = safeParse<LoginState | null>(g(K.login), null);
    this.group = g(K.group) || null;
    this.superProps = safeParse<Record<string, PropValue>>(g(K.superProps), {}) || {};
    const first = Number(g(K.first));
    if (first > 0) this.firstTs = first;
    else {
      this.firstTs = this.now();
      this.firstLaunch = true;
      this.set(K.first, String(this.firstTs));
    }
    const did = g(K.did);
    if (did && DEVICE_ID_RE.test(did)) this.did = did;
  }

  private async fetchCfg(): Promise<void> {
    const cached = safeParse<{ cfg: ServerCfg; at: number } | null>(this.get(K.cfg), null);
    let fetched: ServerCfg | null = null;
    try {
      const res = await this.A.transport.get(`${this.endpoint()}/api/v1/pulse/cfg?s=${encodeURIComponent(this.cfg.siteKey)}&pt=${this.platform}`);
      if (res.status === 200 && res.body) {
        const j = safeParse<ServerCfg | null>(res.body, null);
        if (j && typeof j.t === 'number') fetched = j;
      } else if (res.status === 404) this.fail('cfg_failed', 'site not found or paused');
    } catch (e) {
      this.fail('cfg_failed', String(e));
    }
    if (fetched) {
      this.server = fetched;
      this.set(K.cfg, JSON.stringify({ cfg: fetched, at: this.now() }));
    } else if (cached && cached.cfg && this.now() - cached.at < Math.max(CFG_CACHE_MS, (cached.cfg.rc?.ttl ?? 0) * 1000)) {
      this.server = cached.cfg;
    } else {
      this.server = { t: 2 };
      if (!fetched) this.fail('cfg_failed', 'no cfg; conservative defaults (t=2)');
    }
    this.rc = normalizeRc(this.server.rc);
    if (this.rc.minVersion && compareSemver(LIB_VERSION, this.rc.minVersion) < 0) {
      this.outdated = true;
      this.fail('sdk_outdated', `sdk ${LIB_VERSION} < minVersion ${this.rc.minVersion}`);
    }
  }

  // ---------------------------------------------------------------- 同意门
  private requireConsent(): boolean {
    return !!this.cfg.requireConsent || !!(this.server.cs && this.server.cs.req) || this.rc.requireConsent || this.cnMode();
  }
  private cnMode(): boolean {
    return this.cfg.region === 'cn' || !!this.server.cn || !!(this.server.cs && this.server.cs.cn);
  }
  private consentBits(): number {
    return this.consent ? this.consent.c : 0;
  }
  private granted(): boolean {
    return !this.requireConsent() || !!(this.consentBits() & 1);
  }
  private dropMode(): boolean {
    return !!(this.server.cs && this.server.cs.pre === 'drop');
  }
  private canDid(): boolean {
    return !this.child && this.server.t >= 3 && this.granted();
  }
  /** 采集是否开放（cfg 已到 + 同意 + 未 optOut + 未 stop）；远程 enabled=false 时仍入队但不发送 */
  private open(): boolean {
    return this.ready && this.granted() && !this.optout && !this.stopped;
  }
  private canSend(): boolean {
    return this.open() && this.enabled && !this.outdated;
  }

  /** cfg 到达 / 同意变化 / optIn 后重新判定 */
  private applyGate(): void {
    if (this.optout) return;
    if (!this.granted()) {
      if (this.dropMode()) this.hold = [];
      return;
    }
    // 已授予（或不要求同意）
    this.ensureDid();
    this.enabled = this.rc.enabled && !(this.did && this.rc.deviceBlacklist.indexOf(this.did) >= 0);
    if (!Object.keys(this.device).length) this.readDevice();
    if (!this.queue.loaded) this.queue.load();
    if (!this.sid) this.startSession('init');
    this.sampled = this.rc.sample >= 100 || fnv1a(this.did || this.sid || '') % 100 < this.rc.sample;
    if (this.launchPending) this.emitLaunch();
    else if (this.pageViewPending && this.page) this.emitPageView(this.page);
    const holdIdentity = (this.cfg.holdUntilIdentified || !!this.server.h) && !this.auth;
    if (holdIdentity) {
      this.identityHold = true;
      this.identityHoldTimer = this.A.timers.setTimeout(() => this.guard(() => this.releaseIdentityHold()), IDENTITY_HOLD_MS);
    } else this.releaseHold();
    this.startInterval();
    this.applyAutoTrack();
    if (this.policy.onLaunch) this.flush();
  }

  private autoTrackOn = false;
  /** 全埋点点击（小程序默认关）：config.autoTrack 且远程 rc.autotrack */
  private applyAutoTrack(): void {
    const hook = this.A.autoTrack;
    if (!hook) return;
    const want = !!this.cfg.autoTrack && this.rc.autotrack;
    if (want === this.autoTrackOn) return;
    this.autoTrackOn = want;
    if (!want) {
      hook.disable();
      return;
    }
    hook.enable((el, page) => {
      if (this.rc.elementBlacklist.length && ((el.id && this.rc.elementBlacklist.indexOf(el.id) >= 0) || (el.path && this.rc.elementBlacklist.indexOf(el.path) >= 0))) return;
      const p: Props = { $element_type: el.type ?? null, $element_id: el.id ?? null, $element_path: el.path ?? null, $screen_name: page?.path ?? this.page?.path ?? null };
      if (this.rc.textCapture && el.content) p.$element_content = sha256(el.content).slice(0, 16);
      this.trackInternal('$app_click', p, page ?? undefined);
    });
  }

  private releaseIdentityHold(): void {
    if (!this.identityHold) return;
    this.identityHold = false;
    if (this.identityHoldTimer) this.A.timers.clearTimeout(this.identityHoldTimer);
    this.identityHoldTimer = null;
    this.releaseHold();
    this.flush();
  }

  private releaseHold(): void {
    if (!this.open() || this.identityHold) return;
    const items = this.hold;
    this.hold = [];
    for (const h of items) {
      if (!this.sampled) continue;
      const p = h.build();
      if (p.n && this.rc.blacklist.indexOf(p.n) >= 0) continue;
      p.ts = h.ts;
      p.mid = h.mid;
      this.queue.push(p);
    }
    this.maybeFlushByThreshold();
  }

  private readDevice(): void {
    try {
      this.device = this.A.device.read() || {};
    } catch (e) {
      this.fail('internal', `device read: ${String(e)}`);
    }
    try {
      void this.A.device.networkType().then(
        (t) => (this.networkType = t || 'unknown'),
        () => undefined,
      );
    } catch {
      /* ignore */
    }
  }

  private ensureDid(): void {
    if (!this.canDid()) return;
    if (!this.did) {
      const custom = this.cfg.deviceId;
      if (custom && /^[A-Za-z0-9_-]{8,64}$/.test(custom)) this.did = `custom:${custom}`;
      else if (custom && DEVICE_ID_RE.test(custom)) this.did = custom;
      else {
        const native = this.A.device.deviceId?.();
        if (native && DEVICE_ID_RE.test(native)) this.did = native;
        else {
          const prefix = this.platform === 'ios' ? 'ios_idfv' : this.platform === 'harmony' ? 'harmony_odid' : 'android_id';
          this.did = `${prefix}:${(this.now().toString(16) + '000000000000').slice(0, 12)}${randomHex(this.A.timers.random, 10)}`;
        }
      }
    }
    this.set(K.did, this.did);
  }
  private dropDid(): void {
    this.did = null;
    this.remove(K.did);
  }

  // ---------------------------------------------------------------- 会话
  private startSession(reason: Parameters<SessionListener>[1]): void {
    this.sid = randomHex(this.A.timers.random, 16);
    this.sessionStart = this.now();
    this.sessionCount++;
    this.fgAccum = 0;
    if (this.foreground) this.fgSince = this.sessionStart;
    for (const f of this.sessionListeners) this.guard(() => f(this.sid as string, reason));
  }
  private sessionExpired(): boolean {
    if (!this.sid) return true;
    const now = this.now();
    if (now - this.sessionStart > SESSION_MAX_MS) return true;
    if (!this.hideAt) return false;
    const timeout = (this.cfg.sessionTimeoutSec ?? 30) * 1000;
    return now - this.hideAt >= timeout + SESSION_COOLDOWN_MS;
  }
  private foregroundSeconds(): number {
    let ms = this.fgAccum;
    if (this.foreground && this.fgSince) ms += this.now() - this.fgSince;
    return Math.max(0, Math.round(ms / 1000));
  }

  // ---------------------------------------------------------------- 生命周期
  private handleLaunch(info: LaunchInfo): void {
    this.launch = info || {};
    this.latestScene = info?.scene;
    const q = info?.query || {};
    if (q.tc_sd) {
      this.shareFrom = String(q.tc_sd).slice(0, 64);
      this.shareDepth = Math.min(99, parseInt(String(q.tc_sdp || '1'), 10) || 1);
    }
    this.launchPending = true;
    if (this.open()) this.emitLaunch();
  }
  private emitLaunch(): void {
    if (!this.launchPending) return;
    this.launchPending = false;
    this.replayPendingAppEnd();
    this.foreground = true;
    this.fgSince = this.now();
    if (this.firstLaunch) this.trackInternal('$app_install', { $install_time: this.firstTs });
    const dur = this.launchDurationMs();
    this.trackInternal('$app_start', { $start_type: 'cold', $resume_from_background: false, $duration_ms: dur });
    if (this.pageViewPending && this.page) this.emitPageView(this.page);
  }
  private launchDurationMs(): number {
    const n = this.launch?.query?.duration_ms;
    const v = n != null ? Number(n) : 0;
    return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
  }
  private replayPendingAppEnd(): void {
    const raw = this.get('tc_end_pending');
    if (!raw) return;
    this.remove('tc_end_pending');
    const sec = Number(raw);
    if (sec > 0) this.trackInternal('$app_end', { $event_duration: sec }, undefined, this.hideAt || this.now());
  }
  private handleShow(info: LaunchInfo): void {
    if (info && info.scene !== undefined) this.latestScene = info.scene;
    if (this.launchPending) return;
    if (this.foreground) return;
    this.foreground = true;
    this.fgSince = this.now();
    if (this.page) this.pageShownAt = this.now();
    if (!this.open()) return;
    if (this.sessionExpired()) {
      this.emitAppEnd();
      this.startSession(this.now() - this.sessionStart > SESSION_MAX_MS ? 'max_age' : 'timeout');
      this.hideAt = 0;
      this.trackInternal('$app_start', { $start_type: 'hot', $resume_from_background: true, $duration_ms: 0 });
    }
  }
  private handleHide(): void {
    if (!this.foreground) return;
    this.foreground = false;
    const now = this.now();
    this.hideAt = now;
    if (this.fgSince) this.fgAccum += now - this.fgSince;
    this.fgSince = 0;
    if (this.page && this.pageShownAt) {
      this.pageAccum += now - this.pageShownAt;
      this.pageShownAt = 0;
    }
    this.set('tc_end_pending', String(Math.round(this.fgAccum / 1000)));
    if (!this.open()) return;
    if (this.policy.onBackground) this.flush();
  }
  private emitAppEnd(): void {
    const sec = this.foregroundSeconds();
    this.remove('tc_end_pending');
    if (sec >= 0) this.trackInternal('$app_end', { $event_duration: sec });
    this.fgAccum = 0;
  }
  private handlePageShow(page: PageInfo): void {
    if (this.page && this.page.path !== page.path) this.previousScreen = this.page.path;
    this.page = page;
    this.pageShownAt = this.now();
    this.pageAccum = 0;
    if (this.cfg.autoTrackScreens === false) return;
    // stop / optOut：完全停采，不挂起待发（01 §3 stop = 含页面事件）
    if (this.stopped || this.optout) return;
    // cfg 未到 / 未同意 / launch 未发：记为待发，随 launch 或放行一起发（避免 hold 与 launch 重复）
    if (!this.open() || this.launchPending) {
      this.pageViewPending = true;
      return;
    }
    this.emitPageView(page);
  }
  private emitPageView(page: PageInfo): void {
    this.pageViewPending = false;
    this.trackInternal('$screen_view', this.screenProps(page, this.previousScreen), page);
  }
  private screenProps(page: PageInfo, prev?: string): Props {
    return { $path: page.path, $screen_name: page.path, $query: page.query && Object.keys(page.query).length ? JSON.stringify(page.query) : null, $title: page.title ?? null, $previous_screen: prev ?? null };
  }
  private handlePageHide(page: PageInfo): void {
    let ms = this.pageAccum;
    if (this.pageShownAt) ms += this.now() - this.pageShownAt;
    this.pageShownAt = 0;
    this.pageAccum = 0;
    if (this.cfg.autoTrackScreens === false) return;
    this.trackInternal('$screen_leave', { $path: page.path, $screen_name: page.path, $duration: Math.round(ms / 1000) }, page);
  }
  private handleShare(page: PageInfo, method: string): void {
    this.trackInternal('$deeplink_launch', { $deeplink_url: page.path, $referrer_app: method || null }, page);
  }

  // ---------------------------------------------------------------- 事件构造
  private now(): number {
    return this.A.timers.now();
  }
  private pageUrl(page?: PageInfo | null): string {
    const host = (this.cfg.appId || this.platform).toLowerCase();
    const p = page || this.page;
    const path = p ? p.path.replace(/^\/+/, '') : '';
    return `https://${host}/${path}`.slice(0, LIMITS.url);
  }
  private presetProps(): Record<string, PropValue> {
    const d = this.device;
    const out: Record<string, PropValue> = { $lib: libName(this.platform), $lib_version: LIB_VERSION };
    out.$app_state = this.foreground ? 'foreground' : 'background';
    if (this.cfg.appId) out.$app_id = this.cfg.appId;
    if (this.cfg.appVersion) out.$app_version = this.cfg.appVersion;
    if (d.os) out.$os = d.os;
    if (d.osVersion) out.$os_version = d.osVersion;
    if (d.brand) out.$device_brand = d.brand;
    if (d.model) out.$device_model = d.model;
    out.$device_type = d.deviceType || 'phone';
    if (d.screenWidth) out.$screen_width = d.screenWidth;
    if (d.screenHeight) out.$screen_height = d.screenHeight;
    if (d.hostVersion) out.$host_version = d.hostVersion;
    out.$network_type = this.networkType;
    if (this.launch && this.launch.scene !== undefined) out.$scene = this.launch.scene;
    if (this.latestScene !== undefined) out.$latest_scene = this.latestScene;
    if (this.shareFrom) {
      out.$share_distinct_id = this.shareFrom;
      out.$share_depth = this.shareDepth;
    }
    out.$is_first_day = this.now() - this.firstTs < 86400000;
    out.$is_first_time = this.firstLaunch;
    return out;
  }
  private base(t: 'ev' | 'id', page?: PageInfo | null): Payload {
    const p: Payload = { v: 2, s: this.cfg.siteKey, t, u: this.pageUrl(page), pt: this.platform, lib: this.lib(), ts: this.now(), mid: uuidV4(this.A.timers.random) };
    if (this.sid) p.sid = this.sid;
    if (this.did) p.did = this.did;
    if (this.consent) p.c = this.consent.c;
    if (this.child) p.cm = 1;
    if (this.group) p.g = this.group;
    const d = this.device;
    if (d.screenWidth && d.screenHeight) p.sc = `${d.screenWidth}x${d.screenHeight}`;
    if (d.locale) p.l = d.locale.slice(0, 20);
    if (d.timezone) p.tz = d.timezone.slice(0, 50);
    return p;
  }
  private buildEvent(name: string, props?: Props, page?: PageInfo | null, extra?: Partial<Payload>): Payload {
    const p = this.base('ev', page);
    p.n = name;
    const title = (page || this.page)?.title;
    if (title) p.ti = title.slice(0, LIMITS.title);
    const merged: Props = { ...this.presetProps(), ...this.superProps, ...(props || {}) };
    p.p = normProps(merged);
    if (extra) Object.assign(p, extra);
    return p;
  }

  // ---------------------------------------------------------------- 入队 / hold
  private holdOrDrop(build: () => Payload, ts?: number): void {
    if (this.optout || this.stopped) return;
    if (this.ready && this.dropMode() && !this.granted()) return;
    if (this.hold.length >= HOLD_MAX) {
      this.hold.shift();
      this.fail('hold_overflow', 'pre-consent hold full, dropped oldest');
    }
    this.hold.push({ ts: ts ?? this.now(), mid: uuidV4(this.A.timers.random), build });
  }
  private enqueue(build: () => Payload, ts?: number): void {
    if (this.optout || this.stopped) return;
    if (!this.open() || this.identityHold) {
      this.holdOrDrop(build, ts);
      return;
    }
    if (!this.sampled) return;
    const p = build();
    if (ts) p.ts = ts;
    this.queue.push(p);
    this.maybeFlushByThreshold();
  }
  private maybeFlushByThreshold(): void {
    const th = this.rc.threshold !== DEFAULT_RC.threshold ? this.rc.threshold : this.policy.threshold;
    if (th > 0 && this.queue.length >= th) this.flush();
  }
  private trackInternal(name: string, props?: Props, page?: PageInfo | null, ts?: number, extra?: Partial<Payload>): void {
    if (this.rc.blacklist.indexOf(name) >= 0) return;
    this.enqueue(() => this.buildEvent(name, props, page, extra), ts);
  }

  // ---------------------------------------------------------------- 发送
  private endpoint(): string {
    return this.endpoints[this.endpointIdx % this.endpoints.length];
  }
  private startInterval(): void {
    if (this.intervalTimer) return;
    const sec = this.rc.interval !== DEFAULT_RC.interval ? this.rc.interval : this.policy.intervalSec;
    if (sec > 0) {
      this.intervalTimer = this.A.timers.setInterval(() => {
        // 退避重试期间不另起发送，避免 interval 把退避打穿（01 §7）
        if (this.retryTimer || this.sending) return;
        this.guard(() => this.flush());
      }, sec * 1000);
    }
  }
  private stopTimers(): void {
    if (this.intervalTimer) this.A.timers.clearInterval(this.intervalTimer);
    this.intervalTimer = null;
    if (this.retryTimer) this.A.timers.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  flush(): void {
    if (this.sending || !this.canSend()) return;
    const batch = this.queue.peek();
    if (!batch.length) return;
    this.sending = true;
    const req: BatchRequest = { sent: this.now(), items: batch };
    const url = `${this.endpoint()}/api/v1/pulse`;
    this.log('debug', `POST ${url} ×${batch.length}`, batch);
    this.A.transport
      .post(url, JSON.stringify(req), { 'Content-Type': 'text/plain', 'X-Tc-Lib': this.lib() })
      .then(
        (res) => this.onSent(res.status, batch),
        (e) => {
          this.log('debug', `network error: ${String(e)}`);
          this.onSent(0, batch);
        },
      )
      .catch((e) => this.fail('internal', String(e)));
  }
  /** 直发（同意 / optOut 回执）：绕过队列与 hold */
  private sendDirect(p: Payload): void {
    const url = `${this.endpoint()}/api/v1/pulse`;
    try {
      this.A.transport.post(url, JSON.stringify({ sent: this.now(), items: [p] }), { 'Content-Type': 'text/plain', 'X-Tc-Lib': this.lib() }).catch(() => undefined);
    } catch {
      /* ignore */
    }
  }
  private onSent(status: number, batch: Payload[]): void {
    this.sending = false;
    const count = batch.length;
    if (status >= 200 && status < 300) {
      this.queue.ack(batch);
      this.failures = 0;
      this.attempt = 0;
      if (this.queue.length) this.flush();
      return;
    }
    if (status === 429 || status >= 500 || status === 0) {
      this.failures++;
      this.attempt++;
      if (this.failures >= FAILURES_BEFORE_SWITCH && this.endpoints.length > 1) {
        this.endpointIdx = (this.endpointIdx + 1) % this.endpoints.length;
        this.failures = 0;
        this.log('debug', `switch endpoint → ${this.endpoint()}`);
      }
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * Math.pow(2, Math.min(this.attempt - 1, 20)));
      if (this.retryTimer) this.A.timers.clearTimeout(this.retryTimer);
      this.retryTimer = this.A.timers.setTimeout(() => {
        this.retryTimer = null;
        this.guard(() => this.flush());
      }, delay);
      return;
    }
    // 其它 4xx：结构错误不会自愈，丢弃该批
    this.queue.ack(batch);
    this.fail('send_failed', `HTTP ${status}, batch of ${count} dropped`);
    if (this.queue.length) this.flush();
  }

  // ---------------------------------------------------------------- 公开 API：采集
  track(name: string, props?: Props): void {
    this.guard(() => {
      if (this.optout || this.stopped) return;
      let n = String(name ?? '').trim();
      if (!n) return;
      if (n.length > LIMITS.name) n = n.slice(0, LIMITS.name);
      // 用户不能伪造预置事件：非预置的 $ 前缀由服务端去掉，这里直接去掉以免歧义
      if (n.charCodeAt(0) === 36 && !/^\$((app_(install|start|end|click|update|crashed))|anr|ui_freeze|rage_tap|deeplink_launch|push_click|in_app_purchase|ad_impression|fps_sample|memory_sample|screen_view|screen_leave|os_update|user_engagement)$/.test(n)) n = n.slice(1);
      if (!this.initialized) {
        const ts = this.now();
        this.pending.push(() => this.trackInternal(n, props, undefined, ts));
        return;
      }
      this.trackInternal(n, props);
    });
  }
  trackScreen(name: string, props?: Props): void {
    this.guard(() => {
      const path = String(name ?? '').trim().slice(0, 200);
      if (!path) return;
      const page: PageInfo = { path, title: typeof props?.$title === 'string' ? props.$title : undefined };
      const prev = this.page?.path;
      this.page = page;
      this.pageShownAt = this.now();
      this.trackInternal('$screen_view', { ...this.screenProps(page, prev), ...(props || {}) }, page);
    });
  }

  // ---------------------------------------------------------------- 公开 API：身份
  private identityAllowed(): boolean {
    if (!this.ready) return true;
    if (this.server.t < 3) {
      this.fail('identity_blocked_by_tier', 'tier < 3');
      return false;
    }
    if (!this.server.i) {
      this.log('debug', 'identity ops ignored: site is anonymous mode');
      return false;
    }
    return true;
  }
  private idOp(op: IdentityOp, extra?: Partial<Payload>, receipt = false): void {
    const build = () => {
      const p = this.base('id');
      p.op = op;
      if (extra) Object.assign(p, extra);
      return p;
    };
    if (receipt) {
      this.sendDirect(build());
      return;
    }
    if (!this.open()) {
      this.holdOrDrop(build);
      return;
    }
    this.queue.push(build());
    this.flush();
  }
  private idsFromProps(props?: Props): Partial<Record<LoginIdType, string>> | undefined {
    if (!props) return undefined;
    const ids: Partial<Record<LoginIdType, string>> = {};
    const e = props.$email;
    const m = props.$phone;
    if (typeof e === 'string' && e) ids.email = sha256(normId('email', e));
    if (typeof m === 'string' && m) ids.mobile = sha256(normId('mobile', m));
    return Object.keys(ids).length ? ids : undefined;
  }

  login(id: string | number, props?: Props, opts?: { type?: LoginIdType }): void {
    this.guard(() => {
      if (!this.initialized || !this.ready) {
        this.pending.push(() => this.login(id, props, opts));
        return;
      }
      if (this.optout) return;
      let v = String(id == null ? '' : id).trim();
      const type: LoginIdType = opts?.type || 'login';
      if (!v || v.length > LOGIN_ID_MAX || BLOCKED_ID_RE.test(v)) {
        this.fail('invalid_login_id', `blocked or empty id for type ${type}`);
        return;
      }
      if (!this.identityAllowed()) return;
      if (type === 'email' || type === 'mobile') v = HEX64.test(v) ? v.toLowerCase() : sha256(normId(type, v));
      const switching = !!this.auth && (this.auth.id !== v || this.auth.type !== type);
      const same = !!this.auth && !switching;
      this.auth = { id: v, type };
      this.set(K.login, JSON.stringify(this.auth));
      if (switching) {
        this.hideAt = 0;
        this.fgAccum = 0;
        if (this.foreground) this.fgSince = this.now();
        this.startSession('login');
      }
      this.ensureDid();
      if (!same || props) {
        this.idOp('login', { id: v, idt: type, h: 1, props: normProps(props, LIMITS.profileKeys), ids: this.idsFromProps(props), src: 'sdk' });
      }
      this.releaseIdentityHold();
    });
  }
  logout(): void {
    this.guard(() => {
      if (!this.initialized || !this.ready) {
        this.pending.push(() => this.logout());
        return;
      }
      if (!this.auth) return;
      this.auth = null;
      this.remove(K.login);
      this.hideAt = 0;
      this.startSession('logout');
      if (this.identityAllowed()) this.idOp('logout');
    });
  }
  bind(ids: Partial<Record<LoginIdType, string>>): void {
    this.guard(() => {
      if (!this.ready) {
        this.pending.push(() => this.bind(ids));
        return;
      }
      if (!this.identityAllowed()) return;
      const out: Partial<Record<LoginIdType, string>> = {};
      for (const k of Object.keys(ids || {}) as LoginIdType[]) {
        const v = ids[k];
        if (!v) continue;
        const s = String(v).trim();
        if (!s || s.length > LOGIN_ID_MAX || BLOCKED_ID_RE.test(s)) continue;
        out[k] = k === 'email' || k === 'mobile' ? (HEX64.test(s) ? s.toLowerCase() : sha256(normId(k, s))) : s;
      }
      if (Object.keys(out).length) this.idOp('bind', { ids: out, h: 1 });
    });
  }
  setProps(props: Props): void {
    this.profileOp('set', props);
  }
  setPropsOnce(props: Props): void {
    this.profileOp('set_once', props);
  }
  unsetProps(keys: string[]): void {
    this.guard(() => {
      if (!this.ready) {
        this.pending.push(() => this.unsetProps(keys));
        return;
      }
      if (!this.identityAllowed()) return;
      const list = (keys || []).filter((k) => typeof k === 'string' && k && k.length <= LIMITS.propKey).slice(0, LIMITS.profileKeys);
      if (list.length) this.idOp('unset', { unset: list, h: 1 });
    });
  }
  private profileOp(op: 'set' | 'set_once', props: Props): void {
    this.guard(() => {
      if (!this.ready) {
        this.pending.push(() => this.profileOp(op, props));
        return;
      }
      if (!this.identityAllowed()) return;
      const p = normProps(props, LIMITS.profileKeys);
      if (!p || !Object.keys(p).length) return;
      this.idOp(op, op === 'set' ? { props: p, ids: this.idsFromProps(props), h: 1 } : { once: p, ids: this.idsFromProps(props), h: 1 });
    });
  }
  setGroup(type: string, id?: string | number | null, traits?: Props): void {
    this.guard(() => {
      const t = String(type || '').toLowerCase();
      const v = id == null ? '' : String(id).trim();
      if (!/^[a-z][a-z0-9_]{0,23}$/.test(t) || v.length > 80) return;
      this.group = v ? `${t}:${v}` : null;
      if (this.group) this.set(K.group, this.group);
      else this.remove(K.group);
      if (!this.ready) {
        if (this.group) this.pending.push(() => this.idOp('group', { g: this.group as string, props: normProps(traits, LIMITS.profileKeys), h: 1 }));
        return;
      }
      if (this.group && this.identityAllowed()) this.idOp('group', { g: this.group, props: normProps(traits, LIMITS.profileKeys), h: 1 });
    });
  }
  reset(): void {
    this.guard(() => {
      if (!this.ready) {
        this.pending.push(() => this.reset());
        return;
      }
      this.dropDid();
      this.auth = null;
      this.remove(K.login);
      this.hideAt = 0;
      this.startSession('logout');
      this.ensureDid();
      if (this.identityAllowed()) this.idOp('reset');
    });
  }
  /** 别名（phase3/01 §3）：删标识，继续匿名聚合 */
  anonymize(): void {
    this.reset();
  }

  // ---------------------------------------------------------------- 公开 API：同意 / 合规
  grantConsent(purposes: ConsentPurpose[] | number): void {
    this.guard(() => {
      let c = typeof purposes === 'number' ? purposes & 7 : 0;
      if (Array.isArray(purposes)) for (const p of purposes) c |= p === 'analytics' ? 1 : p === 'functional' ? 2 : p === 'marketing' ? 4 : 0;
      this.consent = { c, ver: this.server.cs ? this.server.cs.ver : null };
      this.set(K.consent, JSON.stringify(this.consent));
      if (!(c & 1)) {
        this.set(K.rejectAt, String(this.now()));
        this.dropDid();
        this.queue.purge();
        if (this.cnMode()) this.hold = [];
      } else this.remove(K.rejectAt);
      if (this.initialized && this.ready && !this.optout) {
        this.idOp('consent', { c }, true);
        if (c & 1) this.applyGate();
        else this.stopTimers();
      } else if (!this.optout) this.pendingConsentReceipt = true;
      for (const f of this.consentListeners) this.guard(() => f(c));
    });
  }
  revokeConsent(): void {
    this.grantConsent(0);
  }
  getConsent(): number {
    return this.consentBits();
  }
  optOut(): void {
    this.guard(() => {
      if (this.optout) return;
      this.optout = true;
      this.set(K.optout, '1');
      if (this.initialized && this.ready) this.idOp('optout', { c: 0 }, true);
      this.dropDid();
      this.queue.purge();
      this.hold = [];
      this.stopTimers();
    });
  }
  optIn(): void {
    this.guard(() => {
      if (!this.optout) return;
      this.optout = false;
      this.remove(K.optout);
      if (this.initialized && this.ready) {
        this.idOp('optin', { c: this.consentBits() }, true);
        this.applyGate();
      }
    });
  }
  setRestricted(on: boolean): void {
    if (on === false) this.optIn();
    else this.optOut();
  }
  setChildMode(on: boolean): void {
    this.guard(() => {
      this.child = on !== false;
      if (this.child) {
        this.set(K.child, '1');
        this.dropDid();
      } else this.remove(K.child);
    });
  }
  setDataRegion(region: 'eu' | 'us' | 'cn'): void {
    if (this.initialized) {
      this.fail('internal', 'setDataRegion must be called before init()');
      return;
    }
    this.cfg.region = region;
  }
  /** 国内模式：是否应展示同意弹窗（未决定 / 拒绝已过冷静期） */
  shouldPrompt(): boolean {
    if (this.consent && this.consent.c & 1) return false;
    const r = Number(this.get(K.rejectAt) || 0);
    const days = this.cfg.rejectCooldownDays || (this.server.cs && this.server.cs.rej) || 7;
    return !r || this.now() - r > days * 86400000;
  }
  stop(): void {
    this.stopped = true;
    this.stopTimers();
  }
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    if (this.ready) this.applyGate();
  }

  // ---------------------------------------------------------------- 公开 API：属性 / 读数 / 回调
  registerSuperProps(props: Props): void {
    this.guard(() => {
      const p = normProps(props) || {};
      for (const k of Object.keys(p)) if (k.charCodeAt(0) !== 36) this.superProps[k] = p[k];
      this.set(K.superProps, JSON.stringify(this.superProps));
    });
  }
  unregisterSuperProp(key: string): void {
    this.guard(() => {
      delete this.superProps[key];
      this.set(K.superProps, JSON.stringify(this.superProps));
    });
  }
  /** 分享链路：给分享 path 追加 tc_sd / tc_sdp，被分享者启动时带出 $share_distinct_id / $share_depth */
  withShareParams(path: string): string {
    const sd = this.did ? fnv1a(this.did).toString(36) : this.sid ? this.sid.slice(0, 8) : '';
    if (!sd) return path;
    const sep = path.indexOf('?') >= 0 ? '&' : '?';
    return `${path}${sep}tc_sd=${sd}&tc_sdp=${this.shareDepth + 1}`;
  }
  getDeviceId(): string | null {
    return this.did;
  }
  getSessionId(): string | null {
    return this.sid;
  }
  getConfig(): Readonly<TapCubConfig> {
    return this.cfg;
  }
  getRemoteConfig(): Readonly<RemoteConfig> {
    return this.rc;
  }
  requiredPrivacyApis(): string[] {
    return [];
  }
  /** 崩溃 / ANR / 冻结（适配层 CrashHook 或宿主手动） */
  reportException(ev: CrashEvent): void {
    this.guard(() => {
      if (this.cfg.crashReport === false) return;
      const type = String(ev.type || ev.kind).slice(0, 80);
      const msg = String(ev.message || '').slice(0, LIMITS.message);
      const st = String(ev.stack || '').slice(0, LIMITS.stack);
      const top = st.split('\n').find((l) => l.trim()) || type;
      const group = sha256(type + top.replace(/\d+/g, '')).slice(0, 40);
      const name = ev.kind === 'anr' ? '$anr' : ev.kind === 'freeze' ? '$ui_freeze' : '$app_crashed';
      this.trackInternal(
        name,
        {
          $fatal: ev.fatal !== false,
          $exception_type: type,
          $exception_message: msg,
          $group: group,
          $foreground: ev.foreground !== false,
          $duration_ms: ev.durationMs ?? null,
          $stack_top: top.slice(0, 200),
        },
        undefined,
        ev.ts && ev.ts > 0 ? ev.ts : undefined,
        st ? { st } : undefined,
      );
    });
  }
  trackPurchase(info: Props): void {
    this.track('$in_app_purchase', info);
  }
  trackPushClick(payload: Props): void {
    this.track('$push_click', payload);
  }
  setAttribution(attrs: Props): void {
    this.registerSuperProps(attrs);
  }
  trackDeeplink(url: string, referrer?: string): void {
    const clean = String(url || '').replace(/([?&])(token|code|auth|password|pwd)=[^&]*/gi, '$1$2=');
    this.trackInternal('$deeplink_launch', { $deeplink_url: clean.slice(0, 500), $referrer_app: referrer ?? null });
  }
  onConsentChange(cb: ConsentListener): void {
    if (typeof cb === 'function') this.consentListeners.push(cb);
  }
  onSessionStart(cb: SessionListener): void {
    if (typeof cb === 'function') this.sessionListeners.push(cb);
  }
  onError(cb: ErrorListener): void {
    if (typeof cb === 'function') this.errorListeners.push(cb);
  }
  /** 供测试 / 调试读取内部状态 */
  getState(): SdkState {
    return {
      initialized: this.initialized,
      deviceId: this.did,
      sessionId: this.sid,
      consent: this.consent ? this.consent.c : null,
      optedOut: this.optout,
      loginId: this.auth ? this.auth.id : null,
      loginType: this.auth ? this.auth.type : null,
      queueLength: this.queue.length,
      holdLength: this.hold.length,
      enabled: this.enabled && !this.outdated,
      sampled: this.sampled,
      tier: this.server.t,
      endpoint: this.endpoint(),
      sessionCount: this.sessionCount,
    };
  }
  getErrors(): ReadonlyArray<{ code: ErrorCode; message: string }> {
    return this.errors;
  }

  // ---------------------------------------------------------------- 工具
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.fail('internal', String(e));
    }
  }
  private fail(code: ErrorCode, message: string): void {
    if (this.errors.length < 100) this.errors.push({ code, message });
    this.log('error', `[${code}] ${message}`);
    for (const f of this.errorListeners) {
      try {
        f(code, message);
      } catch {
        /* ignore */
      }
    }
  }
  private log(level: 'error' | 'debug', msg: string, extra?: unknown): void {
    if (level === 'debug' && !this.cfg.debug) return;
    try {
      this.A.log?.(level, msg, extra);
    } catch {
      /* ignore */
    }
  }
  private get(k: string): string | null {
    try {
      return this.A.storage.get(k);
    } catch {
      return null;
    }
  }
  private set(k: string, v: string): void {
    try {
      this.A.storage.set(k, v);
    } catch (e) {
      this.fail('storage_failed', `${k}: ${String(e)}`);
    }
  }
  private remove(k: string): void {
    try {
      this.A.storage.remove(k);
    } catch {
      /* ignore */
    }
  }
}
