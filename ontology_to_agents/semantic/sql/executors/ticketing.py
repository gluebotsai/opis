"""Ticketing product SQL executor."""

from __future__ import annotations

import re
from typing import Any

from semantic.sql.catalog_loader import get_table, load_product_catalog
from semantic.sql.executors.base import build_list_sql
from semantic.sql.executors.generic import execute_job as _generic_execute
from semantic.sql.job import ExecutorJob

_NOTE_INTENT = re.compile(r"\b(note|comment|reply)\b", re.I)
_AUDIT_INTENT = re.compile(r"\b(audit|escalat|history)\b", re.I)

_TABLE_DEFAULTS: dict[str, list[str]] = {
    "mart_tickets": [
        "ticket_id",
        "status",
        "priority",
        "queue_name",
        "assignee_name",
        "created_at",
    ],
    "mart_ticket_notes": [
        "note_id",
        "ticket_id",
        "note_type",
        "created_at",
        "author_name",
    ],
    "mart_audit_events": [
        "audit_event_id",
        "ticket_id",
        "action",
        "queue_name",
        "created_at",
    ],
}


def _resolve_table(job: ExecutorJob) -> tuple[str, list[str]]:
    text = job.instruction or ""
    if _NOTE_INTENT.search(text):
        return "mart_ticket_notes", _TABLE_DEFAULTS["mart_ticket_notes"]
    if _AUDIT_INTENT.search(text):
        return "mart_audit_events", _TABLE_DEFAULTS["mart_audit_events"]
    return job.table, job.select or _TABLE_DEFAULTS["mart_tickets"]


def execute_job(job: ExecutorJob) -> dict[str, Any]:
    if job.mode == "metric_fallback":
        from semantic.sql.metric_fallback import execute_metric_fallback

        return execute_metric_fallback(job)
    if job.mode != "list":
        return _generic_execute(job)

    table, cols = _resolve_table(job)
    cat = load_product_catalog("ticketing")
    tbl = get_table("ticketing", table)
    routed = ExecutorJob(
        job_id=job.job_id,
        mode=job.mode,
        product=job.product,
        engine=job.engine,
        organization_id=job.organization_id,
        user_id=job.user_id,
        table=table,
        schema=str(tbl.get("schema") or cat.get("default_schema")),
        select=cols,
        filters=job.filters,
        order_by=job.order_by,
        limit=job.limit,
        scope=job.scope,
        visible_user_ids=job.visible_user_ids,
        row_scope_column=str(tbl.get("row_scope_column") or "") or None,
        entitled_channels=job.entitled_channels,
        channel_column=None,
        instruction=job.instruction,
    )
    sql, params = build_list_sql(routed)
    from semantic.sql.db import run_postgres_query

    rows = run_postgres_query(sql, params)
    return {"rows": rows, "rowCount": len(rows), "sql": sql, "table": table}
