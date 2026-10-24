# Changelog

All notable changes to this package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0

- First release of `@tapcub/miniprogram` for WeChat, Alipay and Douyin mini programs (one core, per-platform adapters; entry points `/wx`, `/my`, `/tt`).
- Launch / show / page view / page leave with scene and channel, share tracking with depth (`withShareParams`), optional click autotrack, consent gate, remote config, persistent queue, identity and properties as in the App core.
- Behaviour pinned down by the shared client vectors in `packages/shared/test-vectors/sdk`.
