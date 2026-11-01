# Changelog

All notable changes to this package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## 0.2.0

- `$mp_share` now carries `$share_url_path`: the target page of the share card (the `path` returned by `onShareAppMessage` / `onShareTimeline`, without query), or the current page when no path is returned. The SDK now reads the handler's return value, so the event is sent after your handler runs.
- `$scene_channel` follows the official Alipay and Douyin scene tables. Douyin / Toutiao six-digit codes (such as `023001`) were all reported as `other` before; they now map by host and entry group, with a new `content` channel for video, live and feed entries.
- `withShareParams()` also appends `tc_sfp` (the page the share happened on). Launches from such a link carry `$share_from_path`, so share reports can attribute returns to the page that was shared.

## 0.1.0

- First release of `@tapcub/miniprogram` for WeChat, Alipay and Douyin mini programs (one core, per-platform adapters; entry points `/wx`, `/my`, `/tt`).
- Launch / show / page view / page leave with scene and channel, share tracking with depth (`withShareParams`), optional click autotrack, consent gate, remote config, persistent queue, identity and properties as in the App core.
- Behaviour pinned down by the shared client vectors in `packages/shared/test-vectors/sdk`.
