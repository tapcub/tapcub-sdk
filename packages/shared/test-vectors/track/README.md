# Server SDK conformance vectors

Every TapCub server SDK (Node.js, Python, PHP, Java, Go) runs these files in its test suite. Each file is one public call and the event object the SDK must put in the `POST /api/v1/track` body (`{"events": [ … ]}`).

```json
{
  "name": "track_purchase",
  "description": "…",
  "call": { "method": "track", "args": { "event": "purchase", "login_id": "user-1" } },
  "expected": { "type": "track", "event": "purchase", "login_id": "user-1", "time": "$now" }
}
```

- `call.method` is the API name in snake_case; each SDK maps it to its own spelling (`track_signup` → `trackSignup` in Node.js, PHP and Java, `TrackSignup` in Go).
- `call.args` holds the arguments by name. `context` and `context.campaign` use the API field names (`user_agent`, `click_id`, `landing_url`, `touched_at`) in every language, so the browser's `tapcub.getAttribution()` result can be passed through unchanged.
- `expected` is compared as JSON (key order does not matter). `"$now"` means an integer millisecond timestamp within 60 seconds of the test run.
- `"error": true` means the call is an argument error: the SDK raises (Node.js `TypeError`, Python `ValueError`, PHP `InvalidArgumentException`, Java `IllegalArgumentException`, Go returns an `error`) and queues nothing.

`apps/api/test/track-vectors.test.ts` in the main repository checks that every `expected` body passes the server's own request schema.

## Methods and arguments

| method | positional | options |
|---|---|---|
| `track` | `event` | `login_id`, `login_id_type`, `device_id`, `session_id`, `insert_id`, `time`, `group`, `properties`, `context` |
| `track_signup` | `login_id` | `device_id`, `session_id`, `insert_id`, `time`, `properties`, `invited_by`, `context` |
| `bind` | `login_id`, `identities` | |
| `unbind` | `login_id`, `identity_type`, `value` | |
| `profile_set`, `profile_set_once` | `login_id`, `properties` | |
| `profile_increment` | `login_id`, `increment` | |
| `profile_append` | `login_id`, `append` | |
| `profile_unset` | `login_id`, `keys` | |
| `item_set` | `item_type`, `item_id`, `properties` | |
| `item_delete` | `item_type`, `item_id` | |
| `track_update`, `track_overwrite` | `event`, `insert_id`, `properties` | |
| `group_set` | `group_type`, `group_id`, `properties` | |

## Normalization rules

The server rejects the **whole request** when one event breaks its schema, so the SDK cleans each event before it is queued. Values that cannot be fixed without changing their meaning (IDs) are argument errors instead.

Lengths are counted in UTF-16 code units, as the server counts them. Cutting a string never splits a surrogate pair (an emoji at the limit is dropped whole).

| Field | Rule |
|---|---|
| any option | `null` / missing is not sent |
| `time` | integer milliseconds; defaults to the time of the call (events can wait in the queue) |
| `event` | trimmed; empty is an error; cut to 100 |
| `insert_id` | not generated; empty is not sent; more than 36 is an error; required by `track_update` / `track_overwrite` |
| `login_id` | required by `track_signup`, `bind`, `unbind` and `profile_*`; trimmed; more than 200 is an error |
| `login_id_type` | one of `login`, `email`, `mobile`, `unionid`, `openid`, `custom`; `email` / `mobile` login IDs are hashed like identities |
| `device_id` | more than 72 is an error |
| `session_id` | more than 32 is an error |
| `group` | must match `^[a-z][a-z0-9_]{0,23}:[A-Za-z0-9_@.\-]{1,80}$`; `group_set` builds it from `group_type:group_id` |
| `item_type` / `item_id` | required; more than 40 / 80 is an error |
| `identities` | keys from the `login_id_type` list; values trimmed; `email` lower-cased, `mobile` without spaces and dashes, then SHA-256 (lower-case hex) unless already a 64-character hex string; empty values are skipped |
| `properties` | keys cut to 50; `null` values dropped; strings cut to 1000; finite numbers and booleans as is; dates as ISO-8601 strings; a non-empty list of objects stays (first 100, each object normalized one level, nested values as JSON strings); any other list or object becomes a compact JSON string cut to 1000; an empty object is not sent |
| `increment` | only finite numbers |
| `append` | each value becomes a list of up to 20 strings / numbers / booleans |
| `unset` | up to 50 keys, each cut to 50 |
| `context` | only `ip` (≤45), `user_agent` (≤1000), `url` (≤2000), `platform` (one of the event platforms), `country` (two letters, upper-cased), `lang` (≤12), `campaign`; anything else is dropped; empty is not sent |
| `context.campaign` | `source`, `medium`, `name`, `term`, `content` cut to 100; `ref` to 64; `click_id` to 1000; `landing_url`, `referrer` to 2000; `touched_at` integer; other keys dropped; empty is not sent |
| `invited_by` | written as `properties.$invited_by` |

JSON strings made from nested values are compact (`{"a":1}`), keep key order, and do not escape `/` or non-ASCII characters.

## Transport (not covered by these files)

Each SDK's own tests cover this part with a local HTTP server.

- `POST {endpoint}/api/v1/track`, `Content-Type: application/json`, `Authorization: Bearer <wck_ key>`, `User-Agent: tapcub-<language>/<version>`; optional `Content-Encoding: gzip`. Debug mode adds `?debug=1` (validate only, nothing stored).
- `endpoint` defaults to the TapCub ingest API built into every SDK, so users normally leave it unset. A trailing `/`, `/api/v1` or `/api/v1/track` is removed.
- Consumers: `batch` (default; PHP defaults to `sync`), `sync` (send on every call, raise on failure), `debug` (`sync` against `?debug=1`, every result logged).
- Batching: up to `max_batch` events (default 200, at most 1000) and 1 MB of JSON per request; flushed when full and every 3 seconds; up to 10,000 queued events, dropping the oldest when full.
- Retries: network errors, 5xx and 429, up to 5 times with exponential backoff (0.5 s doubling, at most 30 s, with jitter); `Retry-After` is honoured up to 60 s. The same batch is resent unchanged. Other 4xx responses are not retried.
- Failures that are not retried any more, and events the server rejects inside a 2xx response (`results[].ok == false`, code `EVENT_REJECTED`), go to the error handler. Explicit `flush()` / `close()` raise the first such error instead.
