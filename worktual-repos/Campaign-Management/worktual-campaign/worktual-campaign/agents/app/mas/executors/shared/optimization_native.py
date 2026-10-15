"""Native MAS Optimization executor loop — bounded tools, shared handlers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import get_mas_task
from app.request_context import set_request_token
from app.session_store import get_or_create_session

_PACKAGE = Path(__file__).resolve().parent


def is_native_optimization() -> bool:
    from app.mas.runtime.flags import is_optimization_native_enabled

    return is_optimization_native_enabled()


async def run_native_optimization_executor(
    ctx: dict[str, Any],
    executor_id: str,
    *,
    agent_md_dir: Path | None = None,
) -> dict[str, Any]:
    """Run one bounded Optimization tool loop for a MAS executor."""
    package = agent_md_dir or (_PACKAGE.parent / executor_id)
    meta = package_agent_md(package)
    task_spec = dict(ctx.get("task_spec") or {})
    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or "").strip()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()
    event_callback = ctx.get("event_callback")

    if not session_id:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": executor_id,
            "error": "session_id required",
            "agent_md_loaded": not meta.get("missing"),
        }

    from app.agents.monitoring.tools.schemas import tools_for_mas_optimization_executor
    from app.mas.skills import (
        MONITORING_MODULE,
        REPORTS_MODULE,
        get_active_skill_id,
        get_skill_registry,
    )

    set_request_token(token)
    existing = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    module = str(
        existing.get("module")
        or ctx.get("module_hint")
        or task_spec.get("module")
        or "monitoring"
    ).strip().lower()
    surface = str(task_spec.get("surface") or "").strip().lower()
    if module == "events_report":
        surface = "events_report"
    elif module in ("reports", "dashboard") and not surface:
        surface = "reports"

    session = await get_or_create_session(session_id, token=token, module=module)
    mas_task = get_mas_task(session)
    eid = str(executor_id or "monitoring").strip().lower()
    skill_id = str(task_spec.get("skill_id") or "").strip().lower() or None
    if not skill_id and eid in ("monitoring", "recovery"):
        skill_id = get_active_skill_id(session, MONITORING_MODULE)
    if not skill_id and eid == "analytics":
        skill_id = get_active_skill_id(session, REPORTS_MODULE)

    if skill_id and eid in ("monitoring", "recovery"):
        tools = get_skill_registry().tools_for_skill(
            MONITORING_MODULE, skill_id, session=session
        )
        if not tools:
            tools = tools_for_mas_optimization_executor(eid, surface=surface or "reports")
    elif skill_id and eid == "analytics":
        tools = get_skill_registry().tools_for_skill(
            REPORTS_MODULE, skill_id, session=session
        )
        if skill_id == "events_report":
            surface = "events_report"
        elif not surface:
            surface = "reports"
        if not tools:
            tools = tools_for_mas_optimization_executor(eid, surface=surface or "reports")
    else:
        tools = tools_for_mas_optimization_executor(eid, surface=surface or "reports")

    if eid == "analytics":
        from app.agents.reports.prompts import build_analytics_executor_system_prompt

        system_content = build_analytics_executor_system_prompt(
            session,
            mas_task=mas_task,
            module_hint=str(ctx.get("module_hint") or task_spec.get("module") or module),
            surface=surface or "reports",
            skill_id=skill_id,
        )
        if surface == "events_report" or skill_id == "events_report":
            from app.agents.events_report.agent import run_events_report_executor_turn

            turn = await run_events_report_executor_turn(
                session_id=session_id,
                token=token,
                user_text=query,
                tools=tools,
                system_content=system_content,
                event_callback=event_callback,
            )
        else:
            from app.agents.reports.agent import run_analytics_executor_turn

            turn = await run_analytics_executor_turn(
                session_id=session_id,
                token=token,
                user_text=query,
                tools=tools,
                system_content=system_content,
                module=module if module in ("reports", "events_report") else "reports",
                event_callback=event_callback,
            )
    else:
        from app.agents.monitoring.agent import run_monitoring_executor_turn
        from app.agents.monitoring.prompts import build_monitoring_executor_system_prompt

        system_content = build_monitoring_executor_system_prompt(
            session,
            eid,
            mas_task=mas_task,
            module_hint=str(ctx.get("module_hint") or task_spec.get("module") or module),
            skill_id=skill_id,
        )
        turn = await run_monitoring_executor_turn(
            session_id=session_id,
            token=token,
            user_text=query,
            tools=tools,
            system_content=system_content,
            executor_id=eid,
            event_callback=event_callback,
        )

    out: dict[str, Any] = {
        "ok": True,
        "action_status": "completed",
        "kind": "executor",
        "agent_id": eid,
        "message": turn.get("reply") or "",
        "reply": turn.get("reply") or "",
        "state": turn.get("state"),
        "ui_events": list(turn.get("ui_events") or []),
        "result": turn,
        "agent_md_loaded": not meta.get("missing"),
        "mas_owned_loop": True,
        "mas_native_optimization": True,
    }
    if skill_id:
        out["skill_id"] = skill_id
    if turn.get("analytics"):
        out["analytics"] = turn["analytics"]
    if turn.get("suggestions"):
        out["suggestions"] = turn["suggestions"]
    return out
