"""Execute SqlPlan — Gemma plan/execute + harness."""

from __future__ import annotations

import re
import time
from typing import Any

from sql_agent.user_scope import lookup_user_scope, scope_summary
from sql_agent.agent_policy import (
    _COUNT_INTENT,
    resolve_agent_policy,
)
from sql_agent.job import SqlQueryRequest
from sql_agent.mas.harness import constrained_to_executor_job, validate_constrained_job
from sql_agent.mas.plan_schema import SqlPlan
from sql_agent.mas.product_executor import build_constrained_job
from sql_agent.router import normalize_product
from sql_agent.errors import SqlAgentError
from sql_agent.super import (
    _dispatch,
    detect_kpi_only,
)

_WRITE_INTENT = re.compile(
    r"\b(insert|update|delete|drop|truncate|alter|create|merge|copy)\b",
    re.I,
)


def execute_plan(req: SqlQueryRequest, plan: SqlPlan) -> dict[str, Any]:
    t0 = time.perf_counter()
    if _WRITE_INTENT.search(req.instruction or ""):
        raise SqlAgentError(
            "Write operations are not allowed on the SQL agent.",
            code="write_denied",
        )
    policy = resolve_agent_policy(
        organization_id=req.organization_id,
        user_id=req.user_id,
        origin_product=req.origin_product,
        origin_agent=req.origin_agent,
    )

    if policy.get("list_only") and plan.intent == "kpi":
        raise SqlAgentError(
            f"Agent '{req.origin_agent}' cannot run KPI queries. Route to reporting agent.",
            code="kpi_not_allowed",
        )
    if policy.get("list_only") and (
        detect_kpi_only(req.instruction, policy)
        or _COUNT_INTENT.search(req.instruction or "")
    ):
        raise SqlAgentError(
            f"Agent '{req.origin_agent}' cannot run KPI queries. Route to reporting agent.",
            code="kpi_not_allowed",
        )

    from sql_agent.mas.intent_kinds import normalize_intent

    intent = normalize_intent(str(plan.intent), has_group_by=bool(plan.group_by))
    plan.intent = intent

    constrained = build_constrained_job(req, plan)
    harness_warnings = validate_constrained_job(constrained, preset_id=plan.preset_id)
    job, job_warnings = constrained_to_executor_job(req, plan, constrained, policy)
    result = _dispatch(job)
    scope = lookup_user_scope(
        req.organization_id, req.user_id, product=req.origin_product
    )
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    source = {
        "metric_fallback": "metric_fallback",
        "group_count": "sql_group",
        "list": "sql_list",
        "count_scalar": "sql_count_scalar",
    }.get(job.mode, "sql_count")
    out: dict[str, Any] = {
        "source": source,
        "products": [normalize_product(plan.product)],
        "rows": result.get("rows", []),
        "rowCount": result.get("rowCount", len(result.get("rows") or [])),
        "scope": scope_summary(scope),
        "sql": result.get("sql"),
        "organizationId": req.organization_id,
        "planner": plan.planner,
        "planId": plan.plan_id,
        "presetId": plan.preset_id,
        "latencyMs": elapsed_ms,
        "table": result.get("table") or job.table,
    }
    if job.metric_id:
        out["metrics"] = [job.metric_id]
    all_warnings = list(harness_warnings) + list(job_warnings)
    if all_warnings:
        out["_meta"] = {"warnings": all_warnings}
    return out
