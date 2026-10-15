#!/usr/bin/env python3
"""Validate SQL agent presets against compiled warehouse catalogs."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit("PyYAML required") from exc


def _table_columns(compiled: dict[str, Any], table: str) -> set[str]:
    for tbl in compiled.get("tables") or []:
        if tbl.get("name") == table:
            cols: set[str] = set()
            for c in tbl.get("columns") or []:
                if isinstance(c, dict):
                    cols.add(str(c.get("name")))
                else:
                    cols.add(str(c))
            return cols
    return set()


def validate_product(product: str) -> list[dict[str, Any]]:
    from sql_agent.compiled_catalog import load_compiled_catalog
    from sql_agent.presets.loader import load_preset, list_preset_ids

    compiled = load_compiled_catalog(product)
    issues: list[dict[str, Any]] = []
    for preset_id in list_preset_ids(product=product):
        spec = load_preset(preset_id)
        if preset_id == "metric.certified":
            continue
        tables = list(spec.get("tables") or [])
        default_table = str(spec.get("default_table") or "")
        if default_table and default_table not in tables:
            issues.append(
                {
                    "preset": preset_id,
                    "issue": "default_table_not_in_tables",
                    "table": default_table,
                }
            )
        for table in tables:
            cols = _table_columns(compiled, table)
            if not cols:
                issues.append(
                    {"preset": preset_id, "issue": "unknown_table", "table": table}
                )
        for col in spec.get("default_select") or []:
            if default_table:
                cols = _table_columns(compiled, default_table)
                if cols and col not in cols:
                    issues.append(
                        {
                            "preset": preset_id,
                            "issue": "unknown_column",
                            "table": default_table,
                            "column": col,
                        }
                    )
    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate SQL presets vs compiled catalogs")
    parser.add_argument(
        "--product",
        action="append",
        choices=["ticketing", "ccaas", "crm", "campaign", "webtracking"],
    )
    args = parser.parse_args()
    products = args.product or ["ticketing", "ccaas", "crm", "campaign", "webtracking"]
    all_issues: dict[str, list[dict[str, Any]]] = {}
    for product in products:
        all_issues[product] = validate_product(product)
        n = len(all_issues[product])
        print(f"{product}: {n} issue(s)")
        for issue in all_issues[product][:20]:
            print(f"  - {issue}")
    total = sum(len(v) for v in all_issues.values())
    return 1 if total else 0


if __name__ == "__main__":
    raise SystemExit(main())
