"""Parse Domain / executor review JSON. No keyword routing of the user question."""

from __future__ import annotations

from typing import Any


def as_bool(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in {"true", "yes", "done", "1"}
    return bool(val)


def sql_task_done(review: dict[str, Any], result: dict[str, Any], task: dict[str, Any]) -> tuple[bool, str]:
    """Python signals plus optional LLM review. Empty KPI/breakdown is not done."""
    status = str(result.get("status") or "").lower()
    rows = result.get("rows") or []
    answer_type = str(task.get("answer_type") or "")
    if status not in {"ok", "success"}:
        return False, str(result.get("error") or result.get("error_type") or "executor error")
    if answer_type in {"kpi", "breakdown", "comparison", "list"} and not rows:
        return False, "No rows for a task that needed a number, list, or breakdown."
    if review:
        gap = str(review.get("gap") or review.get("reason") or "")
        if "done" in review:
            return as_bool(review.get("done")), gap
    return True, ""
