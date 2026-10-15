#!/usr/bin/env python3
"""Generate SQL templates + metric catalog for all CCaaS metrics from semantic_layer.yml."""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
SEMANTIC_YML = (
    ROOT
    / "semantic/dbt/ccaas/default/dbt/models/semantic_layer/semantic_layer.yml"
)
TEMPLATE_YML = ROOT / "semantic/sql/metric_templates/ccaas.yml"
METRICS_YML = ROOT / "semantic/metrics/ccaas.yml"
MAP_DOC = ROOT / "docs/CCAAS_METRIC_AGENT_MAP.md"
SCHEMA = "ccass_marts_aiccaas"
ORG_WHERE = "organization_id = %s{{extra_where}}"

MART_META: dict[str, tuple[str, str]] = {
    "mart_conversations": ("mart_conversations", "created_at"),
    "mart_conversation_assignments": ("mart_conversation_assignments", "offered_at"),
    "mart_conversation_sla_state": ("mart_conversation_sla_state", "updated_at"),
    "mart_conversation_dispositions": ("mart_conversation_dispositions", "applied_at"),
    "mart_conversation_transfers": ("mart_conversation_transfers", "created_at"),
    "mart_agents": ("mart_agents", "created_at"),
    "mart_agent_tasks": ("mart_agent_tasks", "created_at"),
    "mart_agent_capacity": ("mart_agent_capacity", "updated_at"),
    "mart_agent_presence_history": ("mart_agent_presence_history", "started_at"),
    "mart_dispositions": ("mart_dispositions", "created_at"),
    "mart_copilot_turns": ("mart_copilot_turns", "created_at"),
    "mart_copilot_skill_executions": ("mart_copilot_skill_executions", "created_at"),
    "mart_setup_users": ("mart_setup_users", "created_at"),
    "mart_setup_ccaas_queues": ("mart_setup_ccaas_queues", "created_at"),
    "mart_setup_ccaas_queue_agents": ("mart_setup_ccaas_queue_agents", "created_at"),
    "mart_setup_teams": ("mart_setup_teams", "created_at"),
}

# MetricFlow filter → SQL on mart columns (channel normalized to voice in staging).
METRIC_SQL_FILTERS: dict[str, str] = {
    "webchat_volume": "lower(channel) = 'webchat'",
    "call_volume": "lower(channel) = 'voice'",
    "chat_volume": "lower(channel) != 'voice'",
    "email_volume": "lower(channel) = 'email'",
    "instagram_volume": "lower(channel) = 'instagram'",
    "whatsapp_volume": "lower(channel) = 'whatsapp'",
    "facebook_volume": "lower(channel) = 'facebook'",
    "social_media_volume": "lower(channel) IN ('whatsapp', 'instagram', 'facebook')",
    "open_conversations": "is_open = true",
    "active_agents": "lower(status) = 'active'",
    "active_agents_setup": "lower(status) = 'active'",
    "open_agent_tasks": "lower(status) = 'open'",
    "callback_tasks": "lower(task_type) = 'callback'",
    "follow_up_tasks": "lower(task_type) = 'follow_up'",
    "suggestion_tasks": "lower(task_type) = 'suggestion'",
    "agents_assigned_callback": "lower(task_type) = 'callback'",
    "handoff_conversations": "had_handoff = true",
    "ai_only_completed_conversations": "is_ai_only_completed = true",
    "resolved_dispositions": "lower(resolution_code) = 'resolved'",
    "missed_assignments": "lower(state) IN ('rejected', 'expired')",
    "tool_executions_total": "lower(execution_status) IN ('succeeded', 'failed', 'cancelled')",
    "tool_executions_succeeded": "lower(execution_status) = 'succeeded'",
    "agent_assist_accepted_or_modified": "suggestion_disposition IN ('accepted', 'modified')",
    "agent_assist_modified": "suggestion_disposition = 'modified'",
    "handling_or_wrap_seconds": "is_handling_or_wrap = true",
    "logged_in_eligible_seconds": "is_logged_in_eligible = true",
}

