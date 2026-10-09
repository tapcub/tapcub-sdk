# @tapcub/uni-app

TapCub for uni-app. Routes by build target: mini programs → `@tapcub/miniprogram`, App → `@tapcub/app-sdk`. For H5, use the web script `https://static.pathclue.com/client.js`.

```js
import { TapCub, detectTarget } from '@tapcub/uni-app';
```

When the build target is known you can import a sub-entry directly; its default export is the instance factory `createTapCub(adapters)`:

```js
import createTapCub from '@tapcub/uni-app/mp';   // mini programs; also exports mpAdapters, TapCubCore
import createTapCub from '@tapcub/uni-app/app';  // App
```

`@tapcub/miniprogram` and `@tapcub/app-sdk` are dependencies and are not bundled into this package, so the host ends up with a single copy of the core.

## Development

```bash
pnpm test     # node --conditions=tapcub-source: the core resolves from src, no build needed
pnpm build    # tsup → dist (ESM + CJS + d.ts); the published package contains only dist and README
```

Publish with `pnpm publish` (it replaces `workspace:^` with real version numbers), not `npm publish`.
