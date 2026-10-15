"""Working-memory task envelope for MAS (module skill state lives in session module_skills)."""

from __future__ import annotations

import uuid
from typing import Any

MAS_TASK_KEY = "mas_task"


def empty_mas_task() -> dict[str, Any]:
    return {
        "task_id": str(uuid.uuid4()),
        "active_domain": None,
        "active_executor": None,
        "plan": [],
        "slots": {},
        "steps": [],
        "campaign_id": None,
        "correlation_id": None,
        "needs_domain": None,
        "last_message": None,
    }


def get_mas_task(session: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(session, dict):
        return empty_mas_task()
    task = session.get(MAS_TASK_KEY)
    if not isinstance(task, dict):
        task = empty_mas_task()
        session[MAS_TASK_KEY] = task
    return task


def set_active_domain(session: dict[str, Any], domain_id: str | None) -> dict[str, Any]:
    """Set active domain; clear executor/steps context when domain changes."""
    task = get_mas_task(session)
    prev = task.get("active_domain")
    new = str(domain_id or "").strip().lower() or None
    if prev != new:
        task["active_domain"] = new
        task["active_executor"] = None
        task["plan"] = []
        task["steps"] = []
        task["needs_domain"] = None
    else:
        task["active_domain"] = new
    session[MAS_TASK_KEY] = task
    return task


def set_active_executor(session: dict[str, Any], executor_id: str | None) -> dict[str, Any]:
    task = get_mas_task(session)
    task["active_executor"] = str(executor_id or "").strip().lower() or None
    session[MAS_TASK_KEY] = task
    return task


def append_step(
    session: dict[str, Any],
    *,
    executor_id: str,
    action_status: str,
    result: dict[str, Any] | None = None,
    message: str = "",
) -> dict[str, Any]:
    task = get_mas_task(session)
    steps = list(task.get("steps") or [])
    steps.append(
        {
            "executor_id": executor_id,
            "action_status": action_status,
            "result": result or {},
            "message": message,
        }
    )
    task["steps"] = steps
    task["last_message"] = message or task.get("last_message")
    session[MAS_TASK_KEY] = task
    return task


def set_needs_domain(
    session: dict[str, Any],
    domain_id: str | None,
    *,
    restated_query: str = "",
    preferred_executor: str | None = None,
) -> dict[str, Any]:
    task = get_mas_task(session)
    task["needs_domain"] = (
        {
            "domain_id": domain_id,
            "restated_query": restated_query,
            "preferred_executor": preferred_executor,
        }
        if domain_id
        else None
    )
    session[MAS_TASK_KEY] = task
    return task
