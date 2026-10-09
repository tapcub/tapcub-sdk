import { defineConfig } from 'tsup';

// 包不声明 "type": "module"：react-native.config.js 要按 CommonJS 被 RN CLI 读取。
// 所以 CJS 产物用 .js（main / "react-native" 字段，Metro 各版本都能吃），ESM 产物用 .mjs。
// @tapcub/app-sdk 是 dependencies，不打进来。
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  outExtension: ({ format }) => ({ js: format === 'esm' ? '.mjs' : '.js' }),
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: false,
  target: 'es2020',
  treeshake: true,
  minify: false,
  outDir: 'dist',
  cjsInterop: true,
});
