# TapCub Java

Server-side SDK for [TapCub](https://tapcub.com) on the JVM: business events, sign-ups, identities, user profiles, items and accounts, sent to `POST /api/v1/track`. No runtime dependencies (Java 11 `HttpClient`).

- Batches in memory and sends from a background thread (or sends on every call)
- Retries network errors, 5xx and 429 with exponential backoff, without changing the batch
- Cleans each event before it is queued, so one bad value never rejects a whole batch
- Hashes email and mobile identities (SHA-256) before they leave your server

Requires Java 11 or newer. Works from Kotlin and Scala as well.

## Install

Maven:

```xml
<dependency>
  <groupId>com.tapcub</groupId>
  <artifactId>tapcub-java</artifactId>
  <version>0.1.0</version>
</dependency>
```

Gradle:

```kotlin
implementation("com.tapcub:tapcub-java:0.1.0")
```

## Quick start

```java
import com.tapcub.server.TapCub;
import com.tapcub.server.TrackOptions;

TapCub tc = TapCub.builder(System.getenv("TAPCUB_API_KEY")).build(); // a wck_… key with the track:write scope

tc.track("purchase", new TrackOptions()
    .loginId(user.getId())
    .insertId(order.getId()) // idempotency key: retries of the same order are counted once
    .property("revenue", 99)
    .property("currency", "USD")
    .property("items", List.of(Map.of("item_id", "sku-1", "price", 99, "quantity", 1))));

tc.close(); // on shutdown; a JVM shutdown hook also flushes
```

Create the key in the TapCub console under **Configuration › Settings › API keys** with the **Server track** scope. It is shown once; keep it in configuration, not in the repository.

Spring Boot: declare it as a bean so it is closed with the context.

```java
@Bean(destroyMethod = "close")
TapCub tapcub(@Value("${tapcub.api-key}") String key) {
  return TapCub.builder(key).build();
}
```

## Configuration

| Builder method | Default | Description |
|---|---|---|
| `endpoint(String)` | `https://api.pathclue.com` | Origin of the ingest API. A trailing `/api/v1/track` is removed |
| `mode(Mode)` | `BATCH` | `BATCH`: queue and send from a daemon thread. `SYNC`: send on every call and throw `TapCubException`. `DEBUG`: like `SYNC` against `?debug=1` (validated, nothing stored), every result is logged |
| `maxBatch(int)` | `200` | Events per request (at most 1000). Requests are also kept under 1 MB |
| `flushInterval(Duration)` | 3 s | How often the queue is sent |
| `maxQueueSize(int)` | `10000` | Queued events kept in memory; the oldest are dropped beyond this |
| `maxRetries(int)` | `5` | Retries for network errors, 5xx and 429 (honours `Retry-After`) |
| `timeout(Duration)` | 10 s | Per request |
| `gzip(boolean)` | `false` | Send `Content-Encoding: gzip` |
| `flushOnShutdown(boolean)` | `true` | Register a JVM shutdown hook that flushes (batch mode) |
| `onError(Consumer<TapCubException>)` | log at WARNING | Called for every background failure |
| `logger(java.util.logging.Logger)` | `com.tapcub` | Bridged to SLF4J / Log4j by the usual JUL bridges |
| `httpClient(HttpClient)` | new client | Custom client (proxies, TLS) |

## API

`TapCub` is thread-safe and `AutoCloseable`; create one per application. Invalid arguments throw `IllegalArgumentException` and queue nothing.

| Method | Event |
|---|---|
| `track(event, TrackOptions)` | A business event: `loginId`, `loginIdType`, `deviceId`, `sessionId`, `insertId`, `time`, `group`, `properties` / `property`, `context` / `ip` / `userAgent` / `url` / `campaign` |
| `trackSignup(loginId, SignupOptions)` | `sign_up`; links the anonymous device to the new login ID (`deviceId`, `invitedBy`, `properties`, `campaign`, …) |
| `bind(loginId, Map.of("email", …, "mobile", …))` | Attach more identities (email / mobile hashed in the SDK) |
| `unbind(loginId, identityType, value)` | Remove one identity |
| `profileSet(loginId, props)` / `profileSetOnce(loginId, props)` | Set profile properties (`$name`, `$email`, `$phone`, `$avatar` are display fields) |
| `profileIncrement(loginId, Map.of(key, delta))` / `profileAppend(loginId, Map.of(key, values))` / `profileUnset(loginId, keys)` | Change profile properties |
| `itemSet(itemType, itemId, props)` / `itemDelete(itemType, itemId)` | Dimension rows (products, articles, stores) |
| `trackUpdate(event, insertId, props)` / `trackOverwrite(event, insertId, props)` | Merge into / replace the properties of a stored event |
| `groupSet(groupType, groupId, props)` | Account (B2B group) traits; attach events with `.group("company:acme")` |
| `flush()` | Send the queue now; throws the first `TapCubException` |
| `close()` | Stop the thread and `flush()` |
| `TapCub.fromRequestHeaders(request::getHeader)` | `[deviceId, sessionId]` from `X-Tc-Device` / `X-Tc-Session` |

`time` takes milliseconds or an `Instant` and defaults to the time of the call. Properties are flat: strings (cut to 1000 characters), numbers and booleans; dates become ISO-8601 strings; a list of maps such as `items` is kept one level deep; other nested values are sent as JSON strings. Use a `LinkedHashMap` if the key order of nested JSON strings matters to you.

### Record where a sign-up came from

The browser script already knows the visit source (`tapcub.getAttribution()`). Send it to your backend with the sign-up form and pass it through unchanged (as a `Map` in API field names, or with `Campaign`):

```java
@PostMapping("/signup")
Map<String, Object> signup(@RequestBody SignupForm form, HttpServletRequest req) {
  User user = users.create(form);
  Map<String, Object> context = new HashMap<>();
  context.put("campaign", form.getAttribution()); // {source, medium, name, term, content, ref, click_id, landing_url, referrer, touched_at}
  context.put("ip", req.getRemoteAddr());         // ip + user_agent let TapCub infer the source when there is no cookie
  context.put("user_agent", req.getHeader("User-Agent"));
  tapcub.trackSignup(user.getId(), new SignupOptions()
      .deviceId(form.getTapcubDeviceId())          // optional: links the anonymous visits
      .invitedBy(form.getInviterId())              // optional: referral program → properties.$invited_by
      .context(context));
  return Map.of("ok", true);
}
```

## Idempotency

The SDK resends a failed batch unchanged, but it does **not** generate `insertId` for you. Pass a natural key (order ID, payment ID, ≤36 characters) for events that must not be counted twice; the server stores one event per `insertId`.

## Errors

```java
TapCub tc = TapCub.builder(key)
    .onError(e -> log.warn("tapcub {} ({}): {} events lost", e.getCode(), e.getStatus(), e.getEvents().size()))
    .build();
```

`getCode()` is the server code (`NO_API_KEY`, `BAD_API_KEY`, `VALIDATION`, …), `HTTP_<status>`, `NETWORK`, `EVENT_REJECTED` (the request succeeded but some events were rejected; see `getResults()`) or `QUEUE_FULL`. 4xx responses other than 429 are not retried.

## Check your integration

```java
TapCub.builder(key).mode(TapCub.Mode.DEBUG).build()
    .track("purchase", new TrackOptions().loginId("u1").property("revenue", 1));
// logs "debug #0 ok" (or the warnings) and stores nothing
```

## Documentation

[docs.tapcub.com → Server SDKs](https://docs.tapcub.com/en/sdk/server#java). Tests run the conformance vectors shared by every TapCub server SDK (`packages/shared/test-vectors/track`): `mvn verify`.

## License

MIT
