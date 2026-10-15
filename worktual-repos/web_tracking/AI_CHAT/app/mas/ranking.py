"""Ranking sort (most vs least) — Context Layer order_by is descending by default."""

from __future__ import annotations

from typing import Any

from app.mas.models import SemanticPlan

_ASC_WORDS = ("least", "lowest", "fewest", "bottom", "minimum", "min ")
_DESC_WORDS = ("most", "top", "highest", "best", "maximum", "max ")


def infer_sort_direction(*texts: str | None) -> str:
    """Return 'asc' or 'desc' from user wording (not full intent routing)."""
    blob = " ".join(t for t in texts if t).lower()
    if any(w in blob for w in _ASC_WORDS):
        return "asc"
    if any(w in blob for w in _DESC_WORDS):
        return "desc"
    return "desc"


def apply_sort_direction(plan: SemanticPlan, *, standalone: str, objective: str | None) -> SemanticPlan:
    direction = (plan.sort_direction or "").strip().lower()
    if direction not in ("asc", "desc"):
        direction = infer_sort_direction(standalone, objective or "")
    return plan.model_copy(update={"sort_direction": direction})


def semantic_limit_for_ranking(plan: SemanticPlan) -> int | None:
    """Fetch enough rows to compute least-popular when sort is ascending."""
    if not plan.group_by:
        return plan.limit
    base = plan.limit or 10
    if plan.sort_direction == "asc":
        return min(500, max(base, 50))
    return base


def sort_and_trim_table(
    columns: list[str],
    rows: list[list[Any]],
    plan: SemanticPlan,
) -> tuple[list[str], list[list[Any]]]:
    if not plan.group_by or not plan.metrics or len(rows) < 2:
        return columns, rows
    metric = plan.metrics[0]
    try:
        metric_idx = columns.index(metric)
    except ValueError:
        return columns, rows

    def sort_key(row: list[Any]) -> float:
        try:
            return float(row[metric_idx] or 0)
        except (TypeError, ValueError):
            return 0.0

    reverse = plan.sort_direction != "asc"
    sorted_rows = sorted(rows, key=sort_key, reverse=reverse)
    cap = plan.limit or 10
    return columns, sorted_rows[:cap]
