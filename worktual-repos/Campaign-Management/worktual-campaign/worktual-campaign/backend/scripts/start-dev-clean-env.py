#!/usr/bin/env python3
"""Start backend npm run dev with .env values (override stale shell exports)."""
from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
LOG = Path("/tmp/campaign-backend.log")

DROP = {
    "SOCIAL_SERVICE_BASE_URL",
    "WHATSAPP_CHANNEL_CONFIG_ID",
    "SOCIAL_SERVICE_NGROK_SKIP",
    "DATABASE_URL",
    "CAMPAIGN_DATABASE_URL",
}


def load_dotenv(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        v = v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k] = v
    return out


def main() -> None:
    env = os.environ.copy()
    for k in DROP:
        env.pop(k, None)
    env.update(load_dotenv(ROOT / ".env"))

    print("SOCIAL=", env.get("SOCIAL_SERVICE_BASE_URL"))
    print("CHANNEL=", env.get("WHATSAPP_CHANNEL_CONFIG_ID"))
    print("NGROK_SKIP=", env.get("SOCIAL_SERVICE_NGROK_SKIP"))

    LOG.write_text("")
    log_f = open(LOG, "a")
    proc = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=str(ROOT),
        env=env,
        stdout=log_f,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    print("started_pid", proc.pid)

    for i in range(40):
        time.sleep(1)
        try:
            with urlopen("http://127.0.0.1:3001/health", timeout=2) as r:
                if r.status == 200:
                    print("UP")
                    return
        except Exception:
            print(f"wait_{i+1}")
    print("FAILED_TO_START")
    print(LOG.read_text()[-2000:])
    raise SystemExit(1)


if __name__ == "__main__":
    main()
