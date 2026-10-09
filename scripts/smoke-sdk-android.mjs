#!/usr/bin/env node
/**
 * Android SDK 冒烟（dev_behavior_phase3/11、20）：先核对 Kotlin 源码 API 面；
 * 有 JDK 时再跑 `:core:test`（共享向量）。没有 JDK 只做源码检查。
 * `--full` 额外编 `:sdk:assembleRelease`（需要 ANDROID_HOME）。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cwd = join(root, 'packages/android');
const full = process.argv.includes('--full');

let r = spawnSync(process.execPath, ['--test', 'test/api_surface.mjs'], { cwd, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log('✓ smoke-sdk-android: kotlin api surface');

const java = spawnSync('java', ['-version'], { encoding: 'utf8' });
const gradlew = join(cwd, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
if (java.status !== 0 || !existsSync(gradlew)) {
  console.log('skip: no JDK or gradlew, kotlin vectors not run');
  process.exit(0);
}

const tasks = full ? [':core:test', ':sdk:assembleRelease', ':sdk:lintRelease'] : [':core:test', '-Ptapcub.coreOnly=true'];
r = spawnSync(gradlew, [...tasks, '--console=plain'], { cwd, stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);
console.log(`✓ smoke-sdk-android: ${full ? 'core vectors + sdk aar' : 'core vectors'}`);
