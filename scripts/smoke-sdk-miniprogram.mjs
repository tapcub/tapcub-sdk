#!/usr/bin/env node
/**
 * 小程序 SDK 冒烟（dev_behavior_phase3/10）：跑齐一致性向量。
 * 后台摄入回放见 smoke-sdk-backend.mjs（$mp_launch 段）。
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', 'test/vectors.test.mjs'],
  { cwd: join(root, 'packages/miniprogram'), stdio: 'inherit' },
);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('✓ smoke-sdk-miniprogram: 103 vectors');
