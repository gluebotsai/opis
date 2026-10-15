"""Ticketing product SQL executor — operational tables + CDP joins."""

from __future__ import annotations

from dataclasses import replace
from typing import Any, Callable

from sql_agent.catalog_loader import get_table, load_product_catalog
from sql_agent.executors.generic import execute_job as _generic_execute
from sql_agent.job import ExecutorJob
from sql_agent.sql_filters import can_like_retry, rewrite_eq_filters_to_ilike
from sql_agent.ticketing_sql.builder import (
    build_ticketing_count_sql,
    build_ticketing_group_sql,
    build_ticketing_list_sql,
)


def execute_job(job: ExecutorJob) -> dict[str, Any]:
    if job.mode == "metric_fallback":
        from sql_agent.metric_fallback import execute_metric_fallback

        return execute_metric_fallback(job)
    if job.mode == "group_count":
        return _execute_group(job)
    if job.mode == "count_scalar":
        return _execute_count_scalar(job)
    if job.mode != "list":
        return _generic_execute(job)
    if job.product != "ticketing":
        return _generic_execute(job)
    return _execute_list(job)


def _route_base(job: ExecutorJob, *, table: str | None = None) -> ExecutorJob:
    cat = load_product_catalog("ticketing")
    use_table = table or job.table
    tbl = get_table("ticketing", use_table)
    return ExecutorJob(
        job_id=job.job_id,
        mode=job.mode,
        product=job.product,
        engine=job.engine,
        organization_id=job.organization_id,
        user_id=job.user_id,
        table=use_table,
        schema=str(tbl.get("schema") or cat.get("default_schema") or "ticketing"),
        select=job.select,
        filters=job.filters,
        order_by=job.order_by,
        limit=job.limit,
        scope=job.scope,
        visible_user_ids=job.visible_user_ids,
        my_queue_ids=job.my_queue_ids,
        row_scope_column=str(tbl.get("row_scope_column") or "") or None,
        caller_role=job.caller_role,
        scope_dual_assignee_resolver=job.scope_dual_assignee_resolver,
        group_by=list(job.group_by),
        entitled_channels=job.entitled_channels,
        channel_column="channel" if use_table == "tickets" else None,
        cdp_live=job.cdp_live,
        cdp_email=job.cdp_email,
        time_start=job.time_start,
        time_end=job.time_end,
        time_grain=job.time_grain,
        time_column=job.time_column,
        instruction=job.instruction,
    )


def _empty_result(result: dict[str, Any], *, count_mode: bool) -> bool:
    if count_mode:
        rows = result.get("rows") or []
        if not rows:
            return True
        return int(rows[0].get("row_count") or 0) == 0
    return not (result.get("rows") or [])


def _run_with_like_retry(
    job: ExecutorJob,
    builder: Callable[[ExecutorJob], tuple[str, list[object]]],
    *,
    count_mode: bool = False,
) -> dict[str, Any]:
    from sql_agent.db import run_postgres_query

    sql, params = builder(job)
    rows = run_postgres_query(sql, params, schema=job.schema, table=job.table)
    if count_mode:
        count = int(rows[0].get("row_count") or 0) if rows else 0
        result: dict[str, Any] = {
            "rows": [{"row_count": count}],
            "rowCount": 1,
            "value": count,
            "sql": sql,
            "table": job.table,
        }
    else:
        result = {"rows": rows, "rowCount": len(rows), "sql": sql, "table": job.table}

    if _empty_result(result, count_mode=count_mode) and can_like_retry(job.filters):
        retried = replace(job, filters=rewrite_eq_filters_to_ilike(job.filters))
        sql, params = builder(retried)
        rows = run_postgres_query(sql, params, schema=retried.schema, table=retried.table)
        if count_mode:
            count = int(rows[0].get("row_count") or 0) if rows else 0
            result = {
                "rows": [{"row_count": count}],
                "rowCount": 1,
                "value": count,
                "sql": sql,
                "table": retried.table,
                "like_retry": True,
            }
        else:
            result = {
                "rows": rows,
                "rowCount": len(rows),
                "sql": sql,
                "table": retried.table,
                "like_retry": True,
            }
    return result


def _execute_list(job: ExecutorJob) -> dict[str, Any]:
    routed = _route_base(job)
    return _run_with_like_retry(routed, build_ticketing_list_sql)


def _execute_count_scalar(job: ExecutorJob) -> dict[str, Any]:
    routed = _route_base(job, table=job.table or "tickets")
    return _run_with_like_retry(routed, build_ticketing_count_sql, count_mode=True)


def _execute_group(job: ExecutorJob) -> dict[str, Any]:
    routed = _route_base(job, table=job.table or "tickets")
    return _run_with_like_retry(routed, build_ticketing_group_sql)
