import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', android: 'src/android.ts', ios: 'src/ios.ts', harmony: 'src/harmony.ts' },
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
