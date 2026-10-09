#!/usr/bin/env node
/**
 * App SDK 冒烟（dev_behavior_phase3/11 / 12）：跑 app-sdk 一致性向量（common + App 预置）。
 * 服务端摄入见 smoke-sdk-backend.mjs。
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const r = spawnSync(
  process.execPath,
  ['--experimental-strip-types', '--test', 'test/vectors.test.mjs'],
  { cwd: join(root, 'packages/app-sdk'), stdio: 'inherit' },
);
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('✓ smoke-sdk-app: app-sdk vectors');
