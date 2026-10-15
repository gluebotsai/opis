#!/usr/bin/env python3
"""Regenerate sql_agent KPI templates from semantic templates (operational, no marts)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise SystemExit("PyYAML required") from exc

from sql_agent.ticketing_sql.enriched import operational_table, wrap_metric_sql
from sql_agent.validator import validate_readonly_sql


SOURCE = ROOT / "semantic" / "sql" / "metric_templates" / "ticketing.yml"
TARGET = ROOT / "sql_agent" / "kpi_templates" / "ticketing.yml"


def _transform_metric(metric_id: str, spec: dict) -> dict:
    sql = str(spec.get("sql") or "").strip()
    if not sql:
        raise ValueError(f"empty sql for {metric_id}")
    table = operational_table(str(spec.get("table") or ""))
    enriched_base = None
    raw_table = str(spec.get("table") or "")
    if raw_table == "mart_tickets":
        enriched_base = "tickets"
    elif raw_table == "mart_audit_events":
        enriched_base = "audit_events"
    elif raw_table.startswith("mart_"):
        enriched_base = operational_table(raw_table)

    out_sql = wrap_metric_sql(sql, enriched_base=enriched_base)
    if "ticketing_marts" in out_sql:
        raise ValueError(f"{metric_id} still references ticketing_marts")
    validate_readonly_sql(out_sql)

    out = dict(spec)
    out["product"] = "ticketing"
    out["sql"] = out_sql
    if table:
        out["table"] = table
    if enriched_base in ("tickets", "audit_events"):
        out["enriched_base"] = enriched_base
    elif enriched_base and enriched_base not in out:
        out.pop("enriched_base", None)
    return out


def main() -> int:
    if not SOURCE.is_file():
        print(f"Missing source: {SOURCE}", file=sys.stderr)
        return 1
    with SOURCE.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    metrics_in = dict(data.get("metrics") or {})
    metrics_out: dict = {}
    errors: list[str] = []
    for metric_id, spec in sorted(metrics_in.items()):
        try:
            metrics_out[metric_id] = _transform_metric(metric_id, dict(spec))
        except Exception as exc:
            errors.append(f"{metric_id}: {exc}")
    if errors:
        for err in errors:
            print(err, file=sys.stderr)
        return 1
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    with TARGET.open("w", encoding="utf-8") as fh:
        yaml.safe_dump({"metrics": metrics_out}, fh, sort_keys=False, width=120)
    from sql_agent.kpi_template_registry import clear_template_cache

    clear_template_cache()
    print(f"Regenerated {len(metrics_out)} metrics -> {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
