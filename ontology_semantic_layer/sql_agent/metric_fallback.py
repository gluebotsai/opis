"""Execute certified metrics via pre-approved SQL templates."""

from __future__ import annotations

from typing import Any

from sql_agent.errors import SqlAgentError
from sql_agent.kpi_policy import get_metric_policy
from sql_agent.job import ExecutorJob
from sql_agent.kpi_template_registry import get_template
from sql_agent.sql_filters import filter_clause
from sql_agent.time_window import bind_calendar_date, bounds_for_metric_alias, time_predicate_sql
from sql_agent.ticketing_scope import ticketing_row_scope_clause
from sql_agent.validator import validate_readonly_sql


def execute_metric_fallback(job: ExecutorJob) -> dict[str, Any]:
    if not job.metric_id:
        raise SqlAgentError(
            "metric_fallback requires metric_id",
            code="invalid_job",
        )
    spec = get_template(job.product, job.metric_id)
    if not spec:
        raise SqlAgentError(
            f"No SQL template for metric '{job.metric_id}' (product={job.product})",
            code="unknown_metric",
        )

    sql = str(spec.get("sql") or "").strip()
    if not sql:
        raise SqlAgentError(
            f"Empty template for metric '{job.metric_id}'",
            code="invalid_template",
        )

    if job.product == "ticketing":
        from sql_agent.ticketing_sql.enriched import wrap_metric_sql

        stripped = sql.lstrip()
        if not stripped.upper().startswith("WITH") and (
            spec.get("enriched_base") or "ticketing_marts" in sql
        ):
            enriched_base = spec.get("enriched_base")
            sql = wrap_metric_sql(
                sql, enriched_base=str(enriched_base) if enriched_base else None
            )

    time_col = str(
        spec.get("time_column")
        or job.time_column
        or "created_at"
    )
    if not job.time_start and not job.time_end:
        alias_start, alias_end = bounds_for_metric_alias(job.metric_id)
        if alias_start:
            job.time_start = alias_start
            job.time_end = alias_end
    extra_where, extra_params = _build_extra_where(job, time_col)
    sql = sql.replace("{{extra_where}}", extra_where)

    validate_readonly_sql(sql)

    per_slot: list[object] = [str(job.organization_id)] + extra_params
    org_slots = sql.count("organization_id = %s")
    params: list[object] = per_slot * org_slots if org_slots > 1 else per_slot
    if job.engine == "clickhouse":
        from sql_agent.db import run_clickhouse_query

        rows = run_clickhouse_query(
            sql, params, schema=job.schema, table=job.table
        )
    else:
        from sql_agent.db import run_postgres_query

        rows = run_postgres_query(
            sql, params, schema=job.schema, table=job.table
        )
    metric_col = spec.get("result_column") or job.metric_id
    out_rows: list[dict[str, Any]] = []
    for row in rows:
        val = row.get(metric_col, row.get("value"))
        out_rows.append({metric_col: val})
    pol = get_metric_policy(job.metric_id, product=job.product)
    if not out_rows and spec.get("default_zero"):
        out_rows = [{metric_col: 0}]
    elif (
        not out_rows
        and pol.get("kind") == "rate"
        and spec.get("default_zero")
    ):
        out_rows = [{metric_col: 0}]
    elif out_rows and out_rows[0].get(metric_col) is None and pol.get("kind") == "rate":
        out_rows[0][metric_col] = 0
    return {
        "rows": out_rows,
        "rowCount": len(out_rows),
        "sql": sql,
        "metricId": job.metric_id,
    }


def _build_extra_where(job: ExecutorJob, time_column: str) -> tuple[str, list[object]]:
    parts: list[str] = []
    params: list[object] = []
    if job.entitled_channels and job.channel_column:
        placeholders = ", ".join("%s" for _ in job.entitled_channels)
        parts.append(f"{job.channel_column} IN ({placeholders})")
        params.extend(job.entitled_channels)
    if job.scope in ("team", "assignee", "created_by"):
        frag, scope_params = ticketing_row_scope_clause(
            scope_mode=job.scope,
            visible_user_ids=job.visible_user_ids,
            row_scope_column=job.row_scope_column,
            role=str(job.caller_role or "agent"),
            dual_assignee_resolver=job.scope_dual_assignee_resolver,
            my_queue_ids=job.my_queue_ids,
        )
        if frag:
            parts.append(frag)
            params.extend(scope_params)
    time_start = job.time_start
    time_end = job.time_end
    prepared = job.prepared or {}
    time_spec = prepared.get("time") or {}
    if not time_start and time_spec.get("start"):
        time_start = str(time_spec["start"])
    if not time_end and time_spec.get("end"):
        time_end = str(time_spec["end"])
    if time_start and time_end:
        parts.append(time_predicate_sql(time_column))
        params.append(bind_calendar_date(time_start))
        params.append(bind_calendar_date(time_end))
    elif time_start:
        parts.append(f"{time_column} >= %s::date")
        params.append(bind_calendar_date(time_start))
    elif time_end:
        parts.append(f"{time_column} < (%s::date + interval '1 day')")
        params.append(bind_calendar_date(time_end))
    for flt in job.filters or []:
        frag, flt_params = filter_clause(flt)
        parts.append(frag)
        params.extend(flt_params)
    if not parts:
        return "", []
    return " AND " + " AND ".join(parts), params
