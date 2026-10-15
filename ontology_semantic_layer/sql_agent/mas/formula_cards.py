"""Compact formula cards for Gemma planner (instruction-first)."""

from __future__ import annotations

from sql_agent.mas.metric_validator import declared_filters_for

# High-traffic ticketing metrics shown in planner prompt
_TICKETING_CARD_IDS = (
    "open_tickets_metric",
    "ticket_volume",
    "high_priority_open_tickets_metric",
    "resolved_tickets_metric",
    "pending_tickets_metric",
    "closed_tickets_metric",
    "reopened_tickets_metric",
    "unassigned_tickets_metric",
    "tickets_created_by_me",
    "tickets_created_today_metric",
    "tickets_last_7_days",
    "tickets_last_30_days",
    "average_resolution_time_hours",
    "average_first_response_hours",
    "sla_breach_rate",
)


def formula_cards_for_product(product: str) -> list[dict[str, object]]:
    """Return compact cards: metric_id + declared filters (no SQL formulas)."""
    if product not in ("ticketing", "tk"):
        return []
    cards: list[dict[str, object]] = []
    for mid in _TICKETING_CARD_IDS:
        declared = declared_filters_for(mid)
        filt: dict[str, list[str]] = {}
        if declared is not None:
            for col, vals in declared.items():
                filt[col] = sorted(vals) if vals else []
        cards.append(
            {
                "metric_id": mid,
                "declared_filters": filt,
                "use_when": _use_when(mid, filt),
            }
        )
    return cards


def _use_when(metric_id: str, filt: dict[str, list[str]]) -> str:
    if metric_id == "tickets_created_by_me":
        return (
            "count of tickets the caller created/filed (created_by_id). "
            "Never ticket_volume + dataScope=mine — mine is assignee/resolver, not creator"
        )
    if metric_id == "ticket_volume":
        return (
            "total ticket count with NO status/priority filter; NOT 'created by me'. "
            "dataScope=mine means assigned to me, not created by me"
        )
    if not filt:
        return f"certified KPI '{metric_id}' when question matches the metric name"
    parts = [f"{k}={','.join(v)}" for k, v in sorted(filt.items()) if v]
    return "scalar KPI only when instruction filters match: " + "; ".join(parts)


def format_formula_cards_text(product: str) -> str:
    cards = formula_cards_for_product(product)
    if not cards:
        return ""
    lines = ["Certified metric formula cards (do not invent filters):"]
    for c in cards:
        lines.append(
            f"- {c['metric_id']}: filters={c['declared_filters']} — {c['use_when']}"
        )
    return "\n".join(lines)
