#!/usr/bin/env node
/**
 * 客户端 SDK 体积断言（phase3/00 §5 第 8 条、phase3/20 §5 第 9 条）。
 *
 *   node scripts/sdk-size-check.mjs miniprogram   小程序入口 gzip ≤30 KB（先构建 dist）
 *   node scripts/sdk-size-check.mjs app-sdk       App JS 核心入口 gzip ≤30 KB（先构建 dist）
 *   node scripts/sdk-size-check.mjs android       SDK + core 的 dex 压缩后 ≤150 KB（先 assembleRelease；需要 ANDROID_HOME 里的 d8）
 *   node scripts/sdk-size-check.mjs ios           arm64 iOS release（-Osize）链接进 App 的 text+data ≤300 KB（需要 Xcode）
 *   node scripts/sdk-size-check.mjs harmony       HAR 包内容 gzip ≤200 KB
 *
 * 量的是宿主 App 实际多出来的体积，不是发布物文件大小：Android 的核心是单独的 jar，AAR 文件本身只有适配层。
 */
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] || 'miniprogram';
const KB = 1024;

function gz(buf) {
  return gzipSync(buf, { level: 9 }).length;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function report(label, bytes, limit, note) {
  const ok = bytes <= limit;
  console.log(`${ok ? '✓' : '✗'} ${label}: ${(bytes / KB).toFixed(1)} KB（阈值 ${limit / KB} KB${note ? `，${note}` : ''}）`);
  return ok;
}

function jsEntries(entries) {
  let ok = true;
  for (const [file, claim] of entries) {
    const path = join(root, file);
    if (!existsSync(path)) {
      console.error(`✗ ${file} 不存在，请先构建`);
      ok = false;
      continue;
    }
    ok = report(file, gz(readFileSync(path)), 30 * KB, claim) && ok;
  }
  return ok;
}

function miniprogram() {
  return jsEntries([
    ['packages/miniprogram/dist/wx.js', '小程序 gzip'],
    ['packages/miniprogram/dist/index.js', '核心 gzip'],
  ]);
}

function appSdk() {
  return jsEntries([['packages/app-sdk/dist/index.js', 'App JS 核心 gzip']]);
}

function android() {
  const pkg = join(root, 'packages/android');
  const aar = join(pkg, 'sdk/build/outputs/aar/sdk-release.aar');
  // core-<version>.jar，版本号取 build.gradle.kts（build/libs 里可能还留着旧版本的 jar）
  const version = readFileSync(join(pkg, 'build.gradle.kts'), 'utf8').match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
  const jar = join(pkg, `core/build/libs/core-${version}.jar`);
  for (const f of [aar, jar]) {
    if (!existsSync(f)) {
      console.error(`✗ ${f} 不存在，请先 ./gradlew :core:jar :sdk:assembleRelease`);
      return false;
    }
  }
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  const bt = sdk && existsSync(join(sdk, 'build-tools')) ? readdirSync(join(sdk, 'build-tools')).sort().pop() : null;
  const platform = sdk && existsSync(join(sdk, 'platforms')) ? readdirSync(join(sdk, 'platforms')).sort().pop() : null;
  if (!bt || !platform) {
    console.error('✗ 需要 ANDROID_HOME（build-tools 和 platforms）来跑 d8');
    return false;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'tapcub-dex-'));
  run('unzip', ['-q', '-o', aar, 'classes.jar', '-d', tmp]);
  run(join(sdk, 'build-tools', bt, 'd8'), [
    '--release',
    '--min-api',
    '21',
    '--lib',
    join(sdk, 'platforms', platform, 'android.jar'),
    '--output',
    tmp,
    join(tmp, 'classes.jar'),
    jar,
  ]);
  const dex = readFileSync(join(tmp, 'classes.dex'));
  console.log(`  AAR ${(statSync(aar).size / KB).toFixed(1)} KB + core jar ${(statSync(jar).size / KB).toFixed(1)} KB，dex ${(dex.length / KB).toFixed(1)} KB`);
  return report('Android dex（SDK + core，压缩后）', gz(dex), 150 * KB, '不含 Kotlin 标准库，宿主 R8 后更小');
}

function ios() {
  const pkg = join(root, 'packages/ios');
  const sdkPath = run('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path']).trim();
  const scratch = join(tmpdir(), 'tapcub-ios-size');
  run('swift', ['build', '-c', 'release', '-Xswiftc', '-Osize', '--scratch-path', scratch, '--triple', 'arm64-apple-ios13.0', '--sdk', sdkPath, '--target', 'TapCub'], { cwd: pkg });
  const rel = join(scratch, 'arm64-apple-ios/release');
  const objs = ['TapCub.build', 'TapCubCore.build', 'TapCubCrashC.build'].flatMap((d) => walk(join(rel, d)).filter((f) => f.endsWith('.o')));
  let text = 0;
  let data = 0;
  for (const line of run('size', objs).trim().split('\n').slice(1)) {
    const [t, d] = line.trim().split(/\s+/).map(Number);
    text += t;
    data += d;
  }
  console.log(`  text ${(text / KB).toFixed(1)} KB + data ${(data / KB).toFixed(1)} KB（${objs.length} 个目标文件，链接前未做 dead-strip）`);
  return report('iOS arm64 release（-Osize）', text + data, 300 * KB);
}

function harmony() {
  const pkg = join(root, 'packages/harmony');
  const files = [join(pkg, 'Index.ets'), join(pkg, 'oh-package.json5'), ...walk(join(pkg, 'src/main'))];
  const buf = Buffer.concat(files.map((f) => readFileSync(f)));
  console.log(`  ${files.length} 个文件，源码 ${(buf.length / KB).toFixed(1)} KB`);
  return report('HarmonyOS HAR（gzip）', gz(buf), 200 * KB);
}

const CHECKS = { miniprogram, 'app-sdk': appSdk, android, ios, harmony };
const fn = CHECKS[target];
if (!fn) {
  console.error(`unknown sdk target: ${target}（可选 ${Object.keys(CHECKS).join(' / ')}）`);
  process.exit(1);
}
try {
  process.exit(fn() ? 0 : 1);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
