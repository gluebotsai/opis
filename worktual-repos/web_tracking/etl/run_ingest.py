#!/usr/bin/env python3
"""Single entry point for ingest — direct mode or gateway mode (auto from .env).

    python etl/run_ingest.py

Modes (automatic):
  - No INGEST_UPSTREAM_URL  → real ingest on INGEST_PORT (local dev, direct SDK)
  - INGEST_UPSTREAM_URL set → gateway on INGEST_PORT, forwards upstream
  - Upstream is localhost   → also starts internal ingest on INGEST_INTERNAL_PORT

Examples (.env):
  # Local direct
  INGEST_PORT=7860

  # Production (direct ingest — visitor IP from SDK getip.worktual.co.uk)
  INGEST_PORT=7860

  # Dev server → ngrok → laptop ingest (gateway only on server)
  INGEST_UPSTREAM_URL=https://YOUR-NGROK.ngrok-free.dev/v1/tracking/collect
"""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

ETL_DIR = Path(__file__).resolve().parent
ROOT = ETL_DIR.parent

sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ETL_DIR))
os.chdir(ETL_DIR)

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv is not None:
    load_dotenv(ROOT / ".env")
elif (ROOT / ".env").exists():
    for line in (ROOT / ".env").read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


def _is_local_upstream(url: str) -> bool:
    host = (urlparse(url).hostname or "").lower()
    return host in {"127.0.0.1", "localhost", "::1"}


def _run_uvicorn(app_path: str, host: str, port: int, *, reload: bool = False) -> None:
    import uvicorn

    uvicorn.run(app_path, host=host, port=port, reload=reload)


def _spawn_internal_ingest(host: str, port: int) -> subprocess.Popen:
    env = os.environ.copy()
    env["INGEST_UPSTREAM_URL"] = ""
    env["INGEST_PORT"] = str(port)
    proc = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "--internal"],
        env=env,
        cwd=str(ETL_DIR),
    )
    time.sleep(1.5)
    return proc


def main() -> int:
    host = os.environ.get("SERVICE_HOST", "0.0.0.0")
    public_port = _env_int("INGEST_PORT", 7860)
    internal_port = _env_int("INGEST_INTERNAL_PORT", 7865)
    upstream = os.environ.get("INGEST_UPSTREAM_URL", "").strip()
    internal_only = "--internal" in sys.argv

    if internal_only or not upstream:
        port = internal_port if internal_only else public_port
        print(f"Ingest (direct) → http://{host}:{port}/v1/tracking/collect")
        redis_on = bool(os.environ.get("REDIS_URL", "").strip())
        print(f"Live Redis: {'enabled' if redis_on else 'disabled (set REDIS_URL in .env)'}")
        _run_uvicorn("ingest.app:app", host, port, reload=not internal_only)
        return 0

    child: subprocess.Popen | None = None
    if _is_local_upstream(upstream):
        print(f"Ingest (internal) → http://{host}:{internal_port}/v1/tracking/collect")
        child = _spawn_internal_ingest(host, internal_port)

    print(f"Ingest (gateway) → http://{host}:{public_port}/v1/tracking/nfs-ingestions")
    print(f"  forwards to → {upstream}")
    try:
        _run_uvicorn("ingest.app:gateway_app", host, public_port, reload=False)
    finally:
        if child is not None and child.poll() is None:
            child.terminate()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
