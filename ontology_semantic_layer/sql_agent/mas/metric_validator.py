"""Harness-side metric filter match validator (anti-hallucination)."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


# Code-owned declared filter sets — does not change certified SQL formulas.
# Values are lowercase canonical forms.
_DECLARED_FILTERS: dict[str, dict[str, frozenset[str]]] = {
    "open_tickets_metric": {"status": frozenset({"open"})},
    "active_tickets_metric": {},
    "high_priority_open_tickets_metric": {
        "status": frozenset({"open"}),
        "priority": frozenset({"high"}),
    },
    "high_priority_ticket_volume": {"priority": frozenset({"high", "urgent"})},
    "ticket_volume": {},
    "tickets_created_by_me": {},
    "resolved_tickets_metric": {"status": frozenset({"resolved"})},
    "pending_tickets_metric": {},
    "closed_tickets_metric": {"status": frozenset({"closed"})},
    "unassigned_tickets_metric": {},
    "reopened_tickets_metric": {"status": frozenset({"reopened"})},
    "tickets_created_today_metric": {},
    "tickets_last_7_days": {},
    "tickets_last_30_days": {},
}

_WINDOW_METRICS = {
    "today": "tickets_created_today_metric",
    "last_7d": "tickets_last_7_days",
    "last_30d": "tickets_last_30_days",
}

_CATCHALL_METRICS = frozenset(
    {
        "ticket_volume",
        "active_tickets_metric",
        "pending_tickets_metric",
        "unassigned_tickets_metric",
        "tickets_created_by_me",
        "tickets_created_today_metric",
        "tickets_last_7_days",
        "tickets_last_30_days",
    }
)


@dataclass
class ExtractedFilters:
    """Deterministic filters inferred from instruction text."""

    by_column: dict[str, set[str]] = field(default_factory=dict)

    def as_plan_filters(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for col, vals in sorted(self.by_column.items()):
            ordered = sorted(vals)
            if len(ordered) == 1:
                out.append({"column": col, "op": "eq", "values": ordered})
            else:
                out.append({"column": col, "op": "in", "values": ordered})
        return out


def extract_instruction_filters(instruction: str | None) -> ExtractedFilters:
    text = (instruction or "").lower()
    found = ExtractedFilters()

    status_map = {
        r"\bopen\b": "open",
        r"\bpending\b": "pending",
        r"\bin[\s-]?progress\b": "pending",
        r"\bresolved\b": "resolved",
        r"\bclosed\b": "closed",
        r"\breopened\b": "reopened",
        r"\boverdue\b": "overdue",
        r"\bon[_\s-]?hold\b": "on_hold",
    }
    for pat, val in status_map.items():
        if re.search(pat, text):
            # Avoid matching "open" inside "how many open tickets" as only status — that's intentional
            found.by_column.setdefault("status", set()).add(val)

    # Priority: high-only when "high priority"; urgent when urgent mentioned
    if re.search(r"\bhigh[\s-]?priority\b|\bpriority\s+high\b|\bp1\b", text):
        found.by_column.setdefault("priority", set()).add("high")
    if re.search(r"\burgent\b|\bp0\b", text):
        found.by_column.setdefault("priority", set()).add("urgent")
    if re.search(r"\bmedium[\s-]?priority\b|\bp2\b", text):
        found.by_column.setdefault("priority", set()).add("medium")
    if re.search(r"\blow[\s-]?priority\b|\bp3\b", text):
        found.by_column.setdefault("priority", set()).add("low")

    # Queue name: "in <name> queue" / "billing queue"
    m = re.search(r"\bin\s+([a-z0-9_ -]+?)\s+queue\b", text)
    if m:
        found.by_column.setdefault("queue_name", set()).add(m.group(1).strip())
    m2 = re.search(r"\b([a-z0-9_]+)\s+queue\b", text)
    if m2 and "queue_name" not in found.by_column:
        q = m2.group(1).strip()
        if q not in ("the", "a", "my", "our", "by"):
            found.by_column.setdefault("queue_name", set()).add(q)

    return found


def declared_filters_for(metric_id: str) -> dict[str, frozenset[str]] | None:
    """Return declared filter map, or None if metric has no entry (unknown)."""
    if metric_id in _DECLARED_FILTERS:
        return dict(_DECLARED_FILTERS[metric_id])
    return None


@dataclass
class MetricValidationResult:
    ok: bool
    reason: str = ""
    guard_action: str = "none"  # none | metric_rejected_filter_mismatch
    fallback_filters: list[dict[str, Any]] = field(default_factory=list)


def validate_metric_against_instruction(
    metric_id: str,
    instruction: str | None,
) -> MetricValidationResult:
    """Reject when instruction filters don't match metric's declared filter set."""
    extracted = extract_instruction_filters(instruction)
    declared = declared_filters_for(metric_id)

    if declared is None:
        # Unknown metric declarations: reject if instruction has any filter dims
        if extracted.by_column:
            return MetricValidationResult(
                ok=False,
                reason=f"metric '{metric_id}' has no declared_filters but instruction has filters",
                guard_action="metric_rejected_filter_mismatch",
                fallback_filters=extracted.as_plan_filters(),
            )
        return MetricValidationResult(ok=True, reason="no_declared_filters_no_instruction_filters")

    # Instruction has a filter column the metric does not encode
    for col, vals in extracted.by_column.items():
        if col not in declared:
            return MetricValidationResult(
                ok=False,
                reason=f"instruction filter '{col}' not encoded in metric '{metric_id}'",
                guard_action="metric_rejected_filter_mismatch",
                fallback_filters=extracted.as_plan_filters(),
            )
        allowed = declared[col]
        if allowed and not vals.issubset(set(allowed)):
            return MetricValidationResult(
                ok=False,
                reason=f"instruction {col}={vals} not subset of metric {col}={set(allowed)}",
                guard_action="metric_rejected_filter_mismatch",
                fallback_filters=extracted.as_plan_filters(),
            )

    # Metric encodes a filter the instruction did not ask for
    for col, allowed in declared.items():
        if not allowed:
            continue
        if col not in extracted.by_column:
            return MetricValidationResult(
                ok=False,
                reason=f"metric '{metric_id}' encodes {col}={set(allowed)} but instruction did not ask",
                guard_action="metric_rejected_filter_mismatch",
                fallback_filters=extracted.as_plan_filters(),
            )

    return MetricValidationResult(ok=True, reason="filter_match")


def suggest_certified_metric(instruction: str | None, *, product: str = "ticketing") -> str | None:
    """Pick a certified KPI when the instruction uniquely matches declared filters."""
    if product not in ("ticketing", "tk"):
        return None
    from sql_agent.kpi_certified import is_certified, resolve_metric_alias
    from sql_agent.mas.intent_gate import is_created_by_me_instruction
    from sql_agent.time_window import extract_period_from_instruction

    extracted = extract_instruction_filters(instruction)
    text = (instruction or "").lower()
    if re.search(r"\bhow many customers?\b", text) and "active" not in text:
        mid = "total_customers_metric"
        return mid if is_certified(mid, product=product) else None
    if is_created_by_me_instruction(instruction) and not extracted.by_column:
        mid = "tickets_created_by_me"
        return mid if is_certified(mid, product=product) else None
    period = extract_period_from_instruction(instruction)
    if period and not extracted.by_column:
        mid = _WINDOW_METRICS.get(period)
        if mid and is_certified(mid, product=product):
            return mid
    encoded: list[str] = []
    for mid, declared in _DECLARED_FILTERS.items():
        if mid in _CATCHALL_METRICS:
            continue
        if not is_certified(resolve_metric_alias(mid), product=product):
            continue
        if validate_metric_against_instruction(mid, instruction).ok:
            encoded.append(resolve_metric_alias(mid))
    uniq = list(dict.fromkeys(encoded))
    if len(uniq) == 1:
        return uniq[0]
    if not extracted.by_column and not period:
        mid = "ticket_volume"
        return mid if is_certified(mid, product=product) else None
    return None
