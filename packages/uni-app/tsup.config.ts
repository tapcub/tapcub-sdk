import { defineConfig } from 'tsup';

// @tapcub/app-sdk、@tapcub/miniprogram 是 dependencies，tsup 默认不打进来：宿主只装一份核心。
export default defineConfig({
  entry: { index: 'src/index.ts', mp: 'src/mp.ts', app: 'src/app.ts' },
  format: ['esm', 'cjs'],
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
