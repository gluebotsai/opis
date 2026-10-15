#!/usr/bin/env python3
"""POST one page_view to local ingest and verify wt:live:* on REDIS_URL.

Usage (from repo root, ingest running on :7860):
  python scripts/test_local_live_redis.py
  python scripts/test_local_live_redis.py --website-id 1011 --website-url 'https://booxoo.co.uk/'
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    path = ROOT / ".env"
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env


def redis_cli(env: dict[str, str], *args: str) -> str:
    url = env.get("REDIS_URL", "").strip()
    if not url:
        raise SystemExit("REDIS_URL missing in .env")
    parsed = urllib.parse.urlparse(url)
    password = urllib.parse.unquote(parsed.password or "")
    host = parsed.hostname or "127.0.0.1"
    port = str(parsed.port or 6379)
    cmd = ["redis-cli", "-h", host, "-p", port]
    if password:
        cmd += ["-a", password]
    cmd += list(args)
    proc = subprocess.run(cmd, capture_output=True, text=True)
    out = "\n".join(
        ln
        for ln in (proc.stdout + proc.stderr).splitlines()
        if "Warning" not in ln and "password" not in ln.lower()
    )
    return out.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--website-id", type=int, default=1011)
    parser.add_argument("--website-url", default="https://booxoo.co.uk/")
    parser.add_argument("--ingest", default="http://127.0.0.1:7860/v1/tracking/nfs-ingestions")
    args = parser.parse_args()

    env = load_env()
    now = int(time.time() * 1000)
    session_id = f"session_local_speed_{now}"
    visitor_id = f"visitor_local_speed_{now}"
    body = {
        "type": "events_v3",
        "websiteId": args.website_id,
        "websiteUrl": args.website_url,
        "visitorId": visitor_id,
        "sessionId": session_id,
        "sdkVersion": "3.0.0",
        "sentAt": now,
        "events": [
            {
                "eventId": f"evt_{now}",
                "name": "page_view",
                "ts": now,
                "props": {"path": "/local-redis-speed-test", "title": "Local Redis Speed Test"},
            }
        ],
    }

    print(f"PING Redis… {redis_cli(env, 'PING')}")
    t0 = time.time()
    req = urllib.request.Request(
        args.ingest,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"INGEST {resp.status} in {(time.time() - t0) * 1000:.0f}ms → {resp.read()[:200].decode()}")
    except urllib.error.HTTPError as exc:
        print(f"INGEST HTTP {exc.code}: {exc.read()[:400].decode()}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"INGEST failed: {exc}", file=sys.stderr)
        print("Is local ingest running?  python etl/run_ingest.py --no-reload", file=sys.stderr)
        return 1

    keys = redis_cli(env, "KEYS", f"wt:live:{args.website_id}:*")
    print("KEYS:")
    print(keys or "(empty)")
    hkey = f"wt:live:{args.website_id}:session:{session_id}"
    print("HASH", hkey)
    print(redis_cli(env, "HGETALL", hkey) or "(empty)")
    if session_id not in keys:
        print("FAIL — session key missing (check LIVE_PRESENCE_ENABLED / ingest logs)", file=sys.stderr)
        return 1
    print("OK — local ingest wrote Live Users Redis. Check dashboard presence_source=redis.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
