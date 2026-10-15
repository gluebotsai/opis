#!/usr/bin/env python3
"""
Webchat API smoke test — paste BASE_URL + BEARER_KEY + customer EMAIL/MOBILE, then:
  python3 scripts/test_webchat_api.py
"""

# ========== PASTE YOUR VALUES HERE ==========
BASE_URL = "http://127.0.0.1:3001"
BEARER_KEY = "wt_live_xnHWnX2S6OEEw13C3D5S_nKvvVU7ojYc"

NAME = "Fazil kumar"
EMAIL = "m.shajahan@worktual.com"   # must already exist in Ticketing customers
MOBILE = ""
ISSUE = "Need help with my account access"
# ============================================

import json
import urllib.error
import urllib.request


def post(path, payload):
    url = BASE_URL.rstrip("/") + path
    print("POST", url)
    print("Payload:", json.dumps(payload))
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": "Bearer " + BEARER_KEY.strip(),
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except Exception:
                return resp.status, {"raw": raw}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            body = json.loads(raw)
        except Exception:
            body = {"raw": raw, "error": str(e)}
        return e.code, body
    except urllib.error.URLError as e:
        return 0, {
            "error": "connection failed: " + str(e.reason),
            "hint": "Start ticketing API with: npm run dev:api  (must listen on :3001)",
        }


def show(title, status, body):
    print("\n=== " + title + " ===")
    print("HTTP", status)
    print(json.dumps(body, indent=2))
    if status == 0:
        print("FAIL: cannot reach server")
    elif status == 401:
        print("FAIL: bad or missing BEARER_KEY")
    elif isinstance(body, dict) and body.get("error") == "there is no account for this customer":
        print("FAIL: EMAIL/MOBILE is not an existing Active customer in Ticketing")
    elif isinstance(body, dict) and body.get("code") == "ticketing_not_purchased":
        print("FAIL: organization does not have Ticketing product in MyAccount")
    elif isinstance(body, dict) and body.get("success") is True:
        print("OK")


def main():
    if "PASTE_YOUR_KEY" in BEARER_KEY or not BEARER_KEY.strip():
        print("1) Open scripts/test_webchat_api.py")
        print("2) Set BEARER_KEY = your wt_live_… key")
        print("3) Set EMAIL (or MOBILE) to a customer that already exists in Ticketing")
        print("4) Run again: python3 scripts/test_webchat_api.py")
        return

    if "PASTE_EXISTING" in EMAIL and not MOBILE.strip():
        print("Set EMAIL or MOBILE to a real customer from Ticketing → Customers.")
        return

    create_body = {"name": NAME, "issue": ISSUE}
    if EMAIL.strip() and "PASTE_EXISTING" not in EMAIL:
        create_body["email"] = EMAIL.strip()
    if MOBILE.strip():
        create_body["mobile"] = MOBILE.strip()
    if "email" not in create_body and "mobile" not in create_body:
        print("Set EMAIL or MOBILE at the top of this file.")
        return

    lookup_body = {}
    if "email" in create_body:
        lookup_body["email"] = create_body["email"]
    else:
        lookup_body["mobile"] = create_body["mobile"]

    s1, b1 = post("/api/webchat/tickets", create_body)
    show("CREATE", s1, b1)

    s2, b2 = post("/api/webchat/tickets/lookup", lookup_body)
    show("LOOKUP", s2, b2)

    s3, b3 = post("/api/webchat/customers/verify", lookup_body)
    show("VERIFY", s3, b3)


if __name__ == "__main__":
    main()
