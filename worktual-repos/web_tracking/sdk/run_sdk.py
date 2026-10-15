#!/usr/bin/env python3
"""Serve SDK static files (webtracking.js, examples).

    python sdk/run_sdk.py

Port from root .env (SDK_PORT, default 7864).
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

SDK_DIR = Path(__file__).resolve().parent
ROOT = SDK_DIR.parent

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

if __name__ == "__main__":
    host = os.environ.get("SERVICE_HOST", "0.0.0.0")
    port = int(os.environ.get("SDK_PORT", "7864"))
    ingest_port = os.environ.get("INGEST_PORT", "7860")

    print(f"SDK static → http://{host}:{port}/dist/webtracking.min.js")
    print(f"Example page → http://{host}:{port}/examples/basic.html")
    print(f"Ingest endpoint (set in init): http://localhost:{ingest_port}/v1/tracking/collect")

    subprocess.run(
        [sys.executable, "-m", "http.server", str(port), "--bind", host],
        cwd=SDK_DIR,
        check=True,
    )
