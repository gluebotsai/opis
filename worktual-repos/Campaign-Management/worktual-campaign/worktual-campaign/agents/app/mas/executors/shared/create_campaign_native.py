"""Native MAS create-campaign executor loop — bounded tools, shared handlers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.config import get_settings
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import get_mas_task
from app.request_context import set_request_token
from app.session_store import get_or_create_session

_PACKAGE = Path(__file__).resolve().parent


def is_native_create_campaign() -> bool:
    return bool(get_settings().mas_create_campaign_native)


def is_create_campaign_handoff(ctx: dict[str, Any]) -> bool:
    """True when Audience/Content executors should use campaign core tools."""
    task_spec = dict(ctx.get("task_spec") or {})
    session = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    mod = str(
        session.get("module")
        or ctx.get("module_hint")
        or task_spec.get("module")
        or ""
    ).strip().lower()
    if task_spec.get("handoff_source_domain") == "creation":
        return True
    if not task_spec.get("from_domain_handoff"):
        return False
    return mod in (
        "create_campaign",
        "recommendations",
        "recommendation_run",
        "library_run",
        "whatsapp_approved",
        "",
    )


async def run_native_create_executor(
    ctx: dict[str, Any],
    executor_id: str,
    *,
    agent_md_dir: Path | None = None,
) -> dict[str, Any]:
    """Run one bounded create-campaign tool loop for a MAS executor."""
    package = agent_md_dir or (_PACKAGE.parent / executor_id)
    meta = package_agent_md(package)
    task_spec = dict(ctx.get("task_spec") or {})
    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or "").strip()
    verbatim = str(
        ctx.get("verbatim_user_text") or task_spec.get("query") or ctx.get("query") or ""
    ).strip()
    mas_managed = bool(ctx.get("mas_transcript_managed"))
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

    from app.agents.create_campaign.agent import run_create_campaign_executor_turn
    from app.agents.create_campaign.prompts import build_executor_system_prompt
    from app.agents.create_campaign.tools import tools_for_mas_executor
    from app.mas.skills import (
        CREATE_CAMPAIGN_MODULE,
        LIBRARY_RUN_MODULE,
        get_active_skill_id,
        get_skill_registry,
    )

    set_request_token(token)
    existing = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    module = str(
        existing.get("module")
        or ctx.get("module_hint")
        or task_spec.get("module")
        or "create_campaign"
    ).strip().lower()
    session = await get_or_create_session(session_id, token=token, module=module)
    mas_task = get_mas_task(session)
    org = session.get("org_context") if isinstance(session.get("org_context"), dict) else {}
    eid = str(executor_id or "brief_validation").strip().lower()
    skill_module = (
        LIBRARY_RUN_MODULE
        if (
            session.get("library_run")
            or module == "library_run"
            or str(task_spec.get("module") or "").strip().lower() == "library_run"
        )
        else CREATE_CAMPAIGN_MODULE
    )
    if session.get("whatsapp_approved_run") or module == "whatsapp_approved":
        skill_module = CREATE_CAMPAIGN_MODULE
    skill_id = str(task_spec.get("skill_id") or "").strip().lower() or None
    if not skill_id and eid in (
        "brief_validation",
        "campaign_audience",
        "campaign_content",
        "launch_scheduling",
    ):
        skill_id = get_active_skill_id(session, skill_module)

    if skill_id and eid in (
        "brief_validation",
        "campaign_audience",
        "campaign_content",
        "launch_scheduling",
    ):
        tools = get_skill_registry().tools_for_skill(
            skill_module, skill_id, session=session
        )
        if not tools:
            tools = tools_for_mas_executor(eid)
    else:
        tools = tools_for_mas_executor(eid)

    system_content = build_executor_system_prompt(
        session,
        eid,
        org_context=org,
        mas_task=mas_task,
        skill_id=skill_id,
        skill_module=skill_module,
    )

    turn = await run_create_campaign_executor_turn(
        session_id=session_id,
        token=token,
        user_text=verbatim,
        tools=tools,
        system_content=system_content,
        event_callback=event_callback,
        executor_id=eid,
        persist_user=False if mas_managed else None,
        persist_chat=False if mas_managed else True,
    )

    out = {
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
        "mas_native_create": True,
    }
    if skill_id:
        out["skill_id"] = skill_id
    return out
