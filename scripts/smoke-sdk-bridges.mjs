#!/usr/bin/env node
/**
 * 跨平台桥接冒烟（dev_behavior_phase3/13）：RN / uni-app / Flutter 方法面。
 * --conditions=tapcub-source：@tapcub/app-sdk、@tapcub/miniprogram 解析到 src，不用先构建 dist。
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jobs = [
  ['react-native', ['--conditions=tapcub-source', '--experimental-strip-types', '--test', 'test/bridge.test.mjs']],
  ['uni-app', ['--conditions=tapcub-source', '--experimental-strip-types', '--test', 'test/detect.test.mjs', 'test/entries.test.mjs']],
  ['tapcub_flutter', ['--test', 'test/api_surface.mjs']],
];

let failed = 0;
for (const [pkg, args] of jobs) {
  const r = spawnSync(process.execPath, args, { cwd: join(root, 'packages', pkg), stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.error(`✗ ${pkg}`);
  } else console.log(`✓ ${pkg}`);
}
if (failed) process.exit(1);
console.log('✓ smoke-sdk-bridges');
