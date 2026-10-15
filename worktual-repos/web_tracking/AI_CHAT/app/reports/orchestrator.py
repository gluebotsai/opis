"""Reports domain turn — plan → execute tasks → synthesize (ticketing flow)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

from app.mas.format_answer import (
    enrich_answer_with_table,
    format_ranking_answer,
    format_scalar_answer,
    format_table_intro,
    format_traffic_sources_intro,
    period_hint_for_answer,
)
from app.reports.traffic_sources import is_traffic_sources_query
from app.mas.models import SemanticPlan
from app.reports.grounding import ground_check
from app.reports.layers import run_domain_plan, run_domain_synthesis, run_semantic_executor_tool
from app.reports.models import DomainPlan, ReportTask, SemanticToolCall, TaskExecutionResult
from app.reports.product_query import try_named_product_visit_plan
from app.reports.traffic_sources import try_traffic_sources_plan
from app.reports.run_kpi import run_kpi_task
from app.reports.run_semantic import execute_semantic_plan
from app.reports.time_resolve import resolve_task_time
from app.services.context_layer import OntologySlice

logger = logging.getLogger(__name__)

MAX_PLAN_ATTEMPTS = 2


@dataclass
class ReportsTurnResult:
    answer: str
    columns: list[str] = field(default_factory=list)
    rows: list[list[Any]] = field(default_factory=list)
    data_source: str = "semantic"
    sql_or_ref: str | None = None
    domain_plan: dict[str, Any] | None = None
    task_results: list[dict[str, Any]] = field(default_factory=list)
    combined_facts: str = ""
    clarify_question: str | None = None
    primary_metric: str | None = None
    semantic_plan: dict[str, Any] | None = None
    context_layer_request: dict[str, Any] | None = None
    context_layer_response: dict[str, Any] | None = None


def _should_run_kpi_direct(task: ReportTask) -> bool:
    return bool(
        task.kpi
        and task.answer_type == "kpi"
        and task.kpi != "product_interaction_count"
    )


async def _execute_task(
    task: ReportTask,
    *,
    website_id: int,
    organization_id: int,
    user_id: int,
    dashboard_period: str | None,
    standalone: str,
    slice_data: OntologySlice,
) -> TaskExecutionResult:
    traffic_plan = try_traffic_sources_plan(
        standalone,
        task.goal,
        slice_data=slice_data,
        dashboard_period=dashboard_period,
        task_time=task.time,
    )
    if traffic_plan is not None:
        return await execute_semantic_plan(
            traffic_plan,
            task=task,
            website_id=website_id,
            organization_id=organization_id,
            user_id=user_id,
            dashboard_period=dashboard_period,
            standalone=standalone,
            slice_data=slice_data,
            kpi_id=traffic_plan.metrics[0] if traffic_plan.metrics else None,
        )

    named_plan = try_named_product_visit_plan(
        standalone,
        task.goal,
        dashboard_period=dashboard_period,
        task_time=task.time,
    )
    if named_plan is not None:
        return await execute_semantic_plan(
            named_plan,
            task=task,
            website_id=website_id,
            organization_id=organization_id,
            user_id=user_id,
            dashboard_period=dashboard_period,
            standalone=standalone,
            slice_data=slice_data,
            kpi_id="product_interaction_count",
        )

    if _should_run_kpi_direct(task):
        return await run_kpi_task(
            task,
            kpi_id=task.kpi or "",
            website_id=website_id,
            organization_id=organization_id,
            user_id=user_id,
            dashboard_period=dashboard_period,
            standalone=standalone,
            slice_data=slice_data,
        )

    tool: SemanticToolCall
    if task.kpi and task.answer_type == "kpi":
        tool = SemanticToolCall(tool="run_kpi", kpi=task.kpi)
    else:
        tool = await run_semantic_executor_tool(
            task_goal=task.goal,
            task=task.model_dump(),
            slice_data=slice_data,
        )

    if tool.error_type:
        return TaskExecutionResult(
            task_id=task.id,
            status="error",
            error_type=tool.error_type,
            error=tool.error or "executor error",
            facts=f"EXECUTION_ERROR\nerror_type: {tool.error_type}\nmessage: {tool.error}\ntask_goal: {task.goal}",
        )

    if tool.tool == "run_kpi" and tool.kpi:
        return await run_kpi_task(
            task,
            kpi_id=tool.kpi,
            website_id=website_id,
            organization_id=organization_id,
            user_id=user_id,
            dashboard_period=dashboard_period,
            standalone=standalone,
            slice_data=slice_data,
        )

    plan = tool.to_semantic_plan()
    if not plan.metrics and task.kpi:
        plan = plan.model_copy(update={"metrics": [task.kpi]})
    if not plan.time:
        from app.reports.catalog import is_realtime_kpi

        rt = task.kpi and is_realtime_kpi(task.kpi)
        plan = plan.model_copy(
            update={
                "time": resolve_task_time(
                    task.time,
                    dashboard_period=dashboard_period,
                    realtime=bool(rt),
                )
            }
        )
    return await execute_semantic_plan(
        plan,
        task=task,
        website_id=website_id,
        organization_id=organization_id,
        user_id=user_id,
        dashboard_period=dashboard_period,
        standalone=standalone,
        slice_data=slice_data,
        kpi_id=task.kpi,
    )


def _draft_answer_from_last_task(
    result: TaskExecutionResult,
    *,
    standalone: str,
    dashboard_period: str | None,
    plan: SemanticPlan | None,
) -> str:
    if not result.columns:
        if result.status == "error":
            if result.error:
                return f"I couldn't run that query: {result.error}"
            return "I couldn't run that query. Try narrowing the time range or rephrasing."
        return "No data matched that question for the selected period."

    primary = result.kpi_id or (result.columns[0] if len(result.columns) == 1 else result.columns[-1])
    period_hint = period_hint_for_answer(
        primary or "",
        dashboard_period=dashboard_period,
        time=plan.time if plan else None,
    )
    sp = plan
    if sp and sp.group_by and result.rows and len(result.columns) > 1:
        return format_ranking_answer(
            result.columns,
            result.rows,
            metric_id=primary or sp.metrics[0],
            period_hint=period_hint,
            sort_direction=sp.sort_direction,
        )
    if len(result.rows) == 1 and len(result.columns) == 1:
        from app.reports.product_query import extract_product_name

        pname = extract_product_name(standalone)
        if pname and result.kpi_id == "product_interaction_count":
            from app.mas.format_answer import format_product_visit_answer

            return format_product_visit_answer(
                pname,
                result.rows[0][0],
                period_hint=period_hint,
            )
        return format_scalar_answer(result.columns[0], result.rows[0][0], period_hint=period_hint)
    return format_table_intro(result.columns, len(result.rows))


async def run_reports_turn(
    *,
    standalone: str,
    objective: str,
    domain: str,
    website_id: int,
    organization_id: int,
    user_id: int,
    dashboard_period: str | None,
    slice_data: OntologySlice,
) -> ReportsTurnResult:
    replan_msg: str | None = None
    domain_plan: DomainPlan | None = None
    task_results: list[TaskExecutionResult] = []

    for attempt in range(MAX_PLAN_ATTEMPTS):
        domain_plan = await run_domain_plan(
            standalone=standalone,
            objective=objective,
            domain=domain,
            dashboard_period=dashboard_period,
            slice_data=slice_data,
            replan_message=replan_msg,
        )
        if domain_plan.clarify_question and not domain_plan.tasks:
            return ReportsTurnResult(
                answer="",
                clarify_question=domain_plan.clarify_question,
                domain_plan=domain_plan.model_dump(),
            )
        if not domain_plan.tasks:
            atype: str = "kpi"
            if domain == "ranking":
                atype = "ranking"
            elif domain == "breakdown":
                atype = "breakdown"
            domain_plan = DomainPlan(
                depth="quick",
                tasks=[
                    ReportTask(
                        id="t1",
                        goal=objective or standalone,
                        time=dashboard_period or "overall",
                        answer_type=atype,  # type: ignore[arg-type]
                    )
                ],
            )

        task_results = []
        failed: TaskExecutionResult | None = None
        for task in domain_plan.tasks[:4]:
            exec_result = await _execute_task(
                task,
                website_id=website_id,
                organization_id=organization_id,
                user_id=user_id,
                dashboard_period=dashboard_period,
                standalone=standalone,
                slice_data=slice_data,
            )
            task_results.append(exec_result)
            if exec_result.status == "error" and exec_result.error_type == "REPLAN":
                failed = exec_result
                break

        if failed is None:
            break
        replan_msg = json_replan(failed)
        if attempt + 1 >= MAX_PLAN_ATTEMPTS:
            break

    assert domain_plan is not None
    combined_facts = "\n\n".join(r.facts for r in task_results if r.facts)
    last = task_results[-1] if task_results else TaskExecutionResult(task_id="t1")

    sem_plan_dict = last.semantic_plan
    sem_plan = SemanticPlan.model_validate(sem_plan_dict) if sem_plan_dict else None
    draft = _draft_answer_from_last_task(
        last,
        standalone=standalone,
        dashboard_period=dashboard_period,
        plan=sem_plan,
    )
    if is_traffic_sources_query(standalone, objective) and last.columns and last.rows:
        primary = last.kpi_id or (sem_plan.metrics[0] if sem_plan and sem_plan.metrics else "")
        period_hint = period_hint_for_answer(
            primary,
            dashboard_period=dashboard_period,
            time=sem_plan.time if sem_plan else None,
        )
        draft = format_traffic_sources_intro(len(last.rows), period_hint=period_hint)
        draft = enrich_answer_with_table(draft, last.columns, last.rows)

    use_synthesis = (
        domain_plan.depth in ("standard", "deep")
        or len(task_results) > 1
        or os.environ.get("AI_CHAT_REPORTS_SYNTHESIS", "").strip() in ("1", "true", "yes")
    )
    answer = draft
    if use_synthesis and combined_facts and "EXECUTION_ERROR" not in combined_facts:
        answer = await run_domain_synthesis(
            standalone=standalone,
            depth=domain_plan.depth,
            combined_facts=combined_facts,
            draft_answer=draft,
        )
        check = ground_check(answer, combined_facts)
        if not check.grounded and check.ungrounded:
            logger.warning("Ungrounded figures in synthesis: %s", check.ungrounded)
            answer = draft

    data_source = last.store if last.store else "semantic"
    return ReportsTurnResult(
        answer=answer,
        columns=last.columns,
        rows=last.rows,
        data_source=data_source,
        sql_or_ref=last.sql_or_ref,
        domain_plan=domain_plan.model_dump(),
        task_results=[r.model_dump() for r in task_results],
        combined_facts=combined_facts,
        primary_metric=last.kpi_id,
        semantic_plan=last.semantic_plan,
        context_layer_request=last.context_layer_request,
        context_layer_response=last.context_layer_response,
    )


def json_replan(failed: TaskExecutionResult) -> str:
    import json

    return json.dumps(
        {
            "error_type": failed.error_type,
            "error": failed.error,
            "task_id": failed.task_id,
        },
        ensure_ascii=False,
    )
