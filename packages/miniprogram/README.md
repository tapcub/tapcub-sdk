# @tapcub/miniprogram

TapCub SDK for mini programs: WeChat, Alipay and Douyin share one core, with a per-platform adapter. Protocol v2; behavior is pinned down by the shared vectors in `packages/shared/test-vectors/sdk`.

```js
import { TapCub } from '@tapcub/miniprogram/wx'; // Alipay: /my · Douyin: /tt

TapCub.preInit({
  siteKey: 's_xxx',
  endpoint: 'https://c.example.com',
  appId: 'wx1234567890abcd', // register it under App IDs in the TapCub console first
});

App({
  onLaunch() {
    TapCub.init();
  },
});

TapCub.login(openid, undefined, { type: 'openid' });
TapCub.track('purchase', { revenue: 19.9, currency: 'CNY' });
```

`preInit` hooks the App / Page lifecycles, so there is no need to forward `onLaunch` / `onShow`. If your framework must not patch the global `Page`:

```js
import { wrapPage } from '@tapcub/miniprogram/wx';
Page(wrapPage({ /* ... */ }));
```

China mode: set `region: 'cn'` and do not call `init()` before the user consents. `requiredPrivacyApis()` returns an empty list (the SDK does not read location, contacts or the clipboard).
