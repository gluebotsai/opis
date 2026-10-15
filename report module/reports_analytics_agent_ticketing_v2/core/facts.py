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


def _cell(key: str, val: Any) -> str:
    n = _num(val)
    if n is None:
        return f"{key}={val}"
    low = key.lower()
    if "rate" in low and 0 <= n <= 1:
        pct = round(n * 100, 1)
        return f"{key}={val} display_percent={pct}%"
    if isinstance(val, float) and n != int(n):
        rounded = round(n, 2)
        return f"{key}={val} display={rounded}"
    if n == int(n) and abs(n) >= 0:
        return f"{key}={int(n)}"
    return f"{key}={val}"


def assemble_facts(
    result: dict[str, Any],
    *,
    task_goal: str = "",
    kpi_id: str | None = None,
    group_by: list[str] | None = None,
    answer_type: str = "",
    time_echo: str = "",
) -> str:
    """Format query execution rows into structured facts for Domain synthesis."""
    period = time_echo or result.get("time_echo") or ""
    period_line = f"window: {period}" if period else ""

    if result.get("status") == "error":
        error_type = result.get("error_type", "UNKNOWN")
        msg = result.get("error", "Unknown execution error")
        bits = [
            "EXECUTION_ERROR",
            f"error_type: {error_type}",
            f"message: {msg}",
            f"task_goal: {task_goal}",
        ]
        if period_line:
            bits.append(period_line)
        return "\n".join(bits)

    rows: list[dict[str, Any]] = list(result.get("rows") or [])
    n = len(rows)
    unit_note = ""
    if kpi_id == "queue_coverage":
        unit_note = "unit: membership_count (not a percent)"
    if kpi_id == "accounts_served":
        unit_note = "grain: distinct contact_profile.id on tickets (not account_id)"
    if kpi_id == "unread_notifications":
        unit_note = "scope: this user unless facts say org-wide"

    def _prefix(body: str) -> str:
        extra = [period_line, unit_note]
        head = "\n".join(x for x in extra if x)
        return f"{head}\n{body}" if head else body

    if not rows:
        return _prefix(f"RESULT: 0 rows\ntask_goal: {task_goal}")

    # Single-value scalar KPI
    if n == 1 and len(rows[0]) == 1:
        key, val = next(iter(rows[0].items()))
        metric = kpi_id or key
        cell = _cell(key, val)
        if "display_percent" in cell or "display=" in cell:
            return _prefix(f"RESULT: {metric} = {val}\n{cell}")
        nval = _num(val)
        shown = int(nval) if nval is not None and nval == int(nval) else val
        return _prefix(f"RESULT: {metric} = {shown}")

    # One result row with several metrics (distribution, approval_rate + pending)
    if n == 1:
        lines = [f"RESULT: {kpi_id or 'metrics'}"]
        for key, val in rows[0].items():
            lines.append(_cell(key, val))
        return _prefix("\n".join(lines))

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
                lines.append("  " + " | ".join(_cell(k, v) for k, v in row.items()))
            if n > 5:
                lines.append(f"  ... {n - 5} more groups not listed")
        return _prefix("\n".join(lines))

    # General list or ticket records — never a population total
    cap = result.get("row_cap")
    capped = bool(result.get("capped")) or (isinstance(cap, int) and n >= cap) or n >= 50
    lines = [
        f"RESULT: {n} row(s)",
        "list_not_a_total: true",
        f"task_goal: {task_goal}",
    ]
    if capped:
        lines.append(
            f"row_cap_hit: this is a sample of {n} rows, not the total matching population"
        )
    for row in rows[:10]:
        lines.append("  " + " | ".join(_cell(k, v) for k, v in row.items()))
    if n > 10:
        lines.append(f"  ... {n - 10} more rows not listed")
    return _prefix("\n".join(lines))
