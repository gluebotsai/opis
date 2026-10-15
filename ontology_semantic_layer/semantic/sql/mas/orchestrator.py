"""Execute SqlPlan — Gemma plan/execute + harness (never MetricFlow)."""

from __future__ import annotations

import re
import time
from typing import Any

from semantic.scope import lookup_user_scope, scope_summary
from semantic.sql.agent_policy import (
    _COUNT_INTENT,
    resolve_agent_policy,
)
from semantic.sql.job import SqlQueryRequest
from semantic.sql.mas.harness import constrained_to_executor_job, validate_constrained_job
from semantic.sql.mas.plan_schema import SqlPlan
from semantic.sql.mas.product_executor import build_constrained_job
from semantic.sql.router import normalize_product
from semantic.sql.super import (
    SqlAgentError,
    _dispatch,
    _execute_count_query,
    detect_kpi_only,
)

_WRITE_INTENT = re.compile(
    r"\b(insert|update|delete|drop|truncate|alter|create|merge|copy)\b",
    re.I,
)


def execute_plan(req: SqlQueryRequest, plan: SqlPlan) -> dict[str, Any]:
    t0 = time.perf_counter()
    if _WRITE_INTENT.search(req.instruction or ""):
        raise SqlAgentError("Write operations are not allowed on the SQL agent.")
    policy = resolve_agent_policy(
        organization_id=req.organization_id,
        user_id=req.user_id,
        origin_product=req.origin_product,
        origin_agent=req.origin_agent,
    )

    if policy.get("list_only") and plan.intent == "kpi":
        raise SqlAgentError(
            f"Agent '{req.origin_agent}' cannot run KPI queries. Route to reporting agent."
        )
    if policy.get("list_only") and (
        detect_kpi_only(req.instruction, policy)
        or _COUNT_INTENT.search(req.instruction or "")
    ):
        raise SqlAgentError(
            f"Agent '{req.origin_agent}' cannot run KPI queries. Route to reporting agent."
        )

    if plan.intent == "count" and plan.preset_id != "metric.certified":
        product = normalize_product(plan.product)
        from semantic.sql.agent_policy import PLAIN_COUNT

        return _execute_count_query(req, policy, product, PLAIN_COUNT)

    constrained = build_constrained_job(req, plan)
    validate_constrained_job(constrained, preset_id=plan.preset_id)
    job = constrained_to_executor_job(req, plan, constrained, policy)
    result = _dispatch(job)
    scope = lookup_user_scope(
        req.organization_id, req.user_id, product=req.origin_product
    )
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    source = (
        "metric_fallback"
        if job.mode == "metric_fallback"
        else "sql_list"
        if job.mode == "list"
        else "sql_count"
    )
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
    return out
