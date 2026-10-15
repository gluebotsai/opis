#!/usr/bin/env python3
"""Validate ticketing KPI templates: 96 metrics, no marts, readonly SQL."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sql_agent.kpi_template_registry import list_templates
from sql_agent.validator import validate_readonly_sql


def main() -> int:
    metrics = list_templates("ticketing")
    if len(metrics) != 96:
        print(f"FAIL expected 96 metrics, got {len(metrics)}", file=sys.stderr)
        return 1
    errors: list[str] = []
    for metric_id, spec in sorted(metrics.items()):
        sql = str(spec.get("sql") or "")
        table = str(spec.get("table") or "")
        if "ticketing_marts" in sql or "ticketing_marts" in table:
            errors.append(f"{metric_id}: references ticketing_marts")
        if " mart_" in f" {table}" or table.startswith("mart_"):
            errors.append(f"{metric_id}: mart table name {table}")
        try:
            validate_readonly_sql(sql)
        except Exception as exc:
            errors.append(f"{metric_id}: invalid sql ({exc})")
        if not sql.strip():
            errors.append(f"{metric_id}: empty sql")
        if "ticketing." not in sql and "enriched" not in sql.lower():
            errors.append(f"{metric_id}: missing operational ticketing reference")
    if errors:
        for err in errors[:20]:
            print(err, file=sys.stderr)
        if len(errors) > 20:
            print(f"... and {len(errors) - 20} more", file=sys.stderr)
        return 1
    print(f"OK {len(metrics)} ticketing KPI templates (no marts)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
