/**
 * 小程序适配层：以 wx / my / tt 全局对象为参数，实现 Storage / Transport / Lifecycle / DeviceInfo / Timers / AutoTrackHook。
 * 平台差异集中在 `flavor`：支付宝的 storage / request 参数形状不同，其余三端一致。
 * 不调用任何需在隐私协议中声明的接口（不读位置 / 通讯录 / 剪贴板 / 相册），requiredPrivacyApis() 返回空。
 */
import type { Adapters, AutoTrackHook, DeviceInfo, DeviceSnapshot, LaunchInfo, Lifecycle, LifecycleHandlers, MpPlatform, PageInfo, Storage, Timers, Transport } from '../core/types.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any;
type Host = Record<string, any>;

export interface MpAdapterOptions {
  /** 是否 patch 全局 Page()（默认 true）；用框架（uni-app / Taro）时可关掉改用 wrapPage() */
  patchPage?: boolean;
  /** 是否 patch 全局 Component()（默认 true；组件页面 pageLifetimes） */
  patchComponent?: boolean;
}

const g: Host = typeof globalThis !== 'undefined' ? (globalThis as Host) : {};

function pick<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- Storage
function storage(api: Host, platform: MpPlatform): Storage {
  const alipay = platform === 'mp_alipay';
  return {
    get: (key) => {
      const v = alipay ? api.getStorageSync({ key })?.data : api.getStorageSync(key);
      return v === undefined || v === null || v === '' ? null : String(v);
    },
    set: (key, value) => {
      if (alipay) api.setStorageSync({ key, data: value });
      else api.setStorageSync(key, value);
    },
    remove: (key) => {
      if (alipay) api.removeStorageSync({ key });
      else api.removeStorageSync(key);
    },
  };
}

// ---------------------------------------------------------------- Transport
function transport(api: Host, platform: MpPlatform): Transport {
  const alipay = platform === 'mp_alipay';
  const req = (opts: { url: string; method: 'GET' | 'POST'; data?: string; headers: Record<string, string> }) =>
    new Promise<{ status: number; body?: string }>((resolve, reject) => {
      const done = (res: Host) => {
        const status = Number(alipay ? res.status : res.statusCode) || 0;
        const d = res.data;
        resolve({ status, body: typeof d === 'string' ? d : d === undefined || d === null ? undefined : JSON.stringify(d) });
      };
      const fail = (e: unknown) => reject(e);
      const base: Host = { url: opts.url, method: opts.method, data: opts.data, dataType: 'text', timeout: 15000, success: done, fail };
      if (alipay) {
        base.headers = opts.headers;
        base.dataType = 'text';
      } else base.header = opts.headers;
      api.request(base);
    });
  return {
    post: (url, body, headers) => req({ url, method: 'POST', data: body, headers }),
    get: (url) => req({ url, method: 'GET', headers: {} }),
  };
}

// ---------------------------------------------------------------- Lifecycle
const pageState: { auto: ((el: { type?: string; id?: string; content?: string; path?: string }, page: PageInfo | null) => void) | null } = { auto: null };

function pageInfo(inst: Host | null | undefined): PageInfo | null {
  if (!inst) return null;
  const path = String(inst.route || inst.__route__ || inst.is || '').replace(/^\/+/, '');
  if (!path) return null;
  const q = inst.options || inst.__query__ || inst.$page?.query || undefined;
  const query: Record<string, string> = {};
  if (q && typeof q === 'object') for (const k of Object.keys(q)) if (k.charCodeAt(0) !== 36) query[k] = String(q[k]).slice(0, 200);
  return { path, query: Object.keys(query).length ? query : undefined };
}

function currentPage(): PageInfo | null {
  const pages = pick<Host[]>(() => g.getCurrentPages(), []);
  return pageInfo(pages && pages.length ? pages[pages.length - 1] : null);
}

/** 包装页面 options：注入 onShow / onHide / onUnload / 分享 / 收藏；tap 事件处理函数用于全埋点 */
export function wrapPageOptions(options: Host, h: LifecycleHandlers): Host {
  if (!options || typeof options !== 'object' || options.__tc) return options;
  options.__tc = 1;
  const wrap = (name: string, before: (this: Host, ...args: any[]) => void) => {
    const orig: AnyFn | undefined = options[name];
    options[name] = function (this: Host, ...args: any[]) {
      try {
        before.apply(this, args);
      } catch {
        /* ignore */
      }
      return orig ? orig.apply(this, args) : undefined;
    };
  };
  wrap('onShow', function () {
    const p = pageInfo(this);
    if (p) h.onPageShow(p);
  });
  wrap('onHide', function () {
    const p = pageInfo(this);
    if (p) h.onPageHide(p);
  });
  wrap('onUnload', function () {
    const p = pageInfo(this);
    if (p) h.onPageHide(p);
  });
  wrap('onShareAppMessage', function () {
    const p = pageInfo(this);
    if (p) h.onShare(p, 'appMessage');
  });
  wrap('onShareTimeline', function () {
    const p = pageInfo(this);
    if (p) h.onShare(p, 'timeline');
  });
  wrap('onAddToFavorites', function () {
    const p = pageInfo(this);
    if (p) h.onFavorite(p);
  });
  // 全埋点：包装所有函数属性，命中 tap 事件时上报
  for (const k of Object.keys(options)) {
    if (/^on[A-Z]|^__/.test(k) || typeof options[k] !== 'function') continue;
    const fn: AnyFn = options[k];
    options[k] = function (this: Host, ...args: any[]) {
      try {
        const e = args[0];
        if (pageState.auto && e && typeof e === 'object' && e.type === 'tap' && e.currentTarget) {
          const t = e.currentTarget;
          const ds = t.dataset || {};
          const page = pageInfo(this);
          pageState.auto({ type: ds.wcType || 'view', id: t.id || undefined, content: ds.wcContent || ds.wcText || undefined, path: `${page?.path ?? ''}#${t.id || k}` }, page);
        }
      } catch {
        /* ignore */
      }
      return fn.apply(this, args);
    };
  }
  return options;
}

