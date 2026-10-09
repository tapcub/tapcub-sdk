/**
 * Lets Node run the HAR sources: `@kit.*` → in-memory mocks, extensionless relative imports → `.ts`
 * (hvigor resolves those; Node does not). Load with `--import ./test/hooks.mjs`.
 */
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const mocks = new URL('./kit-mocks.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('@kit.')) return { url: mocks, shortCircuit: true };
    if (/^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL) {
      const ts = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(ts))) return { url: pathToFileURL(fileURLToPath(ts)).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
