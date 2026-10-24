"""Transport behaviour against a local HTTP server: batching, splitting, retries, gzip, error handling, debug."""
from __future__ import annotations

import datetime as dt
import gzip
import json
import re
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from tapcub import VERSION, TapCub, TapCubError, from_request_headers, normalize_endpoint

OK = (200, {"received": 1, "accepted": 1, "rejected": 0, "events": 1, "results": []}, {})


class Server:
    def __init__(self, handler=lambda req, n: OK):  # noqa: ANN001
        self.reqs: list = []
        outer = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                if self.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                req = {"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": json.loads(raw)}
                outer.reqs.append(req)
                status, body, headers = handler(req, len(outer.reqs))
                data = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                for k, v in headers.items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args) -> None:  # noqa: ANN002
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.endpoint = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


class ClientTests(unittest.TestCase):
    def test_version_matches_pyproject(self) -> None:
        text = (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text("utf-8")
        self.assertEqual(re.search(r'^version\s*=\s*"([^"]+)"', text, re.M).group(1), VERSION)

    def test_endpoint_normalization(self) -> None:
        self.assertEqual(normalize_endpoint(None), "https://api.pathclue.com")
        self.assertEqual(normalize_endpoint("https://api.pathclue.com/"), "https://api.pathclue.com")
        self.assertEqual(normalize_endpoint("https://x.example.com/api/v1/track"), "https://x.example.com")
        self.assertEqual(normalize_endpoint("https://x.example.com/proxy/api/v1"), "https://x.example.com/proxy")
        with self.assertRaises(ValueError):
            normalize_endpoint("api.pathclue.com")
        with self.assertRaises(ValueError):
            TapCub("")

    def test_headers_and_path(self) -> None:
        s = Server()
        tc = TapCub("wck_abc", s.endpoint, consumer="sync")
        res = tc.track("purchase", insert_id="o1")
        self.assertEqual(res["accepted"], 1)
        r = s.reqs[0]
        self.assertEqual(r["path"], "/api/v1/track")
        self.assertEqual(r["headers"]["authorization"], "Bearer wck_abc")
        self.assertEqual(r["headers"]["content-type"], "application/json")
        self.assertEqual(r["headers"]["user-agent"], f"tapcub-python/{VERSION}")
        self.assertEqual(list(r["body"]), ["events"])
        s.close()

    def test_batch_split_and_close(self) -> None:
        s = Server()
        tc = TapCub("k", s.endpoint, max_batch=2, flush_interval=60)
        tc.track("a")
        self.assertEqual(s.reqs, [])
        self.assertEqual(tc.queued, 1)
        tc.track("b")
        tc.track("c")
        tc.close()
        self.assertEqual(sorted(e["event"] for r in s.reqs for e in r["body"]["events"]), ["a", "b", "c"])
        self.assertTrue(all(len(r["body"]["events"]) <= 2 for r in s.reqs))
        s.close()

    def test_flush_on_interval(self) -> None:
        s = Server()
        tc = TapCub("k", s.endpoint, flush_interval=0.05)
        tc.track("a")
        time.sleep(0.4)
        self.assertEqual(len(s.reqs), 1)
        tc.close()
        s.close()

    def test_context_manager(self) -> None:
        s = Server()
        with TapCub("k", s.endpoint, flush_interval=60) as tc:
            tc.track("a")
        self.assertEqual(len(s.reqs), 1)
        s.close()

    def test_body_split_at_1mb(self) -> None:
        s = Server()
        tc = TapCub("k", s.endpoint, max_batch=1000, flush_interval=60)
        big = {f"p{i}": "x" * 1000 for i in range(40)}
        for _ in range(50):
            tc.track("big", properties=big)
        tc.flush()
        self.assertGreaterEqual(len(s.reqs), 2)
        for r in s.reqs:
            self.assertLessEqual(len(json.dumps(r["body"], separators=(",", ":")).encode()), 1_000_000)
        self.assertEqual(sum(len(r["body"]["events"]) for r in s.reqs), 50)
        tc.close()
        s.close()

    def test_retries_same_body(self) -> None:
        s = Server(lambda req, n: (503, {"message": "down"}, {}) if n == 1 else (429, {"message": "slow"}, {"Retry-After": "0"}) if n == 2 else OK)
        tc = TapCub("k", s.endpoint, consumer="sync", _retry_base=0.005)
        tc.track("a", insert_id="same")
        self.assertEqual(len(s.reqs), 3)
        self.assertEqual(s.reqs[0]["body"], s.reqs[2]["body"])
        s.close()

    def test_4xx_not_retried(self) -> None:
        s = Server(lambda req, n: (401, {"statusCode": 401, "message": "bad key", "code": "BAD_API_KEY"}, {}))
        tc = TapCub("k", s.endpoint, consumer="sync", _retry_base=0.005)
        with self.assertRaises(TapCubError) as cm:
            tc.track("a")
        self.assertEqual((cm.exception.code, cm.exception.status, len(cm.exception.events)), ("BAD_API_KEY", 401, 1))
        self.assertEqual(len(s.reqs), 1)
        s.close()

    def test_background_errors_go_to_on_error_and_flush_raises(self) -> None:
        s = Server(lambda req, n: (500, {"message": "boom"}, {}))
        errors: list = []
        tc = TapCub("k", s.endpoint, max_retries=2, _retry_base=0.005, max_batch=1, flush_interval=60, on_error=errors.append)
        tc.track("a")
        for _ in range(100):
            if errors:
                break
            time.sleep(0.02)
        self.assertEqual(len(s.reqs), 3)
        self.assertEqual([e.code for e in errors], ["HTTP_500"])
        tc.close()
        tc2 = TapCub("k", s.endpoint, max_retries=1, _retry_base=0.005, flush_interval=60, on_error=errors.append)
        tc2.track("b")
        with self.assertRaises(TapCubError) as cm:
            tc2.close()
        self.assertEqual(cm.exception.events[0]["event"], "b")
        self.assertEqual(len(errors), 1)
        s.close()

    def test_network_error(self) -> None:
        tc = TapCub("k", "http://127.0.0.1:9", consumer="sync", max_retries=1, _retry_base=0.005, timeout=2)
        with self.assertRaises(TapCubError) as cm:
            tc.track("a")
        self.assertEqual(cm.exception.code, "NETWORK")

    def test_event_rejected_in_2xx(self) -> None:
        s = Server(lambda req, n: (200, {"received": 2, "accepted": 1, "rejected": 1, "results": [{"index": 1, "ok": False, "warnings": ["profile_without_person"]}]}, {}))
        tc = TapCub("k", s.endpoint, flush_interval=60)
        tc.track("a")
        tc.profile_set("u", {"a": 1})
        with self.assertRaises(TapCubError) as cm:
            tc.flush()
        self.assertEqual(cm.exception.code, "EVENT_REJECTED")
        self.assertEqual([e["type"] for e in cm.exception.events], ["profile_set"])
        tc.close()
        s.close()

    def test_queue_overflow_drops_oldest(self) -> None:
        s = Server()
        tc = TapCub("k", s.endpoint, max_queue_size=3, max_batch=1000, flush_interval=60)
        for e in "abcde":
            tc.track(e)
        with self.assertRaises(TapCubError) as cm:
            tc.flush()
        self.assertEqual(cm.exception.code, "QUEUE_FULL")
        self.assertEqual([e["event"] for e in s.reqs[0]["body"]["events"]], ["c", "d", "e"])
        tc.close()
        s.close()

    def test_gzip(self) -> None:
        s = Server()
        TapCub("k", s.endpoint, consumer="sync", gzip=True).track("a")
        self.assertEqual(s.reqs[0]["headers"]["content-encoding"], "gzip")
        self.assertEqual(s.reqs[0]["body"]["events"][0]["event"], "a")
        s.close()

    def test_debug_consumer(self) -> None:
        s = Server(lambda req, n: (200, {"debug": True, "results": [{"index": 0, "ok": True, "warnings": ["plaintext_identity_hashed"]}]}, {}))
        tc = TapCub("k", s.endpoint, consumer="debug")
        with self.assertLogs("tapcub", level="WARNING") as logs:
            tc.track("a")
        self.assertEqual(s.reqs[0]["path"], "/api/v1/track?debug=1")
        self.assertIn("#0 ok warnings=plaintext_identity_hashed", logs.output[0])
        s.close()

    def test_datetime_time_and_properties(self) -> None:
        s = Server()
        when = dt.datetime(2026, 10, 1, 12, 0, tzinfo=dt.timezone.utc)
        TapCub("k", s.endpoint, consumer="sync").track("a", time=when, properties={"at": when, "day": dt.date(2026, 10, 1)})
        ev = s.reqs[0]["body"]["events"][0]
        self.assertEqual(ev["time"], int(when.timestamp() * 1000))
        self.assertEqual(ev["properties"], {"at": "2026-10-01T12:00:00+00:00", "day": "2026-10-01"})
        s.close()

    def test_from_request_headers(self) -> None:
        self.assertEqual(from_request_headers({"X-Tc-Device": "custom:abcd1234", "X-Tc-Session": " s1 "}), {"device_id": "custom:abcd1234", "session_id": "s1"})
        self.assertEqual(from_request_headers({"HTTP_X_TC_DEVICE": "custom:abcd1234"}), {"device_id": "custom:abcd1234", "session_id": None})


if __name__ == "__main__":
    unittest.main()
