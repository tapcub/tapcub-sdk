from __future__ import annotations

import atexit
import gzip as _gzip
import json
import logging
import random
import re
import threading
import time
import urllib.error
import urllib.request
import weakref
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Mapping, Optional, Tuple

from . import _normalize as n
from .version import VERSION

DEFAULT_ENDPOINT = "https://api.pathclue.com"
MAX_BODY_BYTES = 1_000_000
_log = logging.getLogger("tapcub")


class TapCubError(Exception):
    """A batch that could not be delivered, or events the server rejected.

    code: server code (``NO_API_KEY``, ``BAD_API_KEY``, ``VALIDATION`` …), ``HTTP_<status>``, ``NETWORK``,
    ``EVENT_REJECTED`` or ``QUEUE_FULL``. ``events`` are the events that were not stored.
    """

    def __init__(self, message: str, code: str, status: Optional[int] = None, events: Optional[List[dict]] = None, results: Optional[List[dict]] = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.events = events or []
        self.results = results
        self.retry_after: Optional[float] = None


def normalize_endpoint(endpoint: Optional[str]) -> str:
    e = (endpoint or DEFAULT_ENDPOINT).strip().rstrip("/")
    e = re.sub(r"/api/v1(/track)?$", "", e)
    if not re.match(r"^https?://", e):
        raise ValueError("TapCub: endpoint must start with http:// or https://")
    return e


def from_request_headers(headers: Mapping[str, Any]) -> Dict[str, Optional[str]]:
    """Read the device and session IDs a TapCub client put on a request to your backend
    (``X-Tc-Device`` / ``X-Tc-Session``). Works with Django / Flask / Starlette ``request.headers``,
    a WSGI ``environ`` or a plain dict. Returns ``{"device_id": …, "session_id": …}``."""

    def get(name: str) -> Optional[str]:
        v = None
        if hasattr(headers, "get"):
            v = headers.get(name) or headers.get(name.lower()) or headers.get("HTTP_" + name.upper().replace("-", "_"))
        if isinstance(v, (list, tuple)):
            v = v[0] if v else None
        return v.strip() or None if isinstance(v, str) else None

    return {"device_id": get("X-Tc-Device"), "session_id": get("X-Tc-Session")}


class TapCub:
    """TapCub server-side client.

    consumer:
      ``"batch"`` (default) queue in memory and send from a background thread every ``flush_interval`` seconds or
      when ``max_batch`` events are queued; flushed again when the interpreter exits.
      ``"sync"`` send on every call and raise ``TapCubError`` on failure.
      ``"debug"`` like ``sync``, against ``?debug=1`` (validated, nothing stored), every result is logged.
    """

    def __init__(
        self,
        api_key: str,
        endpoint: Optional[str] = None,
        *,
        consumer: str = "batch",
        max_batch: int = 200,
        flush_interval: float = 3.0,
        max_queue_size: int = 10_000,
        max_retries: int = 5,
        timeout: float = 10.0,
        gzip: bool = False,
        on_error: Optional[Callable[[TapCubError], None]] = None,
        logger: Optional[logging.Logger] = None,
        _retry_base: float = 0.5,
    ):
        if not api_key or not str(api_key).strip():
            raise ValueError("TapCub: api_key is required")
        if consumer not in ("batch", "sync", "debug"):
            raise ValueError("TapCub: consumer must be batch, sync or debug")
        self.api_key = str(api_key).strip()
        self.endpoint = normalize_endpoint(endpoint)
        self.consumer = consumer
        self.max_batch = max(1, min(1000, int(max_batch)))
        self.max_queue_size = max(1, int(max_queue_size))
        self.max_retries = max(0, int(max_retries))
        self.timeout = timeout
        self.gzip = bool(gzip)
        self.logger = logger or _log
        self.on_error = on_error or (lambda e: self.logger.error("[tapcub] %s", e))
        self._retry_base = _retry_base
        self._queue: Deque[Tuple[dict, int]] = deque()
        self._dropped = 0
        self._lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._flush_interval = max(0.01, float(flush_interval))
        if consumer == "batch":
            self._thread = threading.Thread(target=self._run, name="tapcub-sender", daemon=True)
            self._thread.start()
            ref = weakref.ref(self)
            self._atexit = lambda: ref() and ref()._shutdown()  # type: ignore[union-attr]
            atexit.register(self._atexit)

    # ---------------- events ----------------

    def track(
        self,
        event: str,
        *,
        login_id: Optional[str] = None,
        login_id_type: Optional[str] = None,
        device_id: Optional[str] = None,
        session_id: Optional[str] = None,
        insert_id: Optional[str] = None,
        time: Any = None,
        group: Optional[str] = None,
        properties: Optional[Mapping[str, Any]] = None,
        context: Optional[Mapping[str, Any]] = None,
    ) -> Optional[dict]:
        """A business event. ``insert_id`` (≤36) is the idempotency key; it is not generated for you."""
        kind = n.login_id_type(login_id_type)
        raw = n.optional_text("login_id", login_id, 200)
        return self._enqueue({
            "type": "track",
            "event": n.event_name(event),
            "login_id": n.identity_value(kind, raw) if raw and kind in ("email", "mobile") else raw,
            "login_id_type": kind,
            "device_id": n.optional_text("device_id", device_id, 72),
            "session_id": n.optional_text("session_id", session_id, 32),
            "insert_id": n.optional_text("insert_id", insert_id, 36),
            "time": n.timestamp(time),
            "group": n.group(group),
            "properties": n.properties(properties),
            "context": n.context(context),
        })

    def track_signup(
        self,
        login_id: str,
        *,
        device_id: Optional[str] = None,
        session_id: Optional[str] = None,
        insert_id: Optional[str] = None,
        time: Any = None,
        properties: Optional[Mapping[str, Any]] = None,
        invited_by: Optional[str] = None,
        context: Optional[Mapping[str, Any]] = None,
    ) -> Optional[dict]:
        """Sign-up: links the anonymous device (if any) to the new login ID and records ``sign_up``.
        ``invited_by`` is the inviter's login ID (sent as ``properties.$invited_by``)."""
        props = dict(properties or {})
        if invited_by is not None and str(invited_by).strip():
            props["$invited_by"] = str(invited_by).strip()
        return self._enqueue({
            "type": "track_signup",
            "event": "sign_up",
            "login_id": n.require_text("login_id", login_id, 200),
            "device_id": n.optional_text("device_id", device_id, 72),
            "session_id": n.optional_text("session_id", session_id, 32),
            "insert_id": n.optional_text("insert_id", insert_id, 36),
            "time": n.timestamp(time),
            "properties": n.properties(props),
            "context": n.context(context),
        })

    def track_update(self, event: str, insert_id: str, properties: Mapping[str, Any]) -> Optional[dict]:
        """Merge properties into the stored event with this ``insert_id``."""
        return self._enqueue({"type": "track_update", "event": n.event_name(event), "insert_id": n.require_text("insert_id", insert_id, 36), "time": n.timestamp(None), "properties": n.properties(properties)})

    def track_overwrite(self, event: str, insert_id: str, properties: Mapping[str, Any]) -> Optional[dict]:
        """Replace the properties of the stored event with this ``insert_id``."""
        return self._enqueue({"type": "track_overwrite", "event": n.event_name(event), "insert_id": n.require_text("insert_id", insert_id, 36), "time": n.timestamp(None), "properties": n.properties(properties)})

    # ---------------- identity ----------------

    def bind(self, login_id: str, identities: Mapping[str, str]) -> Optional[dict]:
        """Attach more identities (``email``, ``mobile``, ``unionid``, ``openid``, ``custom``). Email and mobile are SHA-256 hashed first."""
        return self._enqueue({"type": "bind", "login_id": n.require_text("login_id", login_id, 200), "time": n.timestamp(None), "identities": n.identities(identities)})

    def unbind(self, login_id: str, identity_type: str, value: str) -> Optional[dict]:
        """Remove one identity from the user."""
        return self._enqueue({"type": "unbind", "login_id": n.require_text("login_id", login_id, 200), "time": n.timestamp(None), "identities": n.identities({identity_type: n.require_text("value", value)})})

    # ---------------- profiles ----------------

    def profile_set(self, login_id: str, properties: Mapping[str, Any]) -> Optional[dict]:
        return self._profile("profile_set", login_id, properties=n.properties(properties))

    def profile_set_once(self, login_id: str, properties: Mapping[str, Any]) -> Optional[dict]:
        """Set only the properties that are not set yet."""
        return self._profile("profile_set_once", login_id, properties=n.properties(properties))

    def profile_increment(self, login_id: str, increment: Mapping[str, Any]) -> Optional[dict]:
        return self._profile("profile_increment", login_id, increment=n.increment(increment))

    def profile_append(self, login_id: str, append: Mapping[str, Any]) -> Optional[dict]:
        return self._profile("profile_append", login_id, append=n.append(append))

    def profile_unset(self, login_id: str, keys: List[str]) -> Optional[dict]:
        return self._profile("profile_unset", login_id, unset=n.unset_keys(keys))

    # ---------------- items / accounts ----------------

    def item_set(self, item_type: str, item_id: str, properties: Mapping[str, Any]) -> Optional[dict]:
        """Upsert a dimension row (product, article, store …)."""
        return self._enqueue({"type": "item_set", "item_type": n.require_text("item_type", item_type, 40), "item_id": n.require_text("item_id", item_id, 80), "time": n.timestamp(None), "properties": n.properties(properties)})

    def item_delete(self, item_type: str, item_id: str) -> Optional[dict]:
        return self._enqueue({"type": "item_delete", "item_type": n.require_text("item_type", item_type, 40), "item_id": n.require_text("item_id", item_id, 80), "time": n.timestamp(None)})

    def group_set(self, group_type: str, group_id: str, properties: Mapping[str, Any]) -> Optional[dict]:
        """Set account (group) traits for ``group_type:group_id``."""
        return self._enqueue({"type": "group_set", "group": n.group_key(group_type, group_id), "time": n.timestamp(None), "properties": n.properties(properties)})

    # ---------------- sending ----------------

    def flush(self) -> None:
        """Send everything queued now. Raises the first ``TapCubError`` if a batch could not be delivered."""
        errors = self._drain()
        if errors:
            raise errors[0]

    def close(self) -> None:
        """Stop the background thread and send what is queued (raises like ``flush``)."""
        self._stop.set()
        self._wake.set()
        if self._thread and self._thread is not threading.current_thread():
            self._thread.join(timeout=self.timeout * (self.max_retries + 1) + 5)
        if getattr(self, "_atexit", None):
            atexit.unregister(self._atexit)
            self._atexit = None
        self.flush()

    def __enter__(self) -> "TapCub":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    @property
    def queued(self) -> int:
        return len(self._queue)

    def _profile(self, kind: str, login_id: str, **body: Any) -> Optional[dict]:
        return self._enqueue({"type": kind, "login_id": n.require_text("login_id", login_id, 200), "time": n.timestamp(None), **body})

    def _enqueue(self, raw: Mapping[str, Any]) -> Optional[dict]:
        ev = n.compact(raw)
        if self.consumer != "batch":
            return self._send([ev], self.consumer == "debug")
        size = len(json.dumps(ev, separators=(",", ":"), ensure_ascii=False).encode("utf-8")) + 1
        with self._lock:
            self._queue.append((ev, size))
            over = len(self._queue) - self.max_queue_size
            for _ in range(max(0, over)):
                self._queue.popleft()
                self._dropped += 1
            full = len(self._queue) >= self.max_batch
        if full:
            self._wake.set()
        return None

    def _run(self) -> None:
        while not self._stop.is_set():
            self._wake.wait(self._flush_interval)
            self._wake.clear()
            if self._stop.is_set():
                break
            for e in self._drain():
                self._report(e)

    def _shutdown(self) -> None:
        try:
            self.close()
        except TapCubError as e:
            self._report(e)

    def _report(self, err: TapCubError) -> None:
        try:
            self.on_error(err)
        except Exception:  # noqa: BLE001
            self.logger.exception("[tapcub] on_error raised")

    def _take(self) -> List[dict]:
        with self._lock:
            batch: List[dict] = []
            size = 0
            while self._queue and len(batch) < self.max_batch:
                ev, b = self._queue[0]
                if batch and size + b > MAX_BODY_BYTES:
                    break
                self._queue.popleft()
                batch.append(ev)
                size += b
            return batch

    def _drain(self) -> List[TapCubError]:
        errors: List[TapCubError] = []
        with self._send_lock:
            with self._lock:
                dropped, self._dropped = self._dropped, 0
            if dropped:
                errors.append(TapCubError(f"TapCub: queue full, dropped {dropped} oldest event(s)", "QUEUE_FULL"))
            while True:
                batch = self._take()
                if not batch:
                    break
                try:
                    self._send(batch, False)
                except TapCubError as e:
                    errors.append(e)
        return errors

    def _post(self, url: str, body: bytes, headers: Dict[str, str]) -> Tuple[int, Dict[str, str], bytes]:
        """One HTTP request. Returns (status, headers, body); raises OSError on network errors."""
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:  # noqa: S310 (endpoint is configured by the caller)
                return r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
        except urllib.error.HTTPError as e:
            return e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, e.read() or b""

    def _send(self, events: List[dict], debug: bool) -> dict:
        url = f"{self.endpoint}/api/v1/track" + ("?debug=1" if debug else "")
        body = json.dumps({"events": events}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        headers = {"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}", "User-Agent": f"tapcub-python/{VERSION}"}
        if self.gzip:
            body = _gzip.compress(body)
            headers["Content-Encoding"] = "gzip"
        last: Optional[TapCubError] = None
        for attempt in range(self.max_retries + 1):
            if attempt:
                time.sleep(self._backoff(attempt, last))
            try:
                status, res_headers, raw = self._post(url, body, headers)
            except (OSError, ValueError) as e:
                last = TapCubError(f"TapCub: request failed: {e}", "NETWORK", events=events)
                continue
            try:
                data = json.loads(raw.decode("utf-8")) if raw else {}
            except ValueError:
                data = {}
            if not isinstance(data, dict):
                data = {}
            if 200 <= status < 300:
                results = data.get("results") or []
                if debug:
                    for r in results:
                        w = r.get("warnings") or []
                        self.logger.warning("[tapcub] debug #%s %s%s", r.get("index"), "ok" if r.get("ok") else "rejected", f" warnings={','.join(w)}" if w else "")
                bad = [r for r in results if not r.get("ok")]
                if bad:
                    raise TapCubError(
                        "TapCub: %d event(s) rejected: %s" % (len(bad), "; ".join(f"#{r.get('index')} {','.join(r.get('warnings') or []) or 'rejected'}" for r in bad)),
                        "EVENT_REJECTED", status, [events[r["index"]] for r in bad if isinstance(r.get("index"), int) and r["index"] < len(events)], bad,
                    )
                data.setdefault("results", [])
                return data
            code = data.get("code") if isinstance(data.get("code"), str) else f"HTTP_{status}"
            msg = data.get("message") if isinstance(data.get("message"), str) else raw[:200].decode("utf-8", "replace")
            issues = data.get("issues")
            detail = f" ({'; '.join(str(i) for i in issues[:3])})" if isinstance(issues, list) and issues else ""
            last = TapCubError(f"TapCub: HTTP {status} {code}: {msg}{detail}", code, status, events)
            try:
                last.retry_after = float(res_headers.get("retry-after", "") or 0) or None
            except ValueError:
                last.retry_after = None
            if status != 429 and status < 500:
                raise last
        assert last is not None
        raise last

    def _backoff(self, attempt: int, last: Optional[TapCubError]) -> float:
        if last is not None and last.retry_after:
            return min(60.0, last.retry_after)
        base = min(30.0, self._retry_base * 2 ** (attempt - 1))
        return base / 2 + random.random() * base / 2
