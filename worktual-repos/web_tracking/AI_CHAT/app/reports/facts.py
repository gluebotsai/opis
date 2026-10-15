"""Structured fact blocks for Domain synthesis (ticketing-style)."""

from __future__ import annotations

from typing import Any


def _rows_as_dicts(columns: list[str], rows: list[list[Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in rows:
        out.append({columns[i]: row[i] for i in range(min(len(columns), len(row)))})
    return out


def assemble_facts(
    *,
    task_goal: str,
    kpi_id: str | None,
    answer_type: str,
    group_by: list[str] | None,
    columns: list[str],
    rows: list[list[Any]],
    status: str = "ok",
    error_type: str | None = None,
    error: str | None = None,
) -> str:
    if status == "error":
        return (
            "EXECUTION_ERROR\n"
            f"error_type: {error_type or 'UNKNOWN'}\n"
            f"message: {error or 'Unknown error'}\n"
            f"task_goal: {task_goal}"
        )

    dict_rows = _rows_as_dicts(columns, rows)
    n = len(dict_rows)
    if not dict_rows:
        return f"RESULT: 0 rows\ntask_goal: {task_goal}\ntime_scope: see plan"

    if n == 1 and len(columns) == 1:
        metric = kpi_id or columns[0]
        return f"RESULT: {metric} = {dict_rows[0].get(columns[0])}\ntask_goal: {task_goal}"

    if group_by or answer_type in {"breakdown", "ranking"}:
        metric_col = next(
            (c for c in columns if c.endswith("_count") or c in ("page_views", "unique_visitors")),
            columns[-1] if columns else "value",
        )
        dim_str = ",".join(group_by or []) if group_by else "group"
        lines = [f"RESULT: {n} group(s)", f"group_by: {dim_str}", f"task_goal: {task_goal}"]
        for row in dict_rows[:8]:
            label_keys = [k for k in columns if k != metric_col]
            label = " / ".join(str(row.get(k, "")) for k in label_keys) or "(blank)"
            lines.append(f"  {label}: {row.get(metric_col)}")
        if n > 8:
            lines.append(f"  ... {n - 8} more groups not listed")
        return "\n".join(lines)

    lines = [f"RESULT: {n} row(s)", f"task_goal: {task_goal}"]
    for row in dict_rows[:10]:
        lines.append("  " + " | ".join(f"{k}={v}" for k, v in row.items()))
    if n > 10:
        lines.append(f"  ... {n - 10} more rows not listed")
    return "\n".join(lines)