function lifecycle(api: Host, opts: MpAdapterOptions): Lifecycle {
  return {
    bind(h) {
      const launch = pick<LaunchInfo | null>(() => api.getLaunchOptionsSync(), null);
      if (launch) h.onLaunch({ scene: launch.scene, path: launch.path, query: launch.query, referrerInfo: launch.referrerInfo });
      if (typeof api.onAppShow === 'function') api.onAppShow((i: LaunchInfo) => h.onShow(i || {}));
      if (typeof api.onAppHide === 'function') api.onAppHide(() => h.onHide());
      if (opts.patchPage !== false && typeof g.Page === 'function' && !g.Page.__tc) {
        const orig: AnyFn = g.Page;
        const patched = function (options: Host) {
          return orig(wrapPageOptions(options, h));
        } as AnyFn & { __tc?: 1 };
        patched.__tc = 1;
        g.Page = patched;
      }
      if (opts.patchComponent !== false && typeof g.Component === 'function' && !g.Component.__tc) {
        const orig: AnyFn = g.Component;
        const patched = function (options: Host) {
          try {
            if (options && options.methods && !options.__tc) {
              // 组件作页面（usingComponents 页面）：pageLifetimes.show/hide
              const pl: Host = (options.pageLifetimes = options.pageLifetimes || {});
              const s: AnyFn | undefined = pl.show;
              const hd: AnyFn | undefined = pl.hide;
              pl.show = function (this: Host, ...a: any[]) {
                const p = pageInfo(this);
                if (p) h.onPageShow(p);
                return s ? s.apply(this, a) : undefined;
              };
              pl.hide = function (this: Host, ...a: any[]) {
                const p = pageInfo(this);
                if (p) h.onPageHide(p);
                return hd ? hd.apply(this, a) : undefined;
              };
              options.__tc = 1;
            }
          } catch {
            /* ignore */
          }
          return orig(options);
        } as AnyFn & { __tc?: 1 };
        patched.__tc = 1;
        g.Component = patched;
      }
    },
    currentPage,
  };
}

// ---------------------------------------------------------------- DeviceInfo
function device(api: Host, platform: MpPlatform): DeviceInfo {
  return {
    platform,
    read(): DeviceSnapshot {
      const info: Host = pick(() => {
        if (typeof api.getDeviceInfo === 'function' && typeof api.getWindowInfo === 'function') {
          const base = typeof api.getAppBaseInfo === 'function' ? api.getAppBaseInfo() : {};
          return { ...api.getDeviceInfo(), ...api.getWindowInfo(), ...base };
        }
        return api.getSystemInfoSync();
      }, {});
      const system = String(info.system || '');
      const m = /^([A-Za-z ]+?)\s*([\d.]+)?$/.exec(system);
      const os = (m && m[1].trim()) || (info.platform === 'ios' ? 'iOS' : info.platform === 'android' ? 'Android' : info.platform ? String(info.platform) : undefined);
      const model = info.model ? String(info.model) : undefined;
      const tablet = /ipad|pad|tablet/i.test(String(model || '') + ' ' + String(info.deviceType || ''));
      let tz: string | undefined;
      try {
        tz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
      } catch {
        /* ignore */
      }
      return {
        os: os === 'iOS' || os === 'Android' ? os : os ? os.charAt(0).toUpperCase() + os.slice(1) : undefined,
        osVersion: m && m[2] ? m[2] : undefined,
        brand: info.brand ? String(info.brand) : undefined,
        model,
        deviceType: tablet ? 'tablet' : 'phone',
        screenWidth: Number(info.screenWidth) || undefined,
        screenHeight: Number(info.screenHeight) || undefined,
        pixelRatio: Number(info.pixelRatio) || undefined,
        locale: info.language ? String(info.language).replace('_', '-') : undefined,
        timezone: tz,
        hostVersion: info.version ? String(info.version) : undefined,
        sdkVersion: info.SDKVersion ? String(info.SDKVersion) : undefined,
      };
    },
    networkType: () =>
      new Promise<string>((resolve) => {
        try {
          api.getNetworkType({ success: (r: Host) => resolve(String(r.networkType || 'unknown').toLowerCase()), fail: () => resolve('unknown') });
        } catch {
          resolve('unknown');
        }
      }),
  };
}

// ---------------------------------------------------------------- Timers / AutoTrack
// 小程序运行时提供标准定时器全局；tsconfig 无 DOM lib，经 globalThis 取
const timers: Timers = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => g.setTimeout(fn, ms),
  clearTimeout: (id) => g.clearTimeout(id),
  setInterval: (fn, ms) => g.setInterval(fn, ms),
  clearInterval: (id) => g.clearInterval(id),
  random: () => Math.random(),
};
const autoTrack: AutoTrackHook = {
  enable: (cb) => (pageState.auto = cb),
  disable: () => (pageState.auto = null),
};

export function mpAdapters(api: Host, platform: MpPlatform, opts: MpAdapterOptions = {}): Adapters {
  return {
    storage: storage(api, platform),
    transport: transport(api, platform),
    lifecycle: lifecycle(api, opts),
    device: device(api, platform),
    timers,
    autoTrack,
    log: (level, msg, extra) => {
      const c = g.console;
      if (!c) return;
      if (level === 'error') c.warn?.(`[tapcub] ${msg}`);
      else c.log?.(`[tapcub] ${msg}`, extra ?? '');
    },
  };
}
