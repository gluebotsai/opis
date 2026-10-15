#!/usr/bin/env python3
"""Copy official rrweb 2.1.1 UMD build into vendor/ for SDK + dashboard.

Prefers a built clone at Github_session/rrweb-main (from https://github.com/rrweb-io/rrweb),
otherwise falls back to the npm package already installed under sdk/node_modules/rrweb.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "vendor" / "rrweb"
GITHUB_PKG = ROOT / "Github_session" / "rrweb-main" / "packages" / "rrweb"
NPM_PKG = ROOT / "sdk" / "node_modules" / "rrweb"
WEB_NPM_PKG = ROOT / "web" / "node_modules" / "rrweb"

FILES = (
    ("umd/rrweb.min.js", "rrweb.min.js"),
    ("umd/rrweb.js", "rrweb.js"),
    ("dist/style.css", "style.css"),
    ("dist/style.min.css", "style.min.css"),
)


def source_dir() -> Path:
    for candidate in (GITHUB_PKG, NPM_PKG, WEB_NPM_PKG):
        umd = candidate / "umd" / "rrweb.min.js"
        if umd.is_file():
            return candidate
    return WEB_NPM_PKG


def main() -> int:
    src_root = source_dir()
    umd = src_root / "umd" / "rrweb.min.js"
    if not umd.is_file():
        print(
            "ERROR: rrweb UMD not found.\n"
            "  Option A: cd sdk && npm install\n"
            "  Option B: clone https://github.com/rrweb-io/rrweb into Github_session/rrweb-main && yarn build:all",
            file=sys.stderr,
        )
        return 1

    VENDOR.mkdir(parents=True, exist_ok=True)
    copied = []
    for rel_src, dest_name in FILES:
        src = src_root / rel_src
        if not src.is_file():
            continue
        dest = VENDOR / dest_name
        shutil.copy2(src, dest)
        copied.append(dest_name)

    # Dashboard static assets
    for sub in ("web/public/vendor/rrweb", "demo/vendor/rrweb"):
        out = ROOT / sub
        out.mkdir(parents=True, exist_ok=True)
        for name in copied:
            shutil.copy2(VENDOR / name, out / name)

    rel_src = src_root.relative_to(ROOT) if src_root.is_relative_to(ROOT) else src_root
    print(f"rrweb vendor OK ({len(copied)} files) from {rel_src}")
    for name in copied:
        size = (VENDOR / name).stat().st_size
        print(f"  vendor/rrweb/{name} ({size // 1024} KiB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
