from __future__ import annotations
import json
import urllib.request


class TapCub:
    def __init__(self, api_key: str, endpoint: str):
        self.api_key = api_key
        self.endpoint = endpoint.rstrip("/")

    def track(self, event: str, **opts):
        return self._send([{
            "type": "track",
            "event": event,
            "login_id": opts.get("login_id") or opts.get("loginId"),
            "device_id": opts.get("device_id") or opts.get("deviceId"),
            "insert_id": opts.get("insert_id") or opts.get("insertId"),
            "properties": opts.get("properties") or {},
            "context": {"platform": "server", "library": {"name": "tapcub", "version": "0.1.0"}, **(opts.get("context") or {})},
        }])

    def track_signup(self, login_id: str, device_id: str, properties=None):
        return self._send([{"type": "track_signup", "event": "sign_up", "login_id": login_id, "device_id": device_id, "properties": properties or {}}])

    def profile_set(self, login_id: str, props: dict):
        return self._send([{"type": "profile_set", "login_id": login_id, "properties": props}])

    def flush(self):
        pass

    def close(self):
        pass

    def _send(self, events):
        req = urllib.request.Request(
            self.endpoint + "/api/v1/track",
            data=json.dumps({"events": events}).encode(),
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {self.api_key}"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.loads(r.read().decode())
