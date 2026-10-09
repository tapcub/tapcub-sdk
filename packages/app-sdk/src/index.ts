export { TapCubCore, LIB_VERSION } from './core/sdk.ts';
export type { ConsentListener, ErrorListener, SessionListener } from './core/sdk.ts';
export { PersistentQueue } from './core/queue.ts';
export { normalizeRc, compareSemver, sha256, uuidV4, fnv1a, normProps, DEFAULT_RC, DEVICE_ID_RE, BLOCKED_ID_RE, LIMITS } from './core/util.ts';
export type * from './core/types.ts';

import { TapCubCore } from './core/sdk.ts';
import type { Adapters } from './core/types.ts';

export function createTapCub(adapters: Adapters): TapCubCore {
  return new TapCubCore(adapters);
}
