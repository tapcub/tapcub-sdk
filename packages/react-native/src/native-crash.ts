/**
 * 可选：原生崩溃转发。宿主装了原生 SDK（com.tapcub:android / pod TapCub）并接入本包的原生模块
 * `TapCubCrash` 后，JS 侧在启动时把原生记录下来的崩溃 / ANR / 冻结拉过来交给核心补报。
 * 没装原生模块时这里什么都不做，JS 异常照旧由 ErrorUtils 路径处理。
 */
import type { CrashEvent, CrashHook } from '@tapcub/app-sdk';

export interface NativeCrashRecord {
  kind?: string;
  type?: string | null;
  message?: string | null;
  stack?: string | null;
  fatal?: boolean | null;
  durationMs?: number | null;
  foreground?: boolean | null;
  ts?: number | null;
}

/** `NativeModules.TapCubCrash` 的形状 */
export interface NativeCrashModule {
  drain(): Promise<NativeCrashRecord[]>;
}

export function toCrashEvent(r: NativeCrashRecord): CrashEvent | null {
  const kind = r.kind === 'anr' || r.kind === 'freeze' ? r.kind : r.kind === 'crash' ? 'crash' : null;
  if (!kind) return null;
  const ev: CrashEvent = { kind, fatal: r.fatal ?? true };
  if (r.type) ev.type = r.type;
  if (r.message) ev.message = r.message;
  if (r.stack) ev.stack = r.stack;
  if (typeof r.durationMs === 'number') ev.durationMs = r.durationMs;
  if (typeof r.foreground === 'boolean') ev.foreground = r.foreground;
  if (typeof r.ts === 'number' && r.ts > 0) ev.ts = r.ts;
  return ev;
}

/** 把原生模块包成核心的 CrashHook：enable 时 drain 一次，逐条回调 */
export function nativeCrashHook(mod: NativeCrashModule | null | undefined): CrashHook | undefined {
  if (!mod || typeof mod.drain !== 'function') return undefined;
  let active = false;
  return {
    enable(cb) {
      active = true;
      void mod
        .drain()
        .then((list) => {
          if (!active || !Array.isArray(list)) return;
          for (const r of list) {
            const ev = toCrashEvent(r);
            if (ev) cb(ev);
          }
        })
        .catch(() => undefined);
    },
    disable() {
      active = false;
    },
  };
}
