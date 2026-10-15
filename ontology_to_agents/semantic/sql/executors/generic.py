"""Shared SQL executor for catalog-bound list + metric_fallback jobs."""

from __future__ import annotations

from typing import Any

from semantic.sql.executors.base import build_list_sql
from semantic.sql.job import ExecutorJob


def execute_job(job: ExecutorJob) -> dict[str, Any]:
    if job.mode == "list":
        return _execute_list(job)
    if job.mode == "metric_fallback":
        from semantic.sql.metric_fallback import execute_metric_fallback

        return execute_metric_fallback(job)
    raise ValueError(f"Unknown job mode: {job.mode}")


def _execute_list(job: ExecutorJob) -> dict[str, Any]:
    sql, params = build_list_sql(job)
    if job.engine == "clickhouse":
        rows = _run_clickhouse(sql, params)
    else:
        rows = _run_postgres(sql, params)
    return {"rows": rows, "rowCount": len(rows), "sql": sql}


def _run_postgres(sql: str, params: list[object]) -> list[dict[str, Any]]:
    from semantic.sql.db import run_postgres_query

    return run_postgres_query(sql, params)


def _run_clickhouse(sql: str, params: list[object]) -> list[dict[str, Any]]:
    from semantic.sql.db import run_clickhouse_query

    return run_clickhouse_query(sql, params)
