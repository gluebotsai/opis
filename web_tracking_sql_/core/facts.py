"""Structured fact block assembly from run_kpi / run_sql / run_cypher results.

Replaces present.py's raw tabular dumps with compact, structured factual summaries
designed for Domain LLM synthesis.
"""

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
    group_by: list[str] | None = None,
    answer_type: str = "",
) -> str:
    """Format query execution rows into structured facts for Domain synthesis."""
    if result.get("status") == "error":
        error_type = result.get("error_type", "UNKNOWN")
        msg = result.get("error", "Unknown execution error")
        return (
            "EXECUTION_ERROR\n"
            f"error_type: {error_type}\n"
            f"message: {msg}\n"
            f"task_goal: {task_goal}"
        )

    rows: list[dict[str, Any]] = list(result.get("rows") or [])
    n = len(rows)

    if not rows:
        return f"RESULT: 0 rows\ntask_goal: {task_goal}"

    # Single-value scalar KPI
    if n == 1 and len(rows[0]) == 1:
        key, val = next(iter(rows[0].items()))
        metric = kpi_id or key
        return f"RESULT: {metric} = {val}"

    # Grouped breakdown or ranking
    if group_by or answer_type in {"breakdown", "ranking"}:
        count_key = next((k for k in rows[0] if k.endswith("_count") or k == "count" or k == "n"), None)
        dim_str = ",".join(group_by or []) if group_by else "group"
        lines = [f"RESULT: {n} group(s)", f"group_by: {dim_str}"]
        if count_key:
            total = sum(_num(r.get(count_key)) or 0.0 for r in rows)
            tot_display = int(total) if total == int(total) else round(total, 2)
            lines.append(f"total_{count_key}: {tot_display}")
            for row in rows[:5]:
                label_keys = [k for k in rows[0] if k != count_key]
                label = " / ".join(str(row.get(k, "")) for k in label_keys) or "(blank)"
                lines.append(f"  {label}: {row.get(count_key)}")
            if n > 5:
                lines.append(f"  ... {n - 5} more groups not listed")
        else:
            for row in rows[:5]:
                lines.append("  " + " | ".join(f"{k}={v}" for k, v in row.items()))
            if n > 5:
                lines.append(f"  ... {n - 5} more groups not listed")
        return "\n".join(lines)

    # General list or ticket records
    lines = [f"RESULT: {n} row(s)", f"task_goal: {task_goal}"]
    for row in rows[:10]:
        lines.append("  " + " | ".join(f"{k}={v}" for k, v in row.items()))
    if n > 10:
        lines.append(f"  ... {n - 10} more rows not listed")
    return "\n".join(lines)
