"""Validate semantic plans against ontology slice — no regex routing."""

from __future__ import annotations

from typing import Any

from app.mas.models import SemanticPlan
from app.mas.period_align import coerce_semantic_time
from app.mas.ranking import apply_sort_direction
from app.services.context_layer import OntologySlice
from shared.semantic_time import REALTIME_METRICS

_ALLOWED_OPS = frozenset({"eq", "in"})

_FILTER_DIM_ALIASES: dict[str, str] = {
    "product": "product_name",
    "product_title": "product_name",
    "productname": "product_name",
    "sku": "product_id",
}

_PRODUCT_FILTER_DIMS = frozenset(
    {
        "product_name",
        "product_id",
        "product_interactions__product_name",
        "product_interactions__product_id",
    }
)

_PRODUCT_GROUP_DIMS: tuple[str, ...] = (
    "product_name",
    "product_id",
    "product_interactions__product_name",
    "product_interactions__product_id",
)


class ValidationError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def validate_semantic_plan(
    plan: SemanticPlan,
    slice_data: OntologySlice,
    *,
    dashboard_period: str | None = None,
    standalone_query: str = "",
    domain_objective: str | None = None,
) -> SemanticPlan:
    plan = coerce_semantic_time(plan, dashboard_period=dashboard_period, apply_ranking_limit=True)
    plan = _normalize_filters(plan, slice_data)
    plan = _fix_product_group_by(plan, slice_data)
    plan = apply_sort_direction(plan, standalone=standalone_query, objective=domain_objective)

    if plan.error == "clarify" and plan.clarify_question:
        raise ValidationError(plan.clarify_question)
    if not plan.metrics:
        raise ValidationError("I need a clearer metric to answer that. Which measure do you want — visitors, sessions, or page views?")

    allow = slice_data.allowlist()
    for mid in plan.metrics:
        if mid not in allow:
            raise ValidationError(f"The metric '{mid}' is not certified for your account.")

    primary = plan.metrics[0]
    desc = slice_data.descriptor(primary)
    allowed_dims = set(desc.dims) if desc else set()

    group_by = [d for d in plan.group_by if d in allowed_dims]
    if plan.group_by and not group_by:
        raise ValidationError(
            f"I can't break down {primary} by '{plan.group_by[0]}'. "
            "Try asking for top products or page views from your certified catalog."
        )
    if group_by != plan.group_by:
        plan = plan.model_copy(update={"group_by": group_by})

    for f in plan.filters:
        dim = str(f.get("dimension") or "").strip()
        op = str(f.get("op") or "eq").lower()
        values = f.get("values")
        if dim not in allowed_dims:
            raise ValidationError(f"Filter dimension '{dim}' is not allowed for {primary}.")
        if op not in _ALLOWED_OPS:
            raise ValidationError("Filters must use op eq or in.")
        if not isinstance(values, list) or not values:
            raise ValidationError("Each filter needs a non-empty values array.")

    if plan.time and plan.time.get("start") and plan.time.get("end"):
        pass  # custom range — Context Layer validates

    if plan.limit is not None and not (1 <= plan.limit <= 500):
        raise ValidationError("Limit must be between 1 and 500.")

    if plan.group_by and len(plan.metrics) > 1:
        raise ValidationError("Please ask for one metric at a time when using a breakdown or ranking.")

    return plan


def _normalize_filters(plan: SemanticPlan, slice_data: OntologySlice) -> SemanticPlan:
    if not plan.metrics or not plan.filters:
        return plan
    primary = plan.metrics[0]
    desc = slice_data.descriptor(primary)
    allowed_dims = set(desc.dims) if desc else set()
    cleaned: list[dict[str, Any]] = []
    for raw in plan.filters:
        f = dict(raw)
        dim = str(f.get("dimension") or "").strip()
        if dim:
            dim = _FILTER_DIM_ALIASES.get(dim.lower(), dim)
        values = f.get("values")
        if not dim and isinstance(values, list) and values:
            if primary == "product_interaction_count":
                for candidate in _PRODUCT_FILTER_DIMS:
                    if candidate in allowed_dims:
                        dim = candidate
                        break
        if not dim:
            continue
        f["dimension"] = dim
        if "op" not in f:
            f["op"] = "eq"
        cleaned.append(f)
    if cleaned == plan.filters:
        return plan
    return plan.model_copy(update={"filters": cleaned})


def _fix_product_group_by(plan: SemanticPlan, slice_data: OntologySlice) -> SemanticPlan:
    if not plan.metrics:
        return plan
    primary = plan.metrics[0]
    if primary != "product_interaction_count" and "product" not in primary:
        return plan
    if plan.filters and any(
        str(f.get("dimension") or "").strip() in _PRODUCT_FILTER_DIMS for f in plan.filters
    ):
        return plan
    if plan.group_by:
        return plan
    desc = slice_data.descriptor(primary)
    allowed = set(desc.dims) if desc else set()
    for dim in _PRODUCT_GROUP_DIMS:
        if dim in allowed:
            updates: dict = {"group_by": [dim]}
            if plan.limit is None:
                updates["limit"] = 10
            if not plan.order_by:
                updates["order_by"] = [primary]
            return plan.model_copy(update=updates)
    return plan


def rows_to_table(
    raw_rows: list[dict[str, Any]], plan: SemanticPlan
) -> tuple[list[str], list[list[Any]]]:
    if not raw_rows:
        if plan.group_by:
            return [*plan.group_by, *plan.metrics], []
        if len(plan.metrics) == 1:
            return [plan.metrics[0]], [[0]]
        return ["metric", "value"], [[mid, 0] for mid in plan.metrics]

    if plan.group_by or len(raw_rows) > 1:
        keys: list[str] = []
        for row in raw_rows:
            for key in row:
                if key not in keys:
                    keys.append(key)
        table = [[row.get(key) for key in keys] for row in raw_rows]
        return keys, table

    first = raw_rows[0]
    if len(plan.metrics) == 1:
        mid = plan.metrics[0]
        return [mid], [[first.get(mid, next(iter(first.values()), None))]]
    return ["metric", "value"], [[mid, first.get(mid)] for mid in plan.metrics]
