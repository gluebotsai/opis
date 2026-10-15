#!/usr/bin/env python3
"""Download pinned Shopify taxonomy release assets into ontology_steward/taxonomies/shopify/."""

from __future__ import annotations

import argparse
import gzip
import shutil
import sys
import urllib.request
from pathlib import Path

ASSETS = [
    "categories.en.json.gz",
    "attributes.en.json.gz",
    "attribute_values.en.json.gz",
    "integrations.all_mappings.en.json.gz",
]

BASE = "https://github.com/Shopify/product-taxonomy/releases/download"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default="v2026-08")
    args = parser.parse_args()

    dest = Path(__file__).resolve().parent.parent / "ontology_steward" / "taxonomies" / "shopify"
    dest.mkdir(parents=True, exist_ok=True)
    version_file = dest.parent / "VERSION"
    version_file.write_text(args.version.lstrip("v") + "\n", encoding="utf-8")

    for asset in ASSETS:
        url = f"{BASE}/{args.version}/{asset}"
        target = dest / asset
        print(f"Fetching {url}")
        try:
            with urllib.request.urlopen(url, timeout=120) as resp:
                data = resp.read()
            target.write_bytes(data)
            # validate gzip
            with gzip.open(target, "rt", encoding="utf-8") as fh:
                fh.read(1024)
            print(f"  -> {target}")
        except Exception as exc:
            print(f"  FAILED: {exc}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
