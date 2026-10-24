# Changelog

All notable changes to this package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0

- First release of `@tapcub/app-sdk`, the TypeScript core shared by the Android, iOS and HarmonyOS SDKs (ESM + CommonJS + types, gzip ≤ 30 KB).
- Consent gate and China mode (no network and no device reads before consent), remote config (sampling, blacklists, minimum version), persistent queue with flush policies, retries and standby endpoint, sessions, identity (`login` / `logout` / `bind`, hashed email and mobile), user and group properties, super properties, crash grouping, `$app_*` / `$screen_*` preset events.
- Behaviour pinned down by the shared client vectors in `packages/shared/test-vectors/sdk`.
