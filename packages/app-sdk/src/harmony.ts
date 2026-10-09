/**
 * 鸿蒙入口：`import { createTapCub } from '@tapcub/app-sdk/harmony'`。
 * ArkTS 适配层由宿主注入 Storage / Transport / Lifecycle（见 docs/dev_behavior_phase3/11）。
 */
export { createTapCub, TapCubCore, LIB_VERSION } from './index.ts';
export type { Adapters } from './core/types.ts';
