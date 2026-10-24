# @tapcub/miniprogram

TapCub SDK for mini programs: WeChat, Alipay and Douyin share one core, with a per-platform adapter. Protocol v2; behavior is pinned down by the shared vectors in `packages/shared/test-vectors/sdk`.

```js
import { TapCub } from '@tapcub/miniprogram/wx'; // Alipay: /my · Douyin: /tt

TapCub.preInit({
  siteKey: 's_xxx',
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

The collection address is built in, so there is no `endpoint` to set. Add the TapCub collection domain to the mini program's allowed request domains in the WeChat / Alipay / Douyin admin console, or requests never leave the device; the domain is listed in the [mini program guide](https://docs.tapcub.com/en/sdk/mini-program).

`preInit` hooks the App / Page lifecycles, so there is no need to forward `onLaunch` / `onShow`. If your framework must not patch the global `Page`:

```js
import { wrapPage } from '@tapcub/miniprogram/wx';
Page(wrapPage({ /* ... */ }));
```

China mode: set `region: 'cn'` and do not call `init()` before the user consents. `requiredPrivacyApis()` returns an empty list (the SDK does not read location, contacts or the clipboard).
