# Changelog

All notable changes to this package are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0

- First release of `@tapcub/node` (Node.js 18+, ESM + CommonJS + types, no dependencies).
- Methods: `track`, `trackSignup` (with `invitedBy` → `$invited_by`), `bind` / `unbind`, `profileSet` / `profileSetOnce` / `profileIncrement` / `profileAppend` / `profileUnset`, `itemSet` / `itemDelete`, `trackUpdate` / `trackOverwrite`, `groupSet`, `flush`, `close`, and a helper for the `X-Tc-Device` / `X-Tc-Session` request headers.
- Typed request context including `campaign` (the browser's `tapcub.getAttribution()` passes through unchanged), `ip` and `user_agent`.
- Consumers: batch (background sending, up to 200 events / 1 MB per request), sync and debug (`?debug=1`, validate only).
- Retries network errors, 5xx and 429 with exponential backoff and `Retry-After`; other 4xx are not retried. Failures and events rejected inside a 2xx response go to the error handler.
- Every event is normalized before it is queued (UTF-16 length limits, nested values as JSON strings, invalid context dropped), so one bad value cannot reject a batch. Email and mobile identities are SHA-256 hashed in the SDK.
- Optional gzip. The ingest address is built in; no endpoint setting is needed.
- Passes the shared server conformance vectors (`packages/shared/test-vectors/track`).
