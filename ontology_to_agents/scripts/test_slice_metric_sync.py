#!/usr/bin/env python3
"""CI gate: presets have no embedded metrics; grants drive runtime entitlements."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import yaml
except ImportError:
    print("FAIL  PyYAML required")
    sys.exit(1)

from semantic.ownership import clear_ownership_cache, compute_agent_entitlements


def main() -> int:
    clear_ownership_cache()
    failed = 0
    presets_dir = ROOT / "ontology" / "presets"
    if not presets_dir.is_dir():
        print("  FAIL  ontology/presets/ missing")
        return 1

    preset_count = 0
    for path in sorted(presets_dir.glob("*.yml")):
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for pid, spec in (data.get("presets") or {}).items():
            preset_count += 1
            metrics = list((spec.get("prompt") or {}).get("metrics") or [])
            if metrics:
                print(f"  FAIL  preset {pid} embeds prompt.metrics ({len(metrics)})")
                failed += 1

    if failed == 0:
        print(f"  OK    {preset_count} presets have empty prompt.metrics")

    entitlements = compute_agent_entitlements()
    if not entitlements:
        print("  FAIL  no agent entitlements from grants")
        failed += 1
    else:
        print(f"  OK    {len(entitlements)} agents entitled via agent_metrics.yml")

    slices_dir = ROOT / "ontology" / "slices"
    if slices_dir.is_dir():
        stale = sum(1 for _ in slices_dir.glob("*.yml"))
        print(f"  skip    {stale} ontology/slices/*.yml debug artifacts (not runtime)")

    print(f"\n{failed} failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
