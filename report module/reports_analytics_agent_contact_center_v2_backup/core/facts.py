"""Compact fact blocks from SQL rows. Domain (later) briefs from these only."""

from __future__ import annotations

from typing import Any


def _num(val: Any) -> float | None:
    if isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return float(val)
    return None


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
        cells = []
        for key, val in row.items():
            n = _num(val)
            if n is None:
                cells.append(f"{key}={val}")
            elif isinstance(val, float) and n != int(n):
                cells.append(f"{key}={round(n, 4)}")
            elif n == int(n):
                cells.append(f"{key}={int(n)}")
            else:
                cells.append(f"{key}={val}")
        lines.append(f"row {i}: " + "; ".join(cells))
    if len(rows) > 10:
        lines.append(f"... {len(rows) - 10} more rows omitted")
    return "\n".join(lines)
