#!/usr/bin/env python3
"""Generate mart SQL templates for ticketing metrics from semantic_layer.yml."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
SEMANTIC_YML = (
    ROOT
    / "semantic/dbt/ticketing/default/dbt/models/semantic_layer/semantic_layer.yml"
)
TEMPLATE_YML = ROOT / "semantic/sql/metric_templates/ticketing.yml"
SCHEMA = "ticketing_marts"
ORG_WHERE = "organization_id = %s{{extra_where}}"

MART_META: dict[str, tuple[str, str]] = {
    "mart_tickets": ("mart_tickets", "created_at"),
    "mart_ticket_notes": ("mart_ticket_notes", "created_at"),
    "mart_agent_queue_members": ("mart_agent_queue_members", "created_at"),
    "mart_audit_events": ("mart_audit_events", "created_at"),
    "mart_proactive_recommendations": ("mart_proactive_recommendations", "created_at"),
    "mart_proactive_approvals": ("mart_proactive_approvals", "created_at"),
    "mart_kb_articles": ("mart_kb_articles", "created_at"),
    "mart_macros": ("mart_macros", "created_at"),
    "mart_notifications": ("mart_notifications", "created_at"),
    "mart_outbound_emails": ("mart_outbound_emails", "created_at"),
    "mart_customers": ("mart_customers", "created_at"),
    "mart_users": ("mart_users", "created_at"),
    "mart_agent_queues": ("mart_agent_queues", "created_at"),
    "mart_proactive_audit": ("mart_proactive_audit", "created_at"),
}

RATE_METRICS = {
    "resolution_rate",
    "unassignment_rate",
    "assignment_rate",
    "sla_breach_rate",
    "first_response_sla_compliance_rate",
    "first_response_coverage_rate",
    "resolution_sla_compliance_rate",
    "csat_response_rate",
    "csat_promoter_rate",
    "csat_detractor_rate",
    "reopen_rate",
    "internal_note_ratio",
    "average_notes_per_ticket",
    "escalation_rate",
    "recommendation_acceptance_rate",
    "approval_rate",
}


def _normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip())


def _case_when_condition(expr: str) -> str | None:
    e = _normalize_ws(expr)
    if not e.lower().startswith("case when "):
        return None
    rest = e[10:]
    idx = rest.lower().find(" then ")
    if idx < 0:
        return None
    return rest[:idx].strip()


def measure_agg_sql(agg: str, expr: str) -> str:
    agg = agg.strip().lower()
    expr = _normalize_ws(expr)
    if agg == "count_distinct":
        return f"COUNT(DISTINCT {expr})::bigint"
    if agg == "sum":
        return f"SUM({expr})"
    if agg == "average":
        return f"AVG({expr})::float"
    if agg == "min":
        return f"MIN({expr})::float"
    if agg == "count":
        cond = _case_when_condition(expr)
        if cond:
            return f"COUNT(*) FILTER (WHERE {cond})::bigint"
        return f"COUNT({expr})::bigint"
    raise ValueError(f"unsupported agg {agg} for expr {expr}")


def load_semantic() -> tuple[dict[str, dict], dict[str, tuple[str, str, str]]]:
    data = yaml.safe_load(SEMANTIC_YML.read_text(encoding="utf-8"))
    metrics_by_name = {str(m["name"]): m for m in data.get("metrics") or []}
    measure_info: dict[str, tuple[str, str, str]] = {}
    for sm in data.get("semantic_models") or []:
        mobj = re.search(r"ref\('([^']+)'\)", str(sm.get("model") or ""))
        if not mobj:
            continue
        mart_ref = mobj.group(1)
        table, time_col = MART_META.get(mart_ref, (mart_ref, "created_at"))
        time_col = str((sm.get("defaults") or {}).get("agg_time_dimension") or time_col)
        fq_table = f"{SCHEMA}.{table}"
        for measure in sm.get("measures") or []:
            name = str(measure["name"])
            measure_info[name] = (
                fq_table,
                time_col,
                measure_agg_sql(str(measure["agg"]), str(measure["expr"])),
            )
    return metrics_by_name, measure_info


def _simple_parts(
    metric_name: str,
    metrics_by_name: dict[str, dict],
    measure_info: dict[str, tuple[str, str, str]],
) -> tuple[str, str, str, str] | None:
    m = metrics_by_name.get(metric_name) or {}
    if str(m.get("type")) != "simple":
        return None
    measure = str((m.get("type_params") or {}).get("measure") or "")
    if measure not in measure_info:
        return None
    fq_table, time_col, agg_sql = measure_info[measure]
    table = fq_table.split(".", 1)[-1]
    return fq_table, table, time_col, agg_sql


def _scalar_subquery(agg_sql: str, fq_table: str) -> str:
    return f"(SELECT {agg_sql} FROM {fq_table} WHERE {ORG_WHERE})"


def metric_sql(
    metric_name: str,
    metrics_by_name: dict[str, dict],
    measure_info: dict[str, tuple[str, str, str]],
    visiting: set[str] | None = None,
) -> tuple[str, str, str, bool]:
    if visiting is None:
        visiting = set()
    if metric_name in visiting:
        raise ValueError(f"cycle: {metric_name}")
    visiting = set(visiting) | {metric_name}

    m = metrics_by_name[metric_name]
    mtype = str(m.get("type") or "simple")
    params = m.get("type_params") or {}
    default_zero = metric_name in RATE_METRICS

    if mtype == "simple":
        parts = _simple_parts(metric_name, metrics_by_name, measure_info)
        if not parts:
            raise KeyError(metric_name)
        fq_table, table, time_col, agg_sql = parts
        if metric_name.endswith("_metric") or metric_name.endswith("_volume") or metric_name.endswith("_total"):
            default_zero = True
        sql = (
            f"SELECT {agg_sql} AS {metric_name}\n"
            f"FROM {fq_table}\n"
            f"WHERE {ORG_WHERE}"
        )
        return sql, table, time_col, default_zero

    if mtype == "ratio":
        num_name = str(params.get("numerator") or "")
        denom_name = str(params.get("denominator") or "")
        num_parts = _simple_parts(num_name, metrics_by_name, measure_info)
        denom_parts = _simple_parts(denom_name, metrics_by_name, measure_info)
        default_zero = True

        if num_parts and denom_parts:
            fq_num, num_table, num_time, num_agg = num_parts
            fq_denom, denom_table, denom_time, denom_agg = denom_parts
            table = num_table
            time_col = num_time
            if fq_num == fq_denom:
                sql = (
                    f"SELECT\n"
                    f"  ({num_agg})::float\n"
                    f"  / NULLIF(({denom_agg}), 0) AS {metric_name}\n"
                    f"FROM {fq_num}\n"
                    f"WHERE {ORG_WHERE}"
                )
                return sql, table, time_col, default_zero
            sql = (
                f"SELECT\n"
                f"  {_scalar_subquery(num_agg, fq_num)}::float\n"
                f"  / NULLIF({_scalar_subquery(denom_agg, fq_denom)}, 0)\n"
                f"  AS {metric_name}"
            )
            return sql, table, time_col, default_zero

        # fallback: nested ratio (rare)
        num_sql, num_table, num_time, _ = metric_sql(
            num_name, metrics_by_name, measure_info, visiting
        )
        denom_sql, _, _, _ = metric_sql(
            denom_name, metrics_by_name, measure_info, visiting
        )
        sql = (
            f"SELECT\n"
            f"  ({num_sql})::float\n"
            f"  / NULLIF(({denom_sql}), 0) AS {metric_name}"
        )
        return sql, num_table, num_time, default_zero

    if mtype == "derived":
        expr = _normalize_ws(str(params.get("expr") or ""))
        dep_names = [str(x.get("name")) for x in params.get("metrics") or []]
        table = "mart_tickets"
        time_col = "created_at"
        for dep in sorted(dep_names, key=len, reverse=True):
            dep_parts = _simple_parts(dep, metrics_by_name, measure_info)
            if dep_parts:
                fq_table, dep_table, dep_time, agg_sql = dep_parts
                table = dep_table
                time_col = dep_time
                expr = re.sub(rf"\b{dep}\b", _scalar_subquery(agg_sql, fq_table), expr)
            else:
                dep_sql, dep_table, dep_time, _ = metric_sql(
                    dep, metrics_by_name, measure_info, visiting
                )
                table = dep_table
                time_col = dep_time
                inner = dep_sql.replace("SELECT ", "", 1).split(f" AS {dep}", 1)[0].strip()
                expr = re.sub(rf"\b{dep}\b", f"({_scalar_subquery(inner, '')})", expr)
        sql = f"SELECT ({expr})::float AS {metric_name}"
        return sql, table, time_col, True

    raise ValueError(f"unsupported type {mtype} for {metric_name}")


def build_templates(
    metrics_by_name: dict[str, dict],
    measure_info: dict[str, tuple[str, str, str]],
    preserve: dict[str, Any],
) -> dict[str, Any]:
    out: dict[str, Any] = dict(preserve)
    for metric_name in sorted(metrics_by_name):
        if metric_name in preserve:
            continue
        sql, table, time_col, default_zero = metric_sql(
            metric_name, metrics_by_name, measure_info
        )
        entry: dict[str, Any] = {
            "product": "ticketing",
            "result_column": metric_name,
            "time_column": time_col,
            "table": table,
            "sql": sql + "\n",
        }
        if default_zero:
            entry["default_zero"] = True
        out[metric_name] = entry
    return out


HAND_TUNED = {
    "open_tickets_metric",
    "sla_breach_rate",
    "average_resolution_time_hours",
    "average_csat_score",
    "high_priority_ticket_volume",
    "reopen_rate",
    "ticket_volume",
    "resolution_rate",
    "sla_at_risk_tickets_metric",
    "unanswered_tickets_metric",
    "average_tickets_per_day",
}


def main() -> int:
    metrics_by_name, measure_info = load_semantic()
    existing = yaml.safe_load(TEMPLATE_YML.read_text(encoding="utf-8")) or {}
    preserve = {
        k: v
        for k, v in (existing.get("metrics") or {}).items()
        if k in HAND_TUNED
    }
    merged = build_templates(metrics_by_name, measure_info, preserve)
    TEMPLATE_YML.write_text(
        yaml.dump({"metrics": merged}, sort_keys=False, default_flow_style=False),
        encoding="utf-8",
    )
    bad = [
        k
        for k, v in merged.items()
        if "{{extra_where}}" not in str(v.get("sql") or "")
        and "%s" in str(v.get("sql") or "")
    ]
    print(f"templates: {len(merged)} total ({len(merged) - len(preserve)} new)")
    if bad:
        print("missing {{extra_where}}:", bad[:10])
        return 1
    missing = sorted(set(metrics_by_name) - set(merged))
    if missing:
        print("still missing:", missing)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
