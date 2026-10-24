# @tapcub/node

Server-side SDK for [TapCub](https://tapcub.com) on Node.js: business events, sign-ups, identities, user profiles, items and accounts, sent to `POST /api/v1/track`. Zero dependencies, ESM + CommonJS + TypeScript types.

- Batches in memory and sends in the background (or sends on every call)
- Retries network errors, 5xx and 429 with exponential backoff, without changing the batch
- Cleans each event before it is queued, so one bad value never rejects a whole batch
- Hashes email and mobile identities (SHA-256) before they leave your server

Requires Node.js 18 or newer (global `fetch`).

## Install

```bash
npm install @tapcub/node
```

## Quick start

```js
import { TapCub } from '@tapcub/node';

const tc = new TapCub({ apiKey: process.env.TAPCUB_API_KEY }); // a wck_… key with the track:write scope

tc.track('purchase', {
  loginId: user.id,
  insertId: order.id, // idempotency key: retries of the same order are counted once
  properties: { revenue: 99, currency: 'USD', items: [{ item_id: 'sku-1', price: 99, quantity: 1 }] },
});

await tc.close(); // before the process exits
```

Create the key in the TapCub console under **Configuration › Settings › API keys** with the **Server track** scope. It is shown once; keep it on the server and never ship it to browsers or apps.

## Configuration

| Option | Default | Description |
|---|---|---|
| `apiKey` | — | Required. Project key with the `track:write` (Server track) scope |
| `endpoint` | built in | Leave unset. Set it only when TapCub gives you a dedicated address (private deployment). A trailing `/api/v1/track` is removed |
| `consumer` | `'batch'` | `'batch'`: queue and send in the background. `'sync'`: send on every call; the promise rejects on failure. `'debug'`: like `'sync'` against `?debug=1` (validated, nothing stored), every result is logged |
| `maxBatch` | `200` | Events per request (at most 1000). Requests are also kept under 1 MB |
| `flushIntervalMs` | `3000` | How often the queue is sent |
| `maxQueueSize` | `10000` | Queued events kept in memory; the oldest are dropped beyond this |
| `maxRetries` | `5` | Retries for network errors, 5xx and 429 (honours `Retry-After`) |
| `timeoutMs` | `10000` | Per request |
| `gzip` | `false` | Send `Content-Encoding: gzip` |
| `onError` | log with `logger.error` | Receives a `TapCubError` for every background failure |
| `logger` | `console` | Any object with `warn` and `error` |
| `fetch` | global `fetch` | Custom fetch (proxies, tests) |

## API

All methods queue one event and return a promise (resolved at once in `batch` mode). Invalid arguments throw a `TypeError` and queue nothing.

| Method | Event |
|---|---|
| `track(event, { loginId?, loginIdType?, deviceId?, sessionId?, insertId?, time?, group?, properties?, context? })` | A business event |
| `trackSignup(loginId, { deviceId?, invitedBy?, properties?, context?, … })` | `sign_up`; links the anonymous device to the new login ID |
| `bind(loginId, { email?, mobile?, unionid?, openid?, custom? })` | Attach more identities (email / mobile hashed in the SDK) |
| `unbind(loginId, identityType, value)` | Remove one identity |
| `profileSet(loginId, props)` / `profileSetOnce(loginId, props)` | Set profile properties (`$name`, `$email`, `$phone`, `$avatar` are display fields) |
| `profileIncrement(loginId, { key: delta })` / `profileAppend(loginId, { key: [values] })` / `profileUnset(loginId, [keys])` | Change profile properties |
| `itemSet(itemType, itemId, props)` / `itemDelete(itemType, itemId)` | Dimension rows (products, articles, stores) |
| `trackUpdate(event, insertId, props)` / `trackOverwrite(event, insertId, props)` | Merge into / replace the properties of a stored event |
| `groupSet(groupType, groupId, props)` | Account (B2B group) traits; attach events with `track(…, { group: 'company:acme' })` |
| `flush()` | Send the queue now; rejects with the first `TapCubError` |
| `close()` | Stop the timer and `flush()` |
| `TapCub.fromRequestHeaders(headers)` | `{ deviceId, sessionId }` from `X-Tc-Device` / `X-Tc-Session` |

`time` is milliseconds or a `Date` and defaults to the time of the call. Properties are flat: strings (cut to 1000 characters), numbers and booleans; a list of objects such as `items` is kept one level deep; other nested values are sent as JSON strings.

### Record where a sign-up came from

The browser script already knows the visit source (`tapcub.getAttribution()`). Send it to your backend with the sign-up form and pass it through unchanged:

```js
app.post('/signup', async (req, res) => {
  const user = await createUser(req.body);
  tc.trackSignup(user.id, {
    deviceId: req.body.tapcubDeviceId,     // optional: links the anonymous visits
    invitedBy: req.body.inviterId,         // optional: referral program → properties.$invited_by
    context: {
      campaign: req.body.attribution,      // { source, medium, name, term, content, ref, click_id, landing_url, referrer, touched_at }
      ip: req.ip,                          // ip + user_agent let TapCub infer the source when there is no cookie
      user_agent: req.get('user-agent'),
    },
  });
  res.json({ ok: true });
});
```

## Idempotency

The SDK resends a failed batch unchanged, but it does **not** generate `insertId` for you. Pass a natural key (order ID, payment ID, ≤36 characters) for events that must not be counted twice; the server stores one event per `insertId`.

## Errors

```js
import { TapCub, TapCubError } from '@tapcub/node';

const tc = new TapCub({
  apiKey,
  onError: (err) => logger.warn({ code: err.code, status: err.status, lost: err.events.length }, err.message),
});
```

`err.code` is the server code (`NO_API_KEY`, `BAD_API_KEY`, `VALIDATION`, …), `HTTP_<status>`, `NETWORK`, `EVENT_REJECTED` (the request succeeded but some events were rejected; see `err.results`) or `QUEUE_FULL`. `err.events` holds the events that were not stored. 4xx responses other than 429 are not retried.

## Short-lived processes

In serverless functions, scripts and cron jobs, `await tc.flush()` before returning, or use `consumer: 'sync'`. Long-running servers should call `await tc.close()` on shutdown (`SIGTERM`); the client also flushes on `beforeExit`.

## Check your integration

```js
const debug = new TapCub({ apiKey, consumer: 'debug' });
await debug.track('purchase', { loginId: 'u1', properties: { revenue: 1 } }); // logs ok / warnings, stores nothing
```

## Documentation

[docs.tapcub.com → Server SDKs](https://docs.tapcub.com/en/sdk/server#node). Behaviour shared by every TapCub server SDK is specified by the conformance vectors in [`packages/shared/test-vectors/track`](https://github.com/tapcub/tapcub-sdk/tree/main/packages/shared/test-vectors/track).

## License

MIT
