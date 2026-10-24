"""End-to-end scenario against a running TapCub API. Used by scripts/smoke-sdk-server.mjs in the main repository.

    TAPCUB_API_KEY=wck_… TAPCUB_ENDPOINT=http://localhost:3001 TAPCUB_RUN=abc python3 examples/e2e.py
"""
import json
import logging
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from tapcub import TapCub  # noqa: E402

lang = "python"
run = os.environ.get("TAPCUB_RUN") or format(int(time.time() * 1000), "x")
api_key = os.environ["TAPCUB_API_KEY"]
endpoint = os.environ.get("TAPCUB_ENDPOINT")
user = f"{lang}-{run}"
logging.getLogger("tapcub").setLevel(logging.ERROR)

# 1. Validate one event without storing it
TapCub(api_key, endpoint, consumer="debug").track("sdk_e2e_debug", login_id=user)

# 2. Batch client: everything below goes out in one request on close()
errors = []
with TapCub(api_key, endpoint, on_error=errors.append) as tc:
    tc.track_signup(user, device_id=f"custom:{lang}{run}dev", invited_by="e2e-inviter", context={"campaign": {"source": "e2e", "medium": "sdk", "name": lang}})
    tc.track(
        "sdk_e2e_purchase",
        login_id=user,
        insert_id=f"{user}-o1",
        properties={"revenue": 19.9, "currency": "USD", "items": [{"item_id": f"sku-{lang}", "price": 19.9, "quantity": 1}]},
        context={"ip": "203.0.113.7", "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)", "url": "https://shop.example.com/checkout"},
    )
    tc.bind(user, {"email": f"{user}@example.com"})
    tc.profile_set(user, {"plan": "pro", "$name": f"E2E {lang}"})
    tc.profile_set_once(user, {"first_source": "e2e"})
    tc.profile_increment(user, {"orders": 1})
    tc.profile_append(user, {"tags": ["e2e"]})
    tc.item_set("product", f"sku-{lang}", {"name": "Shoe", "price": 19.9})
    tc.group_set("company", f"acme-{lang}", {"name": "Acme"})
    tc.track("sdk_e2e_seat", login_id=user, group=f"company:acme-{lang}")

if errors:
    print("\n".join(str(e) for e in errors), file=sys.stderr)
    sys.exit(1)
print(json.dumps({"ok": True, "lang": lang, "user": user}, separators=(",", ":")))
