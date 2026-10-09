import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', wx: 'src/wx.ts', my: 'src/my.ts', tt: 'src/tt.ts' },
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
