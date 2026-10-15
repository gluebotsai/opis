"""CCaaS product SQL executor — multi-table intent routing."""

from __future__ import annotations

import re
from typing import Any

from sql_agent.catalog_loader import load_product_catalog
from sql_agent.executors.base import build_list_sql
from sql_agent.executors.generic import execute_job as _generic_execute
from sql_agent.job import ExecutorJob

_ASSIGNMENT_INTENT = re.compile(
    r"\b(assignment|aht|handle time|missed contact|offered)\b", re.I
)
_SLA_INTENT = re.compile(r"\b(sla|breach|breached)\b", re.I)
_TASK_INTENT = re.compile(r"\b(task|callback|follow.?up)\b", re.I)
_PRESENCE_INTENT = re.compile(r"\b(presence|occupancy|logged in)\b", re.I)

_TABLE_DEFAULTS: dict[str, list[str]] = {
    "mart_conversations": [
        "conversation_id",
        "channel",
        "status",
        "queue_name",
        "assigned_agent_name",
        "created_at",
    ],
    "mart_conversation_assignments": [
        "assignment_id",
        "conversation_id",
        "channel",
        "queue_name",
        "agent_name",
        "offered_at",
        "state",
    ],
    "mart_conversation_sla_state": [
        "sla_state_id",
        "conversation_id",
        "channel",
        "queue_name",
        "priority",
        "breached_at",
        "updated_at",
    ],
    "mart_agent_tasks": [
        "task_id",
        "channel",
        "status",
        "priority",
        "task_type",
        "created_at",
    ],
    "mart_agent_presence_history": [
        "presence_event_id",
        "agent_id",
        "new_state",
        "started_at",
        "is_handling_or_wrap",
    ],
}


def resolve_table_and_columns(job: ExecutorJob) -> tuple[str, list[str]]:
    instruction = job.instruction or ""
    if _PRESENCE_INTENT.search(instruction):
        return "mart_agent_presence_history", _TABLE_DEFAULTS["mart_agent_presence_history"]
    if _TASK_INTENT.search(instruction):
        return "mart_agent_tasks", _TABLE_DEFAULTS["mart_agent_tasks"]
    if _SLA_INTENT.search(instruction):
        return "mart_conversation_sla_state", _TABLE_DEFAULTS["mart_conversation_sla_state"]
    if _ASSIGNMENT_INTENT.search(instruction):
        return "mart_conversation_assignments", _TABLE_DEFAULTS["mart_conversation_assignments"]
    return job.table, job.select or _TABLE_DEFAULTS.get(
        job.table, _TABLE_DEFAULTS["mart_conversations"]
    )


def execute_job(job: ExecutorJob) -> dict[str, Any]:
    if job.mode == "metric_fallback":
        from sql_agent.metric_fallback import execute_metric_fallback

        return execute_metric_fallback(job)
    if job.mode != "list":
        return _generic_execute(job)

    table, cols = resolve_table_and_columns(job)
    cat = load_product_catalog("ccaas")
    from sql_agent.catalog_loader import get_table

    tbl = get_table("ccaas", table)
    routed = ExecutorJob(
        job_id=job.job_id,
        mode=job.mode,
        product=job.product,
        engine=job.engine,
        organization_id=job.organization_id,
        user_id=job.user_id,
        table=table,
        schema=str(tbl.get("schema") or cat.get("default_schema")),
        select=cols if cols != ["*"] else job.select,
        filters=job.filters,
        order_by=job.order_by,
        limit=job.limit,
        scope=job.scope if table != "mart_conversation_sla_state" else "org",
        visible_user_ids=job.visible_user_ids,
        row_scope_column=str(tbl.get("row_scope_column") or "") or None,
        entitled_channels=job.entitled_channels,
        channel_column="channel" if table != "mart_agent_presence_history" else None,
        instruction=job.instruction,
    )
    sql, params = build_list_sql(routed)
    from sql_agent.db import run_postgres_query

    rows = run_postgres_query(sql, params)
    return {"rows": rows, "rowCount": len(rows), "sql": sql, "table": table}
