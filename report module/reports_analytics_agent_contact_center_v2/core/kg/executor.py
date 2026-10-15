"""Thin Domain handoff to the CCaaS Cypher agent. No second planner."""

from __future__ import annotations

import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from ..access import AccessDenied
from ..facts import assemble_facts
from ..time import TimeBounds, TimeSpec, resolve_time
from .role import lookup_cc_role

KG_ROOT = Path(__file__).resolve().parents[2] / "CCAAS_kg_context_agent"
if str(KG_ROOT) not in sys.path:
    sys.path.insert(0, str(KG_ROOT))


def _iso(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _deny_result(message: str, task_goal: str = "", time_echo: str = "") -> dict[str, Any]:
    result = {
        "status": "error",
        "store": "kg",
        "error_type": "DENY",
        "error": message,
        "certified": False,
        "rows": [],
        "time_echo": time_echo,
    }
    result["facts"] = assemble_facts(result, task_goal=task_goal, time_echo=time_echo)
    return result


def execute_kg_task(
    task: dict[str, Any],
    *,
    organization_id: int,
    user_id: int,
    role: str = "",
    dsn: str = "",
    sql_facts: str = "",
    understanding: str = "",
    session_id: str | None = None,
    llm: Any = None,
    role_lookup: Callable[..., str] | None = None,
) -> dict[str, Any]:
    """Map a Domain task onto the Cypher agent and return facts Domain can brief."""
    task = dict(task or {})
    task.pop("kpi", None)
    task.pop("kpi_id", None)
    task.pop("sql", None)
    task.pop("cypher", None)
    _ = role

    time_words = str(task.get("time") or "").strip()
    echo = time_words
    start_iso = end_iso = cmp_start = cmp_end = ""
    if time_words:
        try:
            bounds = resolve_time(TimeSpec(expression=time_words))
            start_iso = _iso(bounds.start)
            end_iso = _iso(bounds.end)
            echo = bounds.echo or time_words
        except ValueError:
            bounds = TimeBounds(None, None, time_words)
            echo = time_words
    else:
        bounds = TimeBounds(None, None, "")

    try:
        if role_lookup is not None:
            kg_role = role_lookup(dsn, organization_id, user_id)
        else:
            kg_role = lookup_cc_role(dsn, organization_id, user_id)
        kg_role = "admin" if str(kg_role).lower() == "admin" else "agent"
    except AccessDenied as exc:
        return _deny_result(str(exc), task_goal=str(task.get("goal") or ""), time_echo=echo)

    from src.response import ChatRequest, Generate_response

    slice_raw = task.get("slice") or []
    if isinstance(slice_raw, str):
        slice_raw = [slice_raw] if slice_raw.strip() else []

    request = ChatRequest(
        sessionID=session_id or str(uuid.uuid4()),
        query=str(task.get("goal") or "").strip(),
        organization_id=str(organization_id),
        user_id=str(user_id),
        understanding=understanding or "",
        goal=str(task.get("goal") or "").strip(),
        time=time_words,
        scope=str(task.get("scope") or ""),
        slice=[str(s) for s in slice_raw if s],
        answer_type=str(task.get("answer_type") or ""),
        path=str(task.get("path") or "why_links"),
        sql_facts=sql_facts or "",
        period_start=start_iso,
        period_end=end_iso,
        compare_start=cmp_start,
        compare_end=cmp_end,
    )

    if llm is None:
        from src.llm import LOWLLM

        llm = LOWLLM()

    raw = Generate_response(request, role=kg_role, llm=llm)
    rows = list(raw.get("rows") or [])
    packet = str(raw.get("content") or "")
    result = {
        "status": "ok" if packet else "error",
        "store": "kg",
        "certified": False,
        "rows": rows,
        "time_echo": echo,
        "reasoning": raw.get("reasoning"),
        "error": raw.get("error"),
    }
    if not packet:
        result["status"] = "error"
        result["error_type"] = "REPAIR"
        result["error"] = result.get("error") or "Cypher agent returned an empty packet."
    result["facts"] = packet or assemble_facts(
        result,
        task_goal=str(task.get("goal") or ""),
        answer_type=str(task.get("answer_type") or ""),
        time_echo=echo,
    )
    if echo and "window:" not in result["facts"]:
        result["facts"] = f"window: {echo}\n{result['facts']}"
    return result