SOURCE_TABLE: dict[str, str] = {
    "mart_conversations": "ccass.conversations",
    "mart_conversation_assignments": "ccass.conversation_assignments",
    "mart_conversation_sla_state": "ccass.conversation_sla_state",
    "mart_conversation_dispositions": "ccass.conversation_dispositions",
    "mart_conversation_transfers": "ccass.conversation_transfers",
    "mart_agents": "ccass.agents",
    "mart_agent_tasks": "ccass.agent_tasks",
    "mart_agent_capacity": "ccass.agent_capacity",
    "mart_agent_presence_history": "ccass.agent_presence_history",
    "mart_dispositions": "ccass.dispositions",
    "mart_copilot_turns": "ccass.copilot_turns",
    "mart_copilot_skill_executions": "ccass.copilot_skill_executions",
    "mart_setup_users": "accounts.setup_users",
    "mart_setup_ccaas_queues": "accounts.setup_ccaas_queues",
    "mart_setup_ccaas_queue_agents": "accounts.setup_ccaas_queue_agents",
    "mart_setup_teams": "accounts.setup_teams",
}

RATE_METRICS = {
    "sla_breach_rate",
    "missed_contact_rate",
    "resolution_rate",
    "handover_rate",
    "ai_handover_rate",
    "ai_containment_rate",
    "human_agent_occupancy_rate_capacity",
    "human_agent_occupancy_rate_presence",
    "tool_success_rate",
    "agent_assist_adoption_rate",
    "agent_assist_modification_rate",
}

