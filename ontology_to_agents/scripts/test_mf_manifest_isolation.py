#!/usr/bin/env python3
"""CI: each product MetricFlow manifest must not include other products' marts."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DBT = ROOT / "semantic" / "dbt"

_FOREIGN_MARTS: dict[str, tuple[str, ...]] = {
    "ticketing": ("mart_conversations", "mart_deals", "mart_campaign_overview"),
    "ccaas": ("mart_tickets", "mart_deals", "mart_campaign_overview"),
    "crm": ("mart_tickets", "mart_conversations", "mart_campaign_overview"),
    "campaign": ("mart_tickets", "mart_conversations", "mart_deals"),
}

_OWN_MARTS: dict[str, str] = {
    "ticketing": "mart_tickets",
    "ccaas": "mart_conversations",
    "crm": "mart_deals",
    "campaign": "mart_campaign_overview",
}


def _model_names(manifest: dict) -> set[str]:
    out: set[str] = set()
    for node in (manifest.get("nodes") or {}).values():
        if node.get("resource_type") != "model":
            continue
        name = str(node.get("name") or "")
        if name:
            out.add(name)
    return out


def main() -> int:
    failed = 0
    for product, foreign in _FOREIGN_MARTS.items():
        path = DBT / product / "default" / "dbt" / "target" / "manifest.json"
        if not path.is_file():
            print(f"  FAIL  missing {path}")
            failed += 1
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        names = _model_names(data)
        own = _OWN_MARTS[product]
        if own not in names:
            print(f"  FAIL  {product} missing own mart {own}")
            failed += 1
        leaked = [m for m in foreign if m in names]
        n_models = len(names)
        if leaked:
            print(f"  FAIL  {product} includes other-product marts: {leaked} (models={n_models})")
            failed += 1
        else:
            print(f"  OK    {product} isolated (models={n_models}, has {own})")
        if n_models > 80:
            print(f"  FAIL  {product} still looks like mega warehouse ({n_models} models)")
            failed += 1
    print(f"\n{failed} failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
