"""Align semantic plans with dashboard pill and realtime metrics."""

from __future__ import annotations

from app.mas.models import SemanticPlan
from shared.semantic_time import (
    DEFAULT_RANKING_LIMIT,
    REALTIME_METRICS,
    normalize_semantic_period,
    semantic_period_from_dashboard_pill,
)


def align_plan_to_dashboard(
    plan: SemanticPlan,
    *,
    dashboard_period: str | None,
) -> SemanticPlan:
    return coerce_semantic_time(plan, dashboard_period=dashboard_period, apply_ranking_limit=True)


def coerce_semantic_time(
    plan: SemanticPlan,
    *,
    dashboard_period: str | None,
    apply_ranking_limit: bool = False,
) -> SemanticPlan:
    """Normalize or replace time.period; never leave realtime metrics with a window."""
    if not plan.metrics:
        return plan
    primary = plan.metrics[0]
    if primary in REALTIME_METRICS:
        plan = plan.model_copy(update={"time": None})
    else:
        pill_period = semantic_period_from_dashboard_pill(dashboard_period)
        raw = str(plan.time.get("period") or "") if plan.time else ""
        normalized = normalize_semantic_period(raw) if raw else None
        from shared.semantic_time import CONTEXT_LAYER_PERIODS

        chosen = normalized if normalized in CONTEXT_LAYER_PERIODS else None
        if not chosen and pill_period:
            chosen = pill_period
        if chosen:
            plan = plan.model_copy(update={"time": {"period": chosen}})
        else:
            plan = plan.model_copy(update={"time": None})

    if apply_ranking_limit and plan.group_by and plan.limit is None:
        plan = plan.model_copy(update={"limit": DEFAULT_RANKING_LIMIT})
    if apply_ranking_limit and plan.group_by and not plan.order_by and plan.metrics:
        plan = plan.model_copy(update={"order_by": [plan.metrics[0]]})
    return plan


def normalize_plan_time(plan: SemanticPlan) -> SemanticPlan:
    return coerce_semantic_time(plan, dashboard_period=None, apply_ranking_limit=False)