HAND_TUNED = {
    "total_conversations",
    "open_conversations",
    "ai_containment_rate",
    "average_handle_time",
    "sla_breach_rate",
    "agent_assist_modification_rate",
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


def _extra_filter(metric_name: str) -> str:
    flt = METRIC_SQL_FILTERS.get(metric_name)
    if not flt:
        return ""
    return f" AND {flt}"


def _scalar_subquery(agg_sql: str, fq_table: str, extra: str = "") -> str:
    return f"(SELECT {agg_sql} FROM {fq_table} WHERE {ORG_WHERE}{extra})"


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
    extra = _extra_filter(metric_name)

    if mtype == "simple":
        parts = _simple_parts(metric_name, metrics_by_name, measure_info)
        if not parts:
            raise KeyError(metric_name)
        fq_table, table, time_col, agg_sql = parts
        if metric_name.endswith("_metric") or metric_name.endswith("_volume") or metric_name.endswith("_count"):
            default_zero = True
        sql = (
            f"SELECT {agg_sql} AS {metric_name}\n"
            f"FROM {fq_table}\n"
            f"WHERE {ORG_WHERE}{extra}"
        )
        return sql, table, time_col, default_zero

    if mtype == "ratio":
        num_name = str(params.get("numerator") or "")
        denom_name = str(params.get("denominator") or "")
        num_parts = _simple_parts(num_name, metrics_by_name, measure_info)
        denom_parts = _simple_parts(denom_name, metrics_by_name, measure_info)
        default_zero = True
        num_extra = _extra_filter(num_name)
        denom_extra = _extra_filter(denom_name)

        if num_parts and denom_parts:
            fq_num, num_table, num_time, num_agg = num_parts
            fq_denom, _, _, denom_agg = denom_parts
            table = num_table
            time_col = num_time
            if fq_num == fq_denom:
                sql = (
                    f"SELECT\n"
                    f"  ({num_agg})::float\n"
                    f"  / NULLIF(({denom_agg}), 0) AS {metric_name}\n"
                    f"FROM {fq_num}\n"
                    f"WHERE {ORG_WHERE}{num_extra}"
                )
                return sql, table, time_col, default_zero
            sql = (
                f"SELECT\n"
                f"  {_scalar_subquery(num_agg, fq_num, num_extra)}::float\n"
                f"  / NULLIF({_scalar_subquery(denom_agg, fq_denom, denom_extra)}, 0)\n"
                f"  AS {metric_name}"
            )
            return sql, table, time_col, default_zero

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
        table = "mart_conversation_assignments"
        time_col = "offered_at"
        for dep in sorted(dep_names, key=len, reverse=True):
            dep_parts = _simple_parts(dep, metrics_by_name, measure_info)
            dep_extra = _extra_filter(dep)
            if dep_parts:
                fq_table, dep_table, dep_time, agg_sql = dep_parts
                table = dep_table
                time_col = dep_time
                expr = re.sub(
                    rf"\b{dep}\b",
                    _scalar_subquery(agg_sql, fq_table, dep_extra),
                    expr,
                )
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
        try:
            sql, table, time_col, default_zero = metric_sql(
                metric_name, metrics_by_name, measure_info
            )
        except (KeyError, ValueError) as exc:
            print(f"skip {metric_name}: {exc}")
            continue
        entry: dict[str, Any] = {
            "product": "ccaas",
            "result_column": metric_name,
            "time_column": time_col,
            "table": table,
            "sql": sql + "\n",
        }
        if default_zero:
            entry["default_zero"] = True
        out[metric_name] = entry
    return out


def write_agent_map(metrics: dict[str, Any], metric_names: list[str]) -> None:
    from semantic.ownership import specialist_agents_for_metric

    lines = [
        "# CCaaS metric → agent workflow map",
        "",
        f"Total certified metrics: **{len(metric_names)}**",
        "",
        "| metric | mart | source table | specialists | channel_scoped |",
        "|--------|------|--------------|-------------|----------------|",
    ]
    channel_marts = {"mart_conversations", "mart_conversation_assignments", "mart_conversation_sla_state"}
    for mid in metric_names:
        meta = metrics.get(mid) or {}
        table = str(meta.get("table") or "")
        src = SOURCE_TABLE.get(table, "?")
        specs = ", ".join(specialist_agents_for_metric(mid, "aiccaas")) or "reporting only"
        ch = "yes" if table in channel_marts else "no"
        lines.append(f"| `{mid}` | `{table}` | `{src}` | {specs} | {ch} |")
    lines.extend(
        [
            "",
            "## Reporting agent",
            "",
            "`cc.reporting` and `cc.reporting_mas` grant **all metrics** (`metrics: *`).",
            "",
            "## Headlines (LLM prompt only)",
            "",
            "See `ontology/metric_ownership.yml` → `headline_metrics.cc.reporting`.",
        ]
    )
    MAP_DOC.parent.mkdir(parents=True, exist_ok=True)
    MAP_DOC.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    metrics_by_name, measure_info = load_semantic()
    existing = {}
    if TEMPLATE_YML.is_file():
        existing = yaml.safe_load(TEMPLATE_YML.read_text(encoding="utf-8")) or {}
    preserve = {k: v for k, v in (existing.get("metrics") or {}).items() if k in HAND_TUNED}
    merged = build_templates(metrics_by_name, measure_info, preserve)
    payload = {"metrics": merged}
    yaml_text = yaml.dump(payload, sort_keys=False, default_flow_style=False)
    TEMPLATE_YML.write_text(
        "# Auto-generated + hand-tuned entries. Regenerate: scripts/expand_ccaas_sql_templates.py\n"
        + yaml_text,
        encoding="utf-8",
    )
    METRICS_YML.write_text(yaml_text, encoding="utf-8")
    write_agent_map(merged, sorted(metrics_by_name))
    print(f"templates: {len(merged)} metrics")
    print(f"wrote {TEMPLATE_YML}")
    print(f"wrote {METRICS_YML}")
    print(f"wrote {MAP_DOC}")
    missing = sorted(set(metrics_by_name) - set(merged))
    if missing:
        print("missing templates:", missing)
        return 1
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(ROOT))
    sys.exit(main())
