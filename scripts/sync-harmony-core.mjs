#!/usr/bin/env node
/**
 * 把 packages/app-sdk/src/core/*.ts 同步到鸿蒙 HAR（packages/harmony/src/main/core/），
 * 去掉 import 里的 `.ts` 后缀（hvigor 不认），文件头加「生成文件」标记。
 *
 *   node scripts/sync-harmony-core.mjs           写入
 *   node scripts/sync-harmony-core.mjs --check   只比对，不一致退出 1（CI 用）
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, 'packages/app-sdk/src/core');
const to = join(root, 'packages/harmony/src/main/core');
const check = process.argv.includes('--check');

const HEADER = '// 生成文件：由 scripts/sync-harmony-core.mjs 从 packages/app-sdk/src/core 同步，不要手改。\n';

export function transform(src) {
  return HEADER + src.replace(/(from\s+['"]\.{1,2}\/[^'"]+?)\.ts(['"])/g, '$1$2');
}

const files = readdirSync(from).filter((f) => f.endsWith('.ts')).sort();
const stale = [];
if (!check) mkdirSync(to, { recursive: true });
for (const f of files) {
  const want = transform(readFileSync(join(from, f), 'utf8'));
  const dest = join(to, f);
  const have = existsSync(dest) ? readFileSync(dest, 'utf8') : null;
  if (have === want) continue;
  stale.push(f);
  if (!check) writeFileSync(dest, want);
}
const extra = existsSync(to) ? readdirSync(to).filter((f) => f.endsWith('.ts') && !files.includes(f)) : [];

if (check) {
  if (stale.length || extra.length) {
    for (const f of stale) console.error(`✗ harmony core out of date: ${f}`);
    for (const f of extra) console.error(`✗ harmony core has extra file: ${f}`);
    console.error('run: node scripts/sync-harmony-core.mjs');
    process.exit(1);
  }
  console.log(`✓ harmony core in sync (${files.length} files)`);
} else {
  for (const f of extra) console.warn(`! extra file left in harmony core: ${f}`);
  console.log(stale.length ? `synced ${stale.join(', ')}` : 'harmony core already in sync');
}
