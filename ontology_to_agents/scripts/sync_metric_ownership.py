#!/usr/bin/env python3
"""Sync catalog prompt.metrics (specialists + headlines) and slice metric_ids (API entitlement)."""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import yaml
except ImportError:
    print("FAIL  PyYAML required")
    sys.exit(1)

from semantic.ownership import (
    clear_ownership_cache,
    compute_agent_entitlements,
    headline_metrics_for_agent,
    load_ownership,
)

PRESETS_DIR = ROOT / "ontology" / "presets"
SLICES_DIR = ROOT / "ontology" / "slices"


def _load_all_presets() -> dict[str, dict]:
    merged: dict[str, dict] = {}
    if PRESETS_DIR.is_dir():
        for path in sorted(PRESETS_DIR.glob("*.yml")):
            data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
            merged.update(data.get("presets") or {})
    return merged


def _replace_slice_metric_ids(content: str, metrics: list[str]) -> str:
    block = "metric_ids:\n" + "".join(f"- {m}\n" for m in metrics)
    if re.search(r"^metric_ids:\n", content, flags=re.M):
        return re.sub(
            r"^metric_ids:\n(?:- .+\n)*",
            block,
            content,
            count=1,
            flags=re.M,
        )
    return content.rstrip() + "\n" + block


def main() -> int:
    clear_ownership_cache()
    ownership = load_ownership()
    preserve = set(ownership.get("preserve_prompt_metrics") or [])
    never = set(ownership.get("never_assign") or [])
    entitlements = compute_agent_entitlements()

    presets = _load_all_presets()
    updated_catalog = 0
    if presets:
        print("  skip    preset prompt.metrics (sourced from agent_metrics.yml at runtime)")

    updated_slices = 0
    for agent_id, api_metrics in sorted(entitlements.items()):
        slice_path = SLICES_DIR / f"{agent_id}.yml"
        if not slice_path.is_file():
            continue
        text = slice_path.read_text(encoding="utf-8")
        data = yaml.safe_load(text) or {}
        current = data.get("metric_ids") or []
        if list(current) == api_metrics:
            print(f"  ok      slice {agent_id} ({len(api_metrics)} api metrics)")
            continue
        new_text = _replace_slice_metric_ids(text, api_metrics)
        slice_path.write_text(new_text, encoding="utf-8")
        updated_slices += 1
        print(f"  slice   {agent_id}: {len(current)} -> {len(api_metrics)} api metrics")

    print(f"\n{updated_catalog} catalog presets updated, {updated_slices} slices updated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
