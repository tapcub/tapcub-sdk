export type PropertyValue = string | number | boolean;
/** 事件 / 档案属性：扁平键值；对象数组（如 `items`）保留一层，其余嵌套值转成 JSON 字符串 */
export type Properties = Record<string, PropertyValue | Record<string, PropertyValue>[]>;
export type LoginIdType = 'login' | 'email' | 'mobile' | 'unionid' | 'openid' | 'custom';
export type Platform = 'web' | 'mp_weixin' | 'mp_alipay' | 'mp_bytedance' | 'mp_baidu' | 'mp_kuaishou' | 'mp_qq' | 'android' | 'ios' | 'harmony' | 'tvos' | 'watchos' | 'macos' | 'windows' | 'linux' | 'server' | 'import';

/**
 * Where the user came from. Same shape as the browser's `tapcub.getAttribution()`, so you can pass that result straight through
 * (field names follow the Segment spec plus `ref`, `click_id`, `landing_url`, `referrer`, `touched_at`).
 */
export interface Campaign {
  source?: string;
  medium?: string;
  name?: string;
  term?: string;
  content?: string;
  /** Partner / referral code */
  ref?: string;
  /** `type:value`, for example `gclid:Cj0K…` */
  click_id?: string;
  landing_url?: string;
  referrer?: string;
  /** When the user landed, in milliseconds */
  touched_at?: number;
}

/** Request context, in API field names. Pass `ip` and `user_agent` to let TapCub infer the visit source when there is no cookie. */
export interface TrackContext {
  ip?: string;
  user_agent?: string;
  url?: string;
  platform?: Platform;
  /** ISO 3166-1 alpha-2 */
  country?: string;
  lang?: string;
  campaign?: Campaign;
}

type Input = Record<string, unknown>;

export interface TrackOptions {
  loginId?: string | null;
  loginIdType?: LoginIdType;
  deviceId?: string | null;
  sessionId?: string | null;
  /** Idempotency key (≤36 characters). Not generated for you: pass a natural key such as the order ID if retries must not double count. */
  insertId?: string | null;
  /** Milliseconds or a Date; defaults to now */
  time?: number | Date;
  /** Account key `type:id`, for example `company:acme` */
  group?: string;
  properties?: Input;
  context?: TrackContext | Input;
}

export interface SignupOptions {
  deviceId?: string | null;
  sessionId?: string | null;
  insertId?: string | null;
  time?: number | Date;
  properties?: Input;
  /** Login ID of the user who invited this one; sent as `properties.$invited_by` */
  invitedBy?: string | null;
  context?: TrackContext | Input;
}

export interface WireEvent {
  type: string;
  event?: string;
  login_id?: string;
  login_id_type?: LoginIdType;
  device_id?: string;
  session_id?: string;
  insert_id?: string;
  time: number;
  group?: string;
  properties?: Properties;
  identities?: Record<string, string>;
  increment?: Record<string, number>;
  append?: Record<string, (string | number | boolean)[]>;
  unset?: string[];
  item_type?: string;
  item_id?: string;
  context?: TrackContext;
}

export interface TrackResultItem {
  index: number;
  ok: boolean;
  warnings: string[];
  personId?: string | null;
}

/** Response of `POST /api/v1/track`. In debug mode only `debug` and `results` are set. */
export interface TrackResponse {
  debug?: boolean;
  received?: number;
  accepted?: number;
  rejected?: number;
  events?: number;
  results: TrackResultItem[];
}

export interface Logger {
  debug?(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}
