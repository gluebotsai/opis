#!/usr/bin/env python3
"""Build rrweb UMD from local GitHub clone and vendor into the project.

Clone (if needed):
  git clone https://github.com/rrweb-io/rrweb.git Github_session/rrweb-main

Usage:
  python scripts/build_rrweb_from_github.py
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RRWEB = ROOT / "Github_session" / "rrweb-main"


def run(cmd: list[str], **kwargs) -> None:
    print("+", " ".join(cmd))
    subprocess.run(cmd, check=True, **kwargs)


def main() -> int:
    if not RRWEB.is_dir():
        print(
            f"Missing clone: {RRWEB}\n"
            "  git clone https://github.com/rrweb-io/rrweb.git Github_session/rrweb-main",
            file=sys.stderr,
        )
        return 1

    env = os.environ.copy()
    env["PUPPETEER_SKIP_DOWNLOAD"] = "1"
    env["PUPPETEER_SKIP_CHROMIUM_DOWNLOAD"] = "1"
    env.setdefault("NODE_OPTIONS", "--max-old-space-size=4096")

    node_modules = RRWEB / "node_modules"
    if not node_modules.is_dir():
        print("Installing rrweb monorepo (skipping Puppeteer Chrome download)…")
        run(["yarn", "install"], cwd=RRWEB, env=env)

    umd = RRWEB / "packages" / "rrweb" / "umd" / "rrweb.min.js"
    if not umd.is_file():
        print("Building rrweb package (turbo prepublish)…")
        # Full build; browser-client may fail without .git — rrweb package still builds.
        try:
            run(["yarn", "build:all"], cwd=RRWEB, env=env)
        except subprocess.CalledProcessError:
            print("Note: some optional packages failed; checking rrweb UMD…")

    if not umd.is_file():
        print("Building packages/rrweb only…", file=sys.stderr)
        run(["yarn", "workspace", "rrweb", "prepublish"], cwd=RRWEB, env=env)

    if not umd.is_file():
        print(f"ERROR: {umd} not found after build", file=sys.stderr)
        return 1

    run([sys.executable, str(ROOT / "scripts" / "vendor_rrweb.py")], cwd=ROOT)
    run([sys.executable, str(ROOT / "scripts" / "build_sdk.py")], cwd=ROOT)
    print(f"\nDone. rrweb UMD from GitHub clone → vendor/rrweb/rrweb.min.js")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
