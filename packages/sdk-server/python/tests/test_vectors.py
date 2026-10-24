"""Shared conformance vectors: packages/shared/test-vectors/track (rules in that directory's README)."""
from __future__ import annotations

import copy
import json
import os
import time
import unittest
from pathlib import Path

from tapcub import TapCub

HERE = Path(__file__).resolve().parent
# 主仓库 / tapcub-sdk：packages/shared/test-vectors/track；单独打包时可用 TAPCUB_VECTORS 指定
CANDIDATES = [Path(os.environ["TAPCUB_VECTORS"])] if os.environ.get("TAPCUB_VECTORS") else []
CANDIDATES.append(HERE.parents[2] / "shared" / "test-vectors" / "track")
VECTOR_DIR = next((p for p in CANDIDATES if p.is_dir()), None)


class Capture(TapCub):
    def __init__(self) -> None:
        super().__init__("wck_test", consumer="sync")
        self.sent: list = []

    def _post(self, url, body, headers):  # noqa: ANN001
        self.sent.append(json.loads(body.decode("utf-8"))["events"])
        return 200, {}, b'{"received":1,"accepted":1,"rejected":0,"events":1,"results":[]}'


def call(tc: TapCub, method: str, a: dict) -> None:
    def opts(*keys: str) -> dict:
        return {k: a[k] for k in keys if k in a}

    if method == "track":
        tc.track(a.get("event"), **opts("login_id", "login_id_type", "device_id", "session_id", "insert_id", "time", "group", "properties", "context"))
    elif method == "track_signup":
        tc.track_signup(a.get("login_id"), **opts("device_id", "session_id", "insert_id", "time", "properties", "invited_by", "context"))
    elif method == "bind":
        tc.bind(a["login_id"], a["identities"])
    elif method == "unbind":
        tc.unbind(a["login_id"], a["identity_type"], a["value"])
    elif method in ("profile_set", "profile_set_once"):
        getattr(tc, method)(a["login_id"], a["properties"])
    elif method == "profile_increment":
        tc.profile_increment(a["login_id"], a["increment"])
    elif method == "profile_append":
        tc.profile_append(a["login_id"], a["append"])
    elif method == "profile_unset":
        tc.profile_unset(a["login_id"], a["keys"])
    elif method == "item_set":
        tc.item_set(a["item_type"], a["item_id"], a["properties"])
    elif method == "item_delete":
        tc.item_delete(a["item_type"], a["item_id"])
    elif method in ("track_update", "track_overwrite"):
        getattr(tc, method)(a["event"], a["insert_id"], a["properties"])
    elif method == "group_set":
        tc.group_set(a["group_type"], a["group_id"], a["properties"])
    else:
        raise AssertionError(f"unknown method {method}")


@unittest.skipIf(VECTOR_DIR is None, "shared vectors not found")
class VectorTests(unittest.TestCase):
    def test_vector_set_is_complete(self) -> None:
        self.assertGreaterEqual(len(list(VECTOR_DIR.glob("*.json"))), 30)

    def test_vectors(self) -> None:
        for f in sorted(VECTOR_DIR.glob("*.json")):
            v = json.loads(f.read_text("utf-8"))
            with self.subTest(vector=f.name):
                tc = Capture()
                if v.get("error"):
                    with self.assertRaises(ValueError):
                        call(tc, v["call"]["method"], v["call"]["args"])
                    self.assertEqual(tc.sent, [])
                    continue
                call(tc, v["call"]["method"], v["call"]["args"])
                self.assertEqual(len(tc.sent), 1)
                ev = tc.sent[0][0]
                expected = copy.deepcopy(v["expected"])
                if expected.get("time") == "$now":
                    self.assertIsInstance(ev["time"], int)
                    self.assertLess(abs(ev["time"] - time.time() * 1000), 60_000)
                    expected["time"] = ev["time"]
                self.assertEqual(ev, expected)


if __name__ == "__main__":
    unittest.main()
