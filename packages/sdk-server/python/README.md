# tapcub

Server-side SDK for [TapCub](https://tapcub.com) on Python: business events, sign-ups, identities, user profiles, items and accounts, sent to `POST /api/v1/track`. Standard library only, typed (`py.typed`).

- Batches in memory and sends from a background thread (or sends on every call)
- Retries network errors, 5xx and 429 with exponential backoff, without changing the batch
- Cleans each event before it is queued, so one bad value never rejects a whole batch
- Hashes email and mobile identities (SHA-256) before they leave your server

Requires Python 3.8 or newer.

## Install

```bash
pip install tapcub
```

## Quick start

```python
import os
from tapcub import TapCub

tc = TapCub(os.environ["TAPCUB_API_KEY"])  # a wck_… key with the track:write scope

tc.track(
    "purchase",
    login_id=user.id,
    insert_id=order.id,  # idempotency key: retries of the same order are counted once
    properties={"revenue": 99, "currency": "USD", "items": [{"item_id": "sku-1", "price": 99, "quantity": 1}]},
)

tc.close()  # also runs automatically when the interpreter exits
```

Create the key in the TapCub console under **Configuration › Settings › API keys** with the **Server track** scope. It is shown once; keep it on the server.

## Configuration

`TapCub(api_key, endpoint=None, *, …)`

| Argument | Default | Description |
|---|---|---|
| `api_key` | — | Required. Project key with the `track:write` (Server track) scope |
| `endpoint` | `https://api.pathclue.com` | Origin of the ingest API. A trailing `/api/v1/track` is removed |
| `consumer` | `"batch"` | `"batch"`: queue and send from a daemon thread. `"sync"`: send on every call and raise `TapCubError` on failure (calls return the server response). `"debug"`: like `"sync"` against `?debug=1` (validated, nothing stored), every result is logged |
| `max_batch` | `200` | Events per request (at most 1000). Requests are also kept under 1 MB |
| `flush_interval` | `3.0` | Seconds between sends |
| `max_queue_size` | `10000` | Queued events kept in memory; the oldest are dropped beyond this |
| `max_retries` | `5` | Retries for network errors, 5xx and 429 (honours `Retry-After`) |
| `timeout` | `10.0` | Seconds per request |
| `gzip` | `False` | Send `Content-Encoding: gzip` |
| `on_error` | log to the `tapcub` logger | Called with a `TapCubError` for every background failure |
| `logger` | `logging.getLogger("tapcub")` | |

## API

Invalid arguments raise `ValueError` and queue nothing. The client is thread-safe; create one per process.

| Method | Event |
|---|---|
| `track(event, *, login_id=None, login_id_type=None, device_id=None, session_id=None, insert_id=None, time=None, group=None, properties=None, context=None)` | A business event |
| `track_signup(login_id, *, device_id=None, invited_by=None, properties=None, context=None, …)` | `sign_up`; links the anonymous device to the new login ID |
| `bind(login_id, {"email": …, "mobile": …, "unionid": …})` | Attach more identities (email / mobile hashed in the SDK) |
| `unbind(login_id, identity_type, value)` | Remove one identity |
| `profile_set(login_id, props)` / `profile_set_once(login_id, props)` | Set profile properties (`$name`, `$email`, `$phone`, `$avatar` are display fields) |
| `profile_increment(login_id, {key: delta})` / `profile_append(login_id, {key: [values]})` / `profile_unset(login_id, [keys])` | Change profile properties |
| `item_set(item_type, item_id, props)` / `item_delete(item_type, item_id)` | Dimension rows (products, articles, stores) |
| `track_update(event, insert_id, props)` / `track_overwrite(event, insert_id, props)` | Merge into / replace the properties of a stored event |
| `group_set(group_type, group_id, props)` | Account (B2B group) traits; attach events with `track(…, group="company:acme")` |
| `flush()` | Send the queue now; raises the first `TapCubError` |
| `close()` | Stop the thread and `flush()`; `with TapCub(…) as tc:` does this for you |
| `from_request_headers(headers)` | `{"device_id", "session_id"}` from `X-Tc-Device` / `X-Tc-Session` (Django, Flask, Starlette, WSGI environ) |

`time` is milliseconds since the epoch or a `datetime` and defaults to the time of the call. Properties are flat: strings (cut to 1000 characters), numbers and booleans; dates become ISO-8601 strings; a list of dicts such as `items` is kept one level deep; other nested values are sent as JSON strings.

### Record where a sign-up came from

The browser script already knows the visit source (`tapcub.getAttribution()`). Send it to your backend with the sign-up form and pass it through unchanged:

```python
# Django view
def signup(request):
    data = json.loads(request.body)
    user = create_user(data)
    tc.track_signup(
        user.id,
        device_id=data.get("tapcubDeviceId"),   # optional: links the anonymous visits
        invited_by=data.get("inviterId"),       # optional: referral program → properties.$invited_by
        context={
            "campaign": data.get("attribution"),  # {source, medium, name, term, content, ref, click_id, landing_url, referrer, touched_at}
            "ip": request.META.get("REMOTE_ADDR"),  # ip + user_agent let TapCub infer the source when there is no cookie
            "user_agent": request.headers.get("User-Agent"),
        },
    )
    return JsonResponse({"ok": True})
```

## Idempotency

The SDK resends a failed batch unchanged, but it does **not** generate `insert_id` for you. Pass a natural key (order ID, payment ID, ≤36 characters) for events that must not be counted twice; the server stores one event per `insert_id`.

## Errors

```python
from tapcub import TapCub, TapCubError

def report(err: TapCubError) -> None:
    log.warning("tapcub %s (%s): %d events lost", err.code, err.status, len(err.events))

tc = TapCub(api_key, on_error=report)
```

`err.code` is the server code (`NO_API_KEY`, `BAD_API_KEY`, `VALIDATION`, …), `HTTP_<status>`, `NETWORK`, `EVENT_REJECTED` (the request succeeded but some events were rejected; see `err.results`) or `QUEUE_FULL`. 4xx responses other than 429 are not retried.

## Short-lived processes and workers

Scripts, Lambda handlers and Celery tasks should call `tc.flush()` before returning, or use `consumer="sync"`. With forking servers (gunicorn `--preload`, uWSGI) create the client after the fork, because the sender thread does not survive it.

## Check your integration

```python
TapCub(api_key, consumer="debug").track("purchase", login_id="u1", properties={"revenue": 1})
# logs "debug #0 ok" (or the warnings) and stores nothing
```

## Documentation

[docs.tapcub.com → Server SDKs](https://docs.tapcub.com/en/sdk/server#python). Behaviour shared by every TapCub server SDK is specified by the conformance vectors in [`packages/shared/test-vectors/track`](https://github.com/tapcub/tapcub-sdk/tree/main/packages/shared/test-vectors/track).

## License

MIT
