/**
 * React Native 适配：可注入（单测 / 无 RN 环境）；运行时尝试 require('react-native')。
 * 不挂 Activity / UIKit 自动页面，页面只走 navigationHook（phase3/13）。
 */
import type { Adapters, AppPlatform, DeviceSnapshot, LaunchInfo, LifecycleHandlers, PageInfo, Storage, Timers } from '@tapcub/app-sdk';
import { nativeCrashHook, type NativeCrashModule } from './native-crash.ts';

export interface RnHost {
  asyncStorage?: { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> };
  fetch?: typeof fetch;
  appState?: { currentState?: string; addEventListener(type: string, cb: (s: string) => void): { remove(): void } };
  platform?: { OS: 'ios' | 'android' | string };
  dimensions?: { get(k: string): { width: number; height: number; scale?: number } };
  /** 可选：`NativeModules.TapCubCrash`，装了原生 SDK 时转发原生崩溃 */
  nativeCrash?: NativeCrashModule | null;
}

function memoryStorage(): Storage & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    get: (k) => (m.has(k) ? m.get(k)! : null),
    set: (k, v) => void m.set(k, String(v)),
    remove: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

/** AsyncStorage 是异步的，核心 Storage 同步：启动时 load 进内存，写时双写 */
export function createRnStorage(host: RnHost, seed?: Record<string, string>): Storage {
  const mem = memoryStorage();
  if (seed) for (const [k, v] of Object.entries(seed)) mem.set(k, v);
  const as = host.asyncStorage;
  if (as) {
    return {
      get: (k) => mem.get(k),
      set: (k, v) => {
        mem.set(k, v);
        void as.setItem(k, v).catch(() => undefined);
      },
      remove: (k) => {
        mem.remove(k);
        void as.removeItem(k).catch(() => undefined);
      },
    };
  }
  return mem;
}

/** 核心用到的所有固定键；队列分片 `tc_q_{n}` 按索引 `tc_q_i` 动态补上 */
export const RN_STORAGE_KEYS = [
  'tc_did',
  'tc_sp',
  'tc_sdp',
  'tc_sd',
  'tc_cfg',
  'tc_consent',
  'tc_consent_reject_at',
  'tc_login',
  'tc_group',
  'tc_optout',
  'tc_child',
  'tc_first',
  'tc_end_pending',
  'tc_q_i',
];

/**
 * AsyncStorage 是异步的，启动时先把核心要读的键一次性载入内存。不传 keys 时载入全部固定键，
 * 并顺着队列索引 `tc_q_i = {f,l}` 把分片 `tc_q_f … tc_q_l` 也带上，重启后未发送的事件不丢。
 */
export async function hydrateRnStorage(host: RnHost, keys: string[] = RN_STORAGE_KEYS): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const as = host.asyncStorage;
  if (!as) return out;
  const load = async (k: string) => {
    const v = await as.getItem(k).catch(() => null);
    if (v != null) out[k] = v;
  };
  await Promise.all(keys.map(load));
  if (out.tc_q_i) {
    try {
      const idx = JSON.parse(out.tc_q_i) as { f?: number; l?: number };
      if (typeof idx.f === 'number' && typeof idx.l === 'number' && idx.l >= idx.f && idx.l - idx.f < 10_000) {
        const chunks: string[] = [];
        for (let n = idx.f; n <= idx.l; n++) chunks.push(`tc_q_${n}`);
        await Promise.all(chunks.map(load));
      }
    } catch {
      // corrupt index: the core rebuilds it
    }
  }
  return out;
}

export function rnAdapters(host: RnHost = {}, opts?: { platform?: AppPlatform; storage?: Storage }): Adapters {
  const platform: AppPlatform = opts?.platform || (host.platform?.OS === 'ios' ? 'ios' : 'android');
  const storage = opts?.storage || createRnStorage(host);
  const doFetch = host.fetch || (typeof fetch === 'function' ? fetch : undefined);
  let page: PageInfo | null = null;

  const timers: Timers = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
    random: () => Math.random(),
  };

  return {
    storage,
    transport: {
      async get(url) {
        if (!doFetch) throw new Error('fetch unavailable');
        const res = await doFetch(url);
        return { status: res.status, body: await res.text() };
      },
      async post(url, body, headers) {
        if (!doFetch) throw new Error('fetch unavailable');
        const res = await doFetch(url, { method: 'POST', body, headers });
        return { status: res.status, body: await res.text() };
      },
    },
    lifecycle: {
      bind(h) {
        h.onLaunch({ path: 'App' } satisfies LaunchInfo);
        const as = host.appState;
        if (as?.addEventListener) {
          as.addEventListener('change', (s) => {
            if (s === 'active') h.onShow({});
            else if (s === 'background' || s === 'inactive') h.onHide();
          });
        }
      },
      currentPage: () => page,
    },
    device: {
      platform,
      read(): DeviceSnapshot {
        const d = host.dimensions?.get('window');
        return {
          os: platform === 'ios' ? 'iOS' : 'Android',
          deviceType: 'phone',
          screenWidth: d?.width,
          screenHeight: d?.height,
          pixelRatio: d?.scale,
        };
      },
      networkType: () => Promise.resolve('unknown'),
    },
    timers,
    autoTrack: { enable: () => undefined, disable: () => undefined },
    crash: nativeCrashHook(host.nativeCrash),
    log: (level, msg) => {
      if (typeof console !== 'undefined') console[level === 'error' ? 'warn' : 'log']?.(`[tapcub-rn] ${msg}`);
    },
  };
}

