"""Context Layer semantic query — validated executor tool."""

from __future__ import annotations

from typing import Any

from app.mas.models import SemanticPlan
from app.mas.ranking import semantic_limit_for_ranking, sort_and_trim_table
from app.mas.validate import ValidationError, rows_to_table, validate_semantic_plan
from app.reports.facts import assemble_facts
from app.reports.models import ReportTask, TaskExecutionResult
from app.services.context_layer import ContextLayerError, context_layer


async def execute_semantic_plan(
    plan: SemanticPlan,
    *,
    task: ReportTask,
    website_id: int,
    organization_id: int,
    user_id: int,
    dashboard_period: str | None,
    standalone: str,
    slice_data,
    kpi_id: str | None = None,
) -> TaskExecutionResult:
    try:
        plan = validate_semantic_plan(
            plan,
            slice_data,
            dashboard_period=dashboard_period,
            standalone_query=standalone,
            domain_objective=task.goal,
        )
    except ValidationError as exc:
        return TaskExecutionResult(
            task_id=task.id,
            status="error",
            error_type="REPLAN",
            error=exc.message,
            facts=assemble_facts(
                task_goal=task.goal,
                kpi_id=kpi_id,
                answer_type=task.answer_type,
                group_by=plan.group_by or None,
                columns=[],
                rows=[],
                status="error",
                error_type="REPLAN",
                error=exc.message,
            ),
        )

    try:
        result = context_layer.query_semantic(
            organization_id=organization_id,
            user_id=user_id,
            website_id=website_id,
            metrics=plan.metrics,
            time=plan.time,
            group_by=plan.group_by or None,
            filters=plan.filters or None,
            order_by=plan.order_by or None,
            limit=semantic_limit_for_ranking(plan),
        )
    except ContextLayerError as exc:
        return TaskExecutionResult(
            task_id=task.id,
            status="error",
            error_type="REPLAN",
            error=str(exc),
            semantic_plan=plan.model_dump(),
            facts=assemble_facts(
                task_goal=task.goal,
                kpi_id=kpi_id or (plan.metrics[0] if plan.metrics else None),
                answer_type=task.answer_type,
                group_by=plan.group_by or None,
                columns=[],
                rows=[],
                status="error",
                error_type="REPLAN",
                error=str(exc),
            ),
        )

    columns, rows = rows_to_table(result.rows, plan)
    columns, rows = sort_and_trim_table(columns, rows, plan)
    metric = kpi_id or (plan.metrics[0] if plan.metrics else None)
    facts = assemble_facts(
        task_goal=task.goal,
        kpi_id=metric,
        answer_type=task.answer_type,
        group_by=plan.group_by or None,
        columns=columns,
        rows=rows,
    )
    return TaskExecutionResult(
        task_id=task.id,
        store="semantic",
        kpi_id=metric,
        columns=columns,
        rows=rows,
        sql_or_ref="semantic:" + ",".join(plan.metrics),
        facts=facts,
        semantic_plan=plan.model_dump(),
        context_layer_request=result.request_body,
        context_layer_response=result.response_payload,
    )
