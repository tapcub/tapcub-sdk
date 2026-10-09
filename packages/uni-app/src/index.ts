import { TapCubCore as AppCore, type Adapters, type TapCubConfig } from '@tapcub/app-sdk';
import { TapCubCore as MpCore, type Adapters as MpAdapters } from '@tapcub/miniprogram';
import { assertNotH5, detectTarget, type UniDetect } from './detect.ts';

export { detectTarget, assertNotH5 };
export type { UniDetect };

export type UniCore = AppCore | MpCore;

/** 小程序目标传 miniprogram 的适配，App 目标传 app-sdk 的适配 */
export type UniAdapters = Adapters | MpAdapters;

export function createUniTapCub(adapters: UniAdapters, target?: string): { core: UniCore; detect: UniDetect } {
  const detect = detectTarget(target);
  assertNotH5(detect);
  const core = detect.flavor === 'mp' ? new MpCore(adapters as MpAdapters) : new AppCore(adapters as Adapters);
  return { core, detect };
}

/** 单例：preInit 时按目标选核心 */
class UniBridge {
  private boxed: { core: UniCore; detect: UniDetect } | null = null;

  attach(adapters: UniAdapters, target?: string) {
    this.boxed = createUniTapCub(adapters, target);
    return this.boxed;
  }

  preInit(config: TapCubConfig & { target?: string }, adapters?: UniAdapters): UniCore {
    if (!this.boxed) {
      if (!adapters) throw new Error('uni-app: pass adapters or use /mp / /app entries in the host');
      this.attach(adapters, config.target);
    }
    this.boxed!.core.preInit({ ...config, autoTrack: config.autoTrack ?? false });
    return this.boxed!.core;
  }

  get core(): UniCore | null {
    return this.boxed?.core ?? null;
  }
  get detect(): UniDetect | null {
    return this.boxed?.detect ?? null;
  }
}

export const TapCub = new UniBridge();
export default TapCub;
