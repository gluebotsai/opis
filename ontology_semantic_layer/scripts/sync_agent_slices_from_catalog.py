#!/usr/bin/env python3
"""Sync ontology/slices/*.yml metric_ids from agent_metrics.yml (debug artifacts only)."""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print("FAIL  PyYAML required")
    sys.exit(1)

ROOT = Path(__file__).resolve().parents[1]
SLICES_DIR = ROOT / "ontology" / "slices"


def _load_catalog() -> dict[str, list[str]]:
    data = yaml.safe_load((ROOT / "ontology" / "catalog.yml").read_text(encoding="utf-8")) or {}
    presets = data.get("presets") or {}
    out: dict[str, list[str]] = {}
    for agent_id, val in presets.items():
        if not isinstance(val, dict):
            continue
        if not (agent_id.startswith("cc.") or agent_id.startswith("tk.")):
            continue
        metrics = (val.get("prompt") or {}).get("metrics")
        if metrics is None:
            continue
        out[agent_id] = list(metrics)
    return out


def _replace_metric_ids(content: str, metrics: list[str]) -> str:
    block = "metric_ids:\n" + "".join(f"- {m}\n" for m in metrics)
    if re.search(r"^metric_ids:\n", content, flags=re.M):
        return re.sub(
            r"^metric_ids:\n(?:- .+\n)*",
            block,
            content,
            count=1,
            flags=re.M,
        )
    if "note:" in content:
        return content.replace("note:", f"{block}note:", 1)
    return content.rstrip() + "\n" + block


def main() -> int:
    catalog = _load_catalog()
    updated = 0
    missing_slice = []
    for agent_id, metrics in sorted(catalog.items()):
        path = SLICES_DIR / f"{agent_id}.yml"
        if not path.is_file():
            missing_slice.append(agent_id)
            continue
        text = path.read_text(encoding="utf-8")
        new_text = _replace_metric_ids(text, metrics)
        if new_text != text:
            path.write_text(new_text, encoding="utf-8")
            updated += 1
            print(f"  sync  {agent_id} ({len(metrics)} metrics)")
        else:
            print(f"  ok    {agent_id} ({len(metrics)} metrics)")
    if missing_slice:
        print("\nMissing slice files:", ", ".join(missing_slice))
    print(f"\n{updated} updated, {len(catalog) - updated} unchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
