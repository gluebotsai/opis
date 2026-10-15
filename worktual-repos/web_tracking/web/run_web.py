#!/usr/bin/env python3
"""Run the web dashboard (Vite) directly.

    python web/run_web.py

Port from root .env (WEB_PORT, default 7862).
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent
ROOT = WEB_DIR.parent

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
    port = int(os.environ.get("WEB_PORT", "7862"))
    if (WEB_DIR / "yarn.lock").exists():
        command = ["yarn", "dev"]
    else:
        vite = WEB_DIR / "node_modules" / "vite" / "bin" / "vite.js"
        if not vite.exists():
            print(f"Missing dependencies — run: cd web && yarn install  (or npm install)")
            sys.exit(1)
        command = ["node", str(vite), "--host", host, "--port", str(port)]

    api_port = os.environ.get("API_PORT", "7861")
    print(f"Dashboard → http://{host}:{port}")
    print(f"API proxy target: http://localhost:{api_port}")

    subprocess.run(command, cwd=WEB_DIR, check=True)
