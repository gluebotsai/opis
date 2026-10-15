"""Certified KPI execution — ClickHouse (dashboard parity) or semantic fallback."""

from __future__ import annotations

from typing import Any

from app.mas.dashboard_parity import fetch_dashboard_kpi, uses_dashboard_parity
from app.reports.catalog import is_realtime_kpi, kpi_store
from app.reports.models import ReportTask, TaskExecutionResult
from app.reports.time_resolve import resolve_task_time
from app.services.context_layer import OntologySlice


async def run_kpi_task(
    task: ReportTask,
    *,
    kpi_id: str,
    website_id: int,
    organization_id: int,
    user_id: int,
    dashboard_period: str | None,
    standalone: str,
    slice_data: OntologySlice,
) -> TaskExecutionResult:
    store = kpi_store(kpi_id)
    realtime = is_realtime_kpi(kpi_id) or kpi_id == "online_visitors"

    if store == "clickhouse" and uses_dashboard_parity(kpi_id, dashboard_period=dashboard_period):
        parity = await fetch_dashboard_kpi(
            kpi_id,
            website_id=website_id,
            question=standalone,
            dashboard_period=dashboard_period,
        )
        if parity:
            columns, rows, sql_ref = parity
            from app.reports.facts import assemble_facts

            facts = assemble_facts(
                task_goal=task.goal,
                kpi_id=kpi_id,
                answer_type=task.answer_type,
                group_by=None,
                columns=columns,
                rows=rows,
            )
            return TaskExecutionResult(
                task_id=task.id,
                store="clickhouse",
                kpi_id=kpi_id,
                columns=columns,
                rows=rows,
                sql_or_ref=sql_ref,
                facts=facts,
            )

    # Semantic path for product KPIs or when ClickHouse parity unavailable
    from app.reports.run_semantic import execute_semantic_plan
    from app.mas.models import SemanticPlan

    time = resolve_task_time(task.time, dashboard_period=dashboard_period, realtime=realtime)
    plan = SemanticPlan(metrics=[kpi_id], time=time)
    return await execute_semantic_plan(
        plan,
        task=task,
        website_id=website_id,
        organization_id=organization_id,
        user_id=user_id,
        dashboard_period=dashboard_period,
        standalone=standalone,
        slice_data=slice_data,
        kpi_id=kpi_id,
    )
