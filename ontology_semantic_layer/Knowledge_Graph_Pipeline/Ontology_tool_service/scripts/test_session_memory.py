#!/usr/bin/env python3
"""Multi-turn session memory test."""

import json
import urllib.request

BASE = "http://127.0.0.1:8000"
SESSION = "memory-test-session-002"
ORG = "1000"


def chat(query: str) -> str:
    payload = json.dumps(
        {"sessionID": SESSION, "query": query, "organization_id": ORG}
    ).encode()
    req = urllib.request.Request(
        f"{BASE}/chat",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=300) as resp:
        data = json.loads(resp.read().decode())
    return data.get("answer") or "(empty)"


def main():
    print("Session:", SESSION)
    print("\n--- Turn 1 ---")
    a1 = chat("Why did missed contacts increase last week on the support queue?")
    print(a1[:500])

    print("\n--- Turn 2 (memory test) ---")
    a2 = chat("What queue did you mention in your previous answer? Just name the queue.")
    print(a2)

    print("\n--- Turn 3 (memory test) ---")
    a3 = chat("What numbers did you give for missed contacts last week?")
    print(a3)

    ok2 = "support" in a2.lower()
    ok3 = any(x in a3 for x in ("30", "0", "-30", "twenty", "Thirty"))
    print("\n--- Results ---")
    print(f"Turn 2 recalls queue: {'PASS' if ok2 else 'FAIL'}")
    print(f"Turn 3 recalls numbers: {'PASS' if ok3 else 'FAIL'}")


if __name__ == "__main__":
    main()
