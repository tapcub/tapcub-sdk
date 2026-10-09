/**
 * 核心与适配层之间的固定协议（dev_behavior_phase3/01 §1）：Storage / Transport / Lifecycle / DeviceInfo / AutoTrackHook / Timers。
 * 全部同步或 Promise，便于用 mock 适配跑一致性向量（§11）。
 */

export type MpPlatform = 'mp_weixin' | 'mp_alipay' | 'mp_bytedance';
export type Region = 'auto' | 'eu' | 'us' | 'cn';
export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue | null | undefined>;

export interface ReportPolicy {
  onLaunch: boolean;
  onBackground: boolean;
  intervalSec: number;
  threshold: number;
}
export interface QueueLimits {
  maxEvents: number;
  maxDays: number;
  maxBatch: number;
  maxBytes: number;
  /** 持久层总字节上限（小程序 storage 限制，phase3/01 §13：≤ 1 MB） */
  maxStorageBytes: number;
}

export interface TapCubConfig {
  siteKey: string;
  /** 收数域名（不含路径）；缺省用 endpoints[0] */
  endpoint?: string;
  /** 主备端点 */
  endpoints?: string[];
  /** 小程序 appid；作为载荷 `u` 的 host（服务端以此校验来源，phase3/14 §2） */
  appId?: string;
  region?: Region;
  /** 全埋点点击（小程序默认关） */
  autoTrack?: boolean;
  /** 自动页面事件 $mp_view_screen / $mp_page_leave */
  autoTrackScreens?: boolean;
  reportPolicy?: Partial<ReportPolicy>;
  queue?: Partial<QueueLimits>;
  sessionTimeoutSec?: number;
  /** 本地强制要求同意（服务端 cfg.cs.req 亦可要求） */
  requireConsent?: boolean;
  /** R8：init 后 800 ms 内暂存事件等 login */
  holdUntilIdentified?: boolean;
  debug?: boolean;
  /** custom 设备 ID（init 前）；否则 mp_uuid */
  deviceId?: string;
  /** 拒绝同意后的冷静期（天），缺省取 cfg.cs.rej 或 7 */
  rejectCooldownDays?: number;
  /** 应用版本（小程序没有统一 API 取版本；宿主可传） */
  appVersion?: string;
}

export type ConsentPurpose = 'analytics' | 'functional' | 'marketing';
export type LoginIdType = 'login' | 'email' | 'mobile' | 'unionid' | 'openid' | 'custom';
export type IdentityOp = 'login' | 'logout' | 'bind' | 'set' | 'set_once' | 'unset' | 'reset' | 'consent' | 'optout' | 'optin' | 'group';

/** 服务端 cfg（GET /api/v1/pulse/cfg 与首个响应同结构） */
export interface ServerCfg {
  t: 1 | 2 | 3;
  i?: 1;
  h?: 1;
  cn?: 1;
  cs?: { req: boolean; pre?: 'drop' | 'queue'; ver?: string | null; cn?: 1; rej?: number };
  rc?: Partial<RemoteConfig>;
}
export interface RemoteConfig {
  enabled: boolean;
  blacklist: string[];
  sample: number;
  interval: number;
  threshold: number;
  deviceBlacklist: string[];
  requireConsent: boolean;
  autotrack: boolean;
  textCapture: boolean;
  elementBlacklist: string[];
  perf: boolean;
  minVersion: string | null;
  ttl: number;
}

/** 协议 v2 载荷（phase1/02）；只列 SDK 会写的字段 */
export interface Payload {
  v: 2;
  s: string;
  t: 'ev' | 'id';
  u: string;
  pt: MpPlatform;
  lib: string;
  ts: number;
  mid: string;
  sid?: string;
  did?: string;
  c?: number;
  cm?: 1;
  g?: string;
  n?: string;
  ti?: string;
  r?: string;
  sc?: string;
  l?: string;
  tz?: string;
  p?: Record<string, PropValue>;
  st?: string;
  d?: number;
  // ---- t:'id' ----
  op?: IdentityOp;
  id?: string;
  idt?: LoginIdType;
  h?: 0 | 1;
  ids?: Partial<Record<LoginIdType, string>>;
  props?: Record<string, PropValue>;
  once?: Record<string, PropValue>;
  unset?: string[];
  src?: 'sdk';
}
export interface BatchRequest {
  sent: number;
  items: Payload[];
}

// ---- 六协议 ----
export interface Storage {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}
export interface TransportResponse {
  status: number;
  body?: string;
}
export interface Transport {
  /** POST JSON；网络错误 → reject 或 status 0 */
  post(url: string, body: string, headers: Record<string, string>): Promise<TransportResponse>;
  get(url: string): Promise<TransportResponse>;
}
export interface LifecycleHandlers {
  onLaunch(info: LaunchInfo): void;
  onShow(info: LaunchInfo): void;
  onHide(): void;
  onPageShow(page: PageInfo): void;
  onPageHide(page: PageInfo): void;
  onShare(page: PageInfo, method: string): void;
  onFavorite(page: PageInfo): void;
}
export interface LaunchInfo {
  scene?: number;
  path?: string;
  query?: Record<string, string>;
  referrerInfo?: { appId?: string; extraData?: unknown };
}
export interface PageInfo {
  path: string;
  query?: Record<string, string>;
  title?: string;
}
export interface Lifecycle {
  /** 注册宿主生命周期；适配层负责挂到 App / Page 或 getApp() 上 */
  bind(handlers: LifecycleHandlers): void;
  /** 当前页面（路径与 query） */
  currentPage(): PageInfo | null;
}
export interface DeviceInfo {
  platform: MpPlatform;
  /** 读取设备信息（init 后才允许调用） */
  read(): DeviceSnapshot;
  networkType(): Promise<string>;
}
export interface DeviceSnapshot {
  os?: string;
  osVersion?: string;
  brand?: string;
  model?: string;
  deviceType?: 'phone' | 'tablet' | 'tv' | 'other';
  screenWidth?: number;
  screenHeight?: number;
  pixelRatio?: number;
  locale?: string;
  timezone?: string;
  hostVersion?: string;
  sdkVersion?: string;
}
export interface Timers {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
  random(): number;
}
export interface AutoTrackHook {
  /** 开启全埋点点击时调用；回调携带元素信息 */
  enable(cb: (el: { type?: string; id?: string; content?: string; path?: string }, page: PageInfo | null) => void): void;
  disable(): void;
}

export interface Adapters {
  storage: Storage;
  transport: Transport;
  lifecycle: Lifecycle;
  device: DeviceInfo;
  timers: Timers;
  autoTrack?: AutoTrackHook;
  log?: (level: 'error' | 'debug', msg: string, extra?: unknown) => void;
}

export type ErrorCode =
  | 'identity_blocked_by_tier'
  | 'sdk_outdated'
  | 'cfg_failed'
  | 'invalid_login_id'
  | 'queue_overflow'
  | 'hold_overflow'
  | 'storage_failed'
  | 'send_failed'
  | 'deprecated'
  | 'internal';

export interface SdkState {
  initialized: boolean;
  deviceId: string | null;
  sessionId: string | null;
  consent: number | null;
  optedOut: boolean;
  loginId: string | null;
  loginType: LoginIdType | null;
  queueLength: number;
  holdLength: number;
  enabled: boolean;
  sampled: boolean;
  tier: 1 | 2 | 3;
  endpoint: string;
  sessionCount: number;
}
