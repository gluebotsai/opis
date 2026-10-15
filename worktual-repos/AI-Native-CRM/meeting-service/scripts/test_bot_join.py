#!/usr/bin/env python3
"""Local smoke: dispatch a bot via meeting-service and poll Vexa status."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

import jwt

BASE = os.environ.get("MEETING_SERVICE_URL", "http://127.0.0.1:8030").rstrip("/")
SECRET = os.environ.get("CRM_SERVICE_JWT_SECRET", "")
MEET_URL = os.environ.get(
    "TEST_MEET_URL",
    "https://meet.google.com/abc-defg-hij",
)
ORG = os.environ.get("TEST_ORG_ID", "1003")


def req(method: str, url: str, headers: dict | None = None, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    h = {"Accept": "application/json", **(headers or {})}
    if body is not None:
        h["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(request, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode()
        try:
            payload = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            payload = {"raw": raw}
        return exc.code, payload


def main() -> int:
    if not SECRET:
        print("FAIL: CRM_SERVICE_JWT_SECRET not set")
        return 1

    token = jwt.encode(
        {
            "organization_id": ORG,
            "sub": "bot-join-test",
            "scopes": ["meetings:write"],
            "iat": int(time.time()),
        },
        SECRET,
        algorithm="HS256",
    )
    headers = {"Authorization": f"Bearer {token}"}

    status, ready = req("GET", f"{BASE}/readyz")
    print(f"readyz: status={status} body={json.dumps(ready)}")
    if status != 200 or ready.get("status") != "ok":
        print("FAIL: meeting-service not ready")
        return 1

    body = {
        "entity_type": "contact",
        "entity_id": "bot-join-test",
        "meeting_url": MEET_URL,
        "consent_captured": True,
    }
    status, created = req("POST", f"{BASE}/v1/meetings", headers=headers, body=body)
    print(f"create: status={status}")
    if status not in (200, 201):
        print(f"FAIL: could not create meeting: {json.dumps(created)}")
        return 1

    meeting_id = created["id"]
    print(f"meeting_id={meeting_id} initial_status={created.get('status')}")

    terminal = {"completed", "completed_partial", "failed", "active", "awaiting_admission", "joining"}
    last = created.get("status")
    for i in range(24):
        time.sleep(5)
        status, detail = req("GET", f"{BASE}/v1/meetings/{meeting_id}", headers=headers)
        if status != 200:
            print(f"poll {i}: GET failed status={status}")
            continue
        cur = detail.get("status")
        err = detail.get("error_code") or detail.get("error_message")
        print(f"poll {i}: status={cur} error={err or '-'}")
        last = cur
        if cur in terminal and cur not in {"joining", "queued", "dispatching"}:
            break

    ok_statuses = {"joining", "awaiting_admission", "active", "queued", "dispatching"}
    if last in ok_statuses:
        print(f"PASS: bot dispatch reached {last}")
        return 0

    print(f"FAIL: unexpected terminal status {last}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
