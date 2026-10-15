"""Shared SQL executor for catalog-bound list + metric_fallback jobs."""

from __future__ import annotations

from typing import Any

from sql_agent.errors import SqlAgentError
from sql_agent.executors.base import build_list_sql
from sql_agent.job import ExecutorJob


def execute_job(job: ExecutorJob) -> dict[str, Any]:
    if job.mode == "list":
        return _execute_list(job)
    if job.mode == "metric_fallback":
        from sql_agent.metric_fallback import execute_metric_fallback

        return execute_metric_fallback(job)
    raise SqlAgentError(
        f"Unknown job mode: {job.mode}",
        code="invalid_job",
    )


def _execute_list(job: ExecutorJob) -> dict[str, Any]:
    sql, params = build_list_sql(job)
    if job.engine == "clickhouse":
        rows = _run_clickhouse(sql, params, job)
    else:
        rows = _run_postgres(sql, params, job)
    return {"rows": rows, "rowCount": len(rows), "sql": sql}


def _run_postgres(sql: str, params: list[object], job: ExecutorJob) -> list[dict[str, Any]]:
    from sql_agent.db import run_postgres_query

    return run_postgres_query(
        sql, params, schema=job.schema, table=job.table
    )


def _run_clickhouse(sql: str, params: list[object], job: ExecutorJob) -> list[dict[str, Any]]:
    from sql_agent.db import run_clickhouse_query

    return run_clickhouse_query(
        sql, params, schema=job.schema, table=job.table
    )
