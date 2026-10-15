"""Compact fact blocks from SQL rows. Domain (later) briefs from these only."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from .analysis import DURATION_MINUTE_KEYS, format_duration_minutes, format_journey_seconds


def _num(val: Any) -> float | None:
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, Decimal):
        try:
            return float(val)
        except (InvalidOperation, ValueError):
            return None
    if isinstance(val, str):
        text = val.strip()
        if not text or text.startswith("?"):
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


def _cell_key(key: Any) -> str:
    name = str(key or "").strip()
    if not name or name.startswith("?column"):
        return "value"
    return name


def _format_cell(key: str, val: Any, *, kpi_id: str | None, unit: str) -> str:
    n = _num(val)
    low = key.lower()
    if n is not None and (
        kpi_id in DURATION_MINUTE_KEYS
        or (unit == "minutes" and low in DURATION_MINUTE_KEYS)
    ):
        clock = format_duration_minutes(n)
        if clock:
            return f"{key}={clock}"
    if n is not None and (low.endswith("_seconds") or low.endswith("_secs")):
        clock = format_journey_seconds(n)
        if clock:
            return f"{key}={clock}"
    if n is None:
        return f"{key}={val}"
    if isinstance(val, float) or (isinstance(val, str) and "e" in val.lower()):
        if n == int(n):
            return f"{key}={int(n)}"
        return f"{key}={round(n, 4)}"
    if n == int(n):
        return f"{key}={int(n)}"
    return f"{key}={val}"


def assemble_facts(
    result: dict[str, Any],
    *,
    task_goal: str = "",
    kpi_id: str | None = None,
    answer_type: str = "",
    time_echo: str = "",
) -> str:
    period = time_echo or result.get("time_echo") or ""
    certified = result.get("certified")
    head = []
    if period:
        head.append(f"window: {period}")
    if kpi_id:
        head.append(f"kpi: {kpi_id}")
    if certified is False:
        head.append("certified: false")
    elif certified is True:
        head.append("certified: true")
    unit = str(result.get("unit") or "").strip()
    if kpi_id in DURATION_MINUTE_KEYS or unit == "minutes":
        if kpi_id in DURATION_MINUTE_KEYS:
            unit = "clock"
    if unit:
        head.append(f"unit: {unit}")
    if task_goal:
        head.append(f"task_goal: {task_goal}")
    if answer_type:
        head.append(f"answer_type: {answer_type}")

    if result.get("status") == "unavailable" or result.get("unavailable"):
        reason = str(result.get("reason") or result.get("error") or "That measure is not in Contact Center reports.")
        return "\n".join(head + ["UNAVAILABLE", f"reason: {reason}"])

    if result.get("status") == "error":
        bits = [
            "EXECUTION_ERROR",
            f"error_type: {result.get('error_type', 'UNKNOWN')}",
            f"message: {result.get('error', 'Unknown execution error')}",
        ]
        return "\n".join(head + bits)

    rows: list[dict[str, Any]] = list(result.get("rows") or [])
    if not rows:
        return "\n".join(head + ["RESULT: 0 rows"])

    lines = head + [f"row_count: {len(rows)}"]
    if result.get("capped"):
        lines.append("cap_hit: true")
    preview = rows[:10]
    for i, row in enumerate(preview, 1):
        cells = [_format_cell(_cell_key(key), val, kpi_id=kpi_id, unit=unit) for key, val in row.items()]
        lines.append(f"row {i}: " + "; ".join(cells))
    if len(rows) > 10:
        lines.append(f"... {len(rows) - 10} more rows omitted")
    return "\n".join(lines)
