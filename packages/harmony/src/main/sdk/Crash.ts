import { hiAppEvent } from '@kit.PerformanceAnalysisKit';
import type { CrashEvent, CrashHook } from '../core/types';
import { Brand } from './Brand';

const MAX_FRAMES = 50;

/**
 * The system records `APP_CRASH` (JS and native) and `APP_FREEZE` (main thread blocked ≥ 6 s) and hands them to
 * the watcher on the next launch, so nothing runs inside the dying process.
 */
export class CrashReporter implements CrashHook {
  private cb: ((ev: CrashEvent) => void) | null = null;
  private watching = false;

  enable(cb: (ev: CrashEvent) => void): void {
    this.cb = cb;
    if (this.watching) return;
    this.watching = true;
    hiAppEvent.addWatcher({
      name: Brand.CRASH_WATCHER,
      appEventFilters: [{ domain: hiAppEvent.domain.OS, names: [hiAppEvent.event.APP_CRASH, hiAppEvent.event.APP_FREEZE] }],
      onReceive: (_domain: string, groups: Array<hiAppEvent.AppEventGroup>) => {
        for (const g of groups) {
          for (const info of g.appEventInfos) {
            const ev = toCrashEvent(g.name, info.params as Record<string, unknown>);
            if (ev) this.cb?.(ev);
          }
        }
      },
    });
  }

  disable(): void {
    this.cb = null;
    if (!this.watching) return;
    this.watching = false;
    hiAppEvent.removeWatcher({ name: Brand.CRASH_WATCHER });
  }
}

export function toCrashEvent(name: string, params: Record<string, unknown>): CrashEvent | null {
  const ex = (params.exception ?? {}) as Record<string, unknown>;
  const ts = typeof params.time === 'number' && params.time > 0 ? params.time : undefined;
  const foreground = typeof params.foreground === 'boolean' ? params.foreground : undefined;
  if (name === hiAppEvent.event.APP_FREEZE) {
    return {
      kind: 'anr',
      type: str(ex.name) || 'APP_FREEZE',
      message: str(ex.message),
      stack: frames(ex) || str(ex.stack),
      fatal: true,
      foreground,
      ts,
    };
  }
  if (name !== hiAppEvent.event.APP_CRASH) return null;
  const native = params.crash_type === 'NativeCrash';
  const signal = (ex.signal ?? {}) as Record<string, unknown>;
  return {
    kind: 'crash',
    type: native ? str(ex.name) || (signal.signo != null ? `SIG${String(signal.signo)}` : 'NativeCrash') : str(ex.name) || 'JsError',
    message: str(ex.message),
    stack: native ? frames(ex) : str(ex.stack),
    fatal: true,
    foreground,
    ts,
  };
}

/** Native frames as `file+0xpc`, same shape as the iOS image+offset stacks. */
function frames(ex: Record<string, unknown>): string | undefined {
  const list = Array.isArray(ex.frames) ? (ex.frames as Array<Record<string, unknown>>) : [];
  if (!list.length) return undefined;
  return list
    .slice(0, MAX_FRAMES)
    .map((f) => {
      const file = str(f.file) || '?';
      const pc = str(f.pc);
      const sym = str(f.symbol);
      return `${file}${pc ? `+0x${pc.replace(/^0x/i, '')}` : ''}${sym ? ` ${sym}` : ''}`;
    })
    .join('\n');
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
