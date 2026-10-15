# origin: ticketing_v2/core/facts.py
from __future__ import annotations
from decimal import Decimal
from typing import Any, List, Dict

from reports_analytics_agent_CRM_B2B.core.loader import load_kpis


def _num(val: Any) -> float | None:
    if isinstance(val, bool):
        return None
    if isinstance(val, Decimal):
        return float(val)
    if isinstance(val, (int, float)):
        return float(val)
    return None


def _population_line(kpi_id: str | None) -> str | None:
    if not kpi_id:
        return None
    try:
        meta = load_kpis().get(str(kpi_id)) or {}
    except Exception:
        return None
    includes = str((meta.get("definition") or {}).get("includes") or "").lower()
    if "open deal" in includes or str(kpi_id) == "high_probability_deals":
        return "population: open deals only"
    return None


def assemble_facts(
    result: dict[str, Any],
    *,
    task_goal: str = "",
    kpi_id: str | None = None,
    group_by: list[str] | None = None,
    answer_type: str = "",
    time_echo: str = "",
    time_requested: str | None = None,
    time_status: str | None = None,
    requested_kpi: str | None = None,
) -> str:
    """Format query execution rows into structured facts for Domain synthesis."""
    period_lines = []
    if time_requested:
        period_lines.append(f"time_requested: {time_requested}")
    if time_echo:
        period_lines.append(f"period_applied: {time_echo}")
    if time_status:
        period_lines.append(f"time_status: {time_status}")
    if requested_kpi and kpi_id and str(requested_kpi) != str(kpi_id):
        period_lines.append(f"requested_kpi: {requested_kpi}")
        period_lines.append(f"catalog_kpi: {kpi_id}")
    elif kpi_id:
        period_lines.append(f"catalog_kpi: {kpi_id}")
    pop = _population_line(kpi_id)
    if pop:
        period_lines.append(pop)
    period_block = ("\n".join(period_lines) + "\n") if period_lines else ""

    if result.get("status") == "error":
        error_type = result.get("error_type", "UNKNOWN")
        msg = result.get("error", "Unknown execution error")
        return (
            "EXECUTION_ERROR\n"
            f"{period_block}"
            f"error_type: {error_type}\n"
            f"message: {msg}\n"
            f"task_goal: {task_goal}"
        )

    rows: list[dict[str, Any]] = list(result.get("rows") or result.get("records") or [])
    n = len(rows)

    if not rows:
        return f"{period_block}RESULT: 0 rows\ntask_goal: {task_goal}".strip()

    # Single-value scalar KPI
    if n == 1 and len(rows[0]) == 1:
        key, val = next(iter(rows[0].items()))
        metric = kpi_id or key
        return f"{period_block}RESULT: {metric} = {val}".strip()

    # Grouped breakdown or ranking
    dim_hint = group_by or ([k for k in rows[0] if k in {"owner", "owner_name", "stage", "company", "company_name"}] if n >= 1 else [])
    if group_by or answer_type in {"breakdown", "ranking"} or (n > 1 and len(rows[0]) > 1):
        count_key = next((k for k in rows[0] if k.endswith("_count") or k in {"count", "n"} or k.endswith("_amount") or k.endswith("_pipeline") or k.endswith("_revenue") or k.endswith("_opportunities") or k.endswith("_value")), None)
        dim_str = ",".join(group_by or dim_hint or ["group"])
        lines = [f"{period_block}RESULT: {n} group(s)".strip(), f"group_by: {dim_str}"]
        if count_key:
            total = sum(_num(r.get(count_key)) or 0.0 for r in rows)
            tot_display = int(total) if total == int(total) else round(total, 2)
            lines.append(f"total_{count_key}: {tot_display}")
            for row in rows[:15]:
                label_keys = [k for k in rows[0] if k != count_key]
                label = " / ".join(str(row.get(k, "")) for k in label_keys) or "(blank)"
                lines.append(f"  {label}: {row.get(count_key)}")
            if n > 15:
                lines.append(f"  ... {n - 15} more groups not listed")
        else:
            for row in rows[:15]:
                lines.append("  " + " | ".join(f"{k}={v}" for k, v in row.items()))
            if n > 15:
                lines.append(f"  ... {n - 15} more groups not listed")
        return "\n".join(lines)

    # General list or records
    lines = [f"{period_block}RESULT: {n} row(s)".strip(), f"task_goal: {task_goal}"]
    for row in rows[:10]:
        lines.append("  " + " | ".join(f"{k}={v}" for k, v in row.items()))
    if n > 10:
        lines.append(f"  ... {n - 10} more rows not listed")
    return "\n".join(lines)
