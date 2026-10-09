/**
 * 抖音小程序入口：`import { TapCub } from '@tapcub/miniprogram/tt'`。
 * app.js 顶层 `TapCub.preInit({...})`；用户同意后（或站点不要求同意）`TapCub.init()`。
 */
import { mpAdapters, wrapPageOptions } from './adapters/mp.ts';
import { TapCubCore } from './core/sdk.ts';
import type { LifecycleHandlers } from './core/types.ts';

declare const tt: Record<string, unknown>;

let handlers: LifecycleHandlers | null = null;
const adapters = mpAdapters(tt as Record<string, unknown>, 'mp_bytedance');
const bind = adapters.lifecycle.bind;
adapters.lifecycle.bind = (h) => {
  handlers = h;
  bind(h);
};

export const TapCub = new TapCubCore(adapters);
/** 不 patch 全局 Page 时手动包装：`Page(TapCub.wrapPage({...}))` */
export function wrapPage<T extends Record<string, unknown>>(options: T): T {
  return handlers ? (wrapPageOptions(options, handlers) as T) : options;
}
export * from './index.ts';
export default TapCub;
