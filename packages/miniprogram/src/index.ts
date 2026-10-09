/**
 * @tapcub/miniprogram 核心导出：自带适配的入口见 `./wx` `./my` `./tt`；桥接层 / 自定义宿主用 `createTapCub(adapters)`。
 */
export { TapCubCore, LIB_NAME, LIB_VERSION } from './core/sdk.ts';
export type { ConsentListener, ErrorListener, SessionListener } from './core/sdk.ts';
export { PersistentQueue } from './core/queue.ts';
export { sceneChannel } from './core/scene.ts';
export type { SceneChannel } from './core/scene.ts';
export { normalizeRc, compareSemver, sha256, uuidV4, fnv1a, normProps, DEFAULT_RC, DEVICE_ID_RE, BLOCKED_ID_RE, LIMITS } from './core/util.ts';
export { mpAdapters, wrapPageOptions } from './adapters/mp.ts';
export type { MpAdapterOptions } from './adapters/mp.ts';
export type * from './core/types.ts';

import { TapCubCore } from './core/sdk.ts';
import type { Adapters } from './core/types.ts';

export function createTapCub(adapters: Adapters): TapCubCore {
  return new TapCubCore(adapters);
}
