# SDK conformance vectors

The JSON files here are the single behavior contract for the App and mini-program SDKs. Four runners execute the same set of files (paths below are in [tapcub-sdk](https://github.com/tapcub/tapcub-sdk), except Swift, which lives in [tapcub-ios](https://github.com/tapcub/tapcub-ios)):

| Runner | Location | Command |
|---|---|---|
| TypeScript (reference implementation) | `packages/app-sdk/test/runner.mjs`, `packages/miniprogram/test/runner.mjs` | `pnpm --filter @tapcub/app-sdk test` |
| Kotlin | `packages/android/core/src/test/kotlin/com/tapcub/core/VectorRunner.kt` | `cd packages/android && ./gradlew :core:test -Ptapcub.coreOnly=true` |
| Swift | `Tests/TapCubCoreTests/VectorRunner.swift` in tapcub-ios | `swift test` in the tapcub-ios root |
| HarmonyOS | The core is a copy of `app-sdk`, so the TS runner covers it | `pnpm --filter @tapcub/harmony test` (checks the copy is in sync) |

Behavior changes always go in this order: **vectors here → TS → Kotlin → Swift**, all in the same change. The Kotlin / Swift runners assert "≥ 83 run, 0 failed"; raise that number when you add App vectors.

## File format

```jsonc
{
  "name": "snake_case_name",          // matches the file name: NN-name.json
  "suite": "app",                     // optional: app | mp; native runners only run app vectors and vectors with no mini-program markers
  "platform": "android",              // optional: mp_weixin (default) | mp_alipay | … | android | ios | harmony
  "seed": 1, "now": 1700000000000,    // optional: random seed (mulberry32) and starting clock
  "storage": { "tc_did": "…" },       // optional: pre-populated storage
  "cfg": { "t": 3, "i": 1, "cs": { "req": false } },   // optional: remote config response; null means network failure
  "collect": 200,                     // optional: collect response status, or a [200, 500, …] sequence
  "nativeDeviceId": "android_id:…",   // optional: return value of DeviceInfo.deviceId()
  "config": { "region": "cn" },       // preInit config overrides; null means preInit is not called
  "steps": [ … ],
  "expect": { … }
}
```

Default preInit config: `siteKey: "k_vector_site"`, `endpoint: "https://c.test"`, `appId: "wxvector"`.

### steps

| Step | Meaning |
|---|---|
| `{ "call": "track", "args": ["a", { "x": 1 }], "expect": … }` | Call a public method; `expect` can assert the return value |
| `{ "advance": 5000 }` | Advance the clock by ms; due timers fire and microtasks drain |
| `{ "restart": true }` | Simulate a process kill and restart: keep storage, rebuild the core and preInit again |
| `{ "lifecycle": "launch" / "show" / "hide", "info": { "path": …, "query": … } }` | App lifecycle |
| `{ "page": "show" / "hide", "path": "pages/a", "query": {}, "title": "" }` | Page shown / hidden |
| `{ "share": "button", "path": … }`, `{ "favorite": true }` | Mini-program share / favorite |
| `{ "tap": { "type": "button", "id": "buy", "content": "买" }, "page": "pages/a" }` | Auto-captured click |
| `{ "crash": { "kind": "crash", "type": …, "message": …, "stack": …, "ts": … } }` | Crash hook callback |
| `{ "net": { "cfg": …, "collect": … } }` | Change responses mid-run |
| `{ "storageFail": true }` | Subsequent storage.set calls throw |

Microtasks drain between steps, so side effects on Promise chains have happened before the next step.

### expect

| Key | Content |
|---|---|
| `items` | The `items` of every POST to `/api/v1/pulse`, concatenated in order; array lengths must be equal |
| `requests` | Collect requests as `{ url, headers, body }` |
| `cfgRequests` | Number of config requests, or the list of their URLs |
| `deviceReads` | Number of `device.read()` calls |
| `state` | A subset of `getState()` |
| `errors` | `onError` callbacks as a list of `{ code, msg }` |
| `storage` | Storage key/values; `"<absent>"` means the key must not exist |
| `logs` | List of `log` callback texts |

Objects match as subsets: only the keys written in `expect` are checked. Arrays must match fully, in length and order.

## Matchers

Strings of the form `"<…>"` are matchers:

| Matcher | Passes when |
|---|---|
| `<any>` | The key exists (the value may be null) |
| `<absent>` | The key does not exist (undefined). Note that null is not absent |
| `<uuid>` | Lowercase UUID v4 |
| `<ts>` / `<num>` | A finite number |
| `<str>` | A non-empty string |
| `<bool>` | A boolean |
| `<hex64>` | 64 lowercase hex characters (sha256) |
| `<did>` / `<did:ios_idfv>` | A valid device ID / one with the given prefix |
| `<sid>` | An 8–32 character alphanumeric session ID |
| `<re:^a.*z$>` | A regular expression |
| `<$name>` | Records the value on first sight; later occurrences must be equal (across items / storage / state) |
| `<!$name>` | Must differ from the recorded `$name` |

Numbers compare by value (`1` equals `1.0`); string lengths and truncation count UTF-16 code units, as in JS.

## JS semantics native runners must reproduce

- Object keys are ordered, and reassigning a key does not move it (Kotlin uses `LinkedHashMap`, Swift an ordered dictionary).
- `undefined` (missing key) and `null` are different; `$duration_ms: null` must appear as is.
- `Math.round` rounds halves toward positive infinity; numbers are formatted by JS rules (`1.0` → `1`, `1e21` uses exponent notation).
- `fnv1a` works on UTF-16 code units as an unsigned 32-bit value; `mulberry32` is the seeded random.
- Microtasks drain between steps: Promise callbacks run before the next step, and timers fire only on `advance`.

## Skip rules

Kotlin / Swift only run vectors with `suite === "app"` or whose content has no mini-program markers (`$mp_`, `mp_uuid`, `tapcub-mp`, `mp_weixin` / `mp_alipay` / `mp_bytedance`, `withShareParams`, `requiredPrivacyApis`). Currently 83 run and 28 are skipped.
