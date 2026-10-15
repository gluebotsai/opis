"""Native MAS Content executor loop — bounded WA tools + channel generation."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.channel_content import (
    EXECUTOR_CHANNEL,
    run_channel_content_executor,
)
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import get_mas_task
from app.request_context import set_request_token
from app.session_store import get_or_create_session

_PACKAGE = Path(__file__).resolve().parent

_CHANNEL_EXECUTORS = frozenset(EXECUTOR_CHANNEL.keys())
_WA_MODULE = {
    "whatsapp_approved_send": "whatsapp_approved",
    "content_verification": "whatsapp_rejected",
}


def is_native_content() -> bool:
    from app.mas.runtime.flags import is_content_native_enabled

    return is_content_native_enabled()


async def run_native_content_executor(
    ctx: dict[str, Any],
    executor_id: str,
    *,
    agent_md_dir: Path | None = None,
) -> dict[str, Any]:
    """Run one bounded Content executor (channel gen or WA tool loop)."""
    package = agent_md_dir or (_PACKAGE.parent / executor_id)
    meta = package_agent_md(package)
    task_spec = dict(ctx.get("task_spec") or {})
    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or "").strip()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()
    event_callback = ctx.get("event_callback")
    eid = str(executor_id or "email_content").strip().lower()

    if eid in _CHANNEL_EXECUTORS:
        out = await run_channel_content_executor(eid, ctx)
        out["mas_native_content"] = True
        out["mas_owned_loop"] = True
        return out

    if eid == "template_coach":
        from app.mas.executors.template_coach.runner import run_template_coach_executor

        out = await run_template_coach_executor(ctx)
        out["mas_native_content"] = True
        return out

    if not session_id:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": eid,
            "error": "session_id required",
            "agent_md_loaded": not meta.get("missing"),
        }

    module = _WA_MODULE.get(eid)
    if not module:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": eid,
            "error": f"No native loop for executor '{eid}'",
            "agent_md_loaded": not meta.get("missing"),
        }

    from app.mas.runtime.content_tools import tools_for_mas_content_executor
    from app.mas.skills.registry import get_skill_registry
    from app.mas.skills.state import WHATSAPP_APPROVED_MODULE, get_active_skill_id

    set_request_token(token)
    session = await get_or_create_session(session_id, token=token, module=module)
    mas_task = get_mas_task(session)
    skill_id = str(task_spec.get("skill_id") or "").strip().lower() or None
    if eid == "whatsapp_approved_send" and not skill_id:
        skill_id = get_active_skill_id(session, WHATSAPP_APPROVED_MODULE)
    if eid == "whatsapp_approved_send" and skill_id:
        tools = get_skill_registry().tools_for_skill(
            WHATSAPP_APPROVED_MODULE,
            skill_id,
            session=session,
        )
        if not tools:
            tools = tools_for_mas_content_executor(eid)
    else:
        tools = tools_for_mas_content_executor(eid)

    if eid == "whatsapp_approved_send":
        from app.agents.whatsapp_approved.agent import run_whatsapp_approved_executor_turn
        from app.agents.whatsapp_approved.prompts import (
            build_whatsapp_approved_executor_system_prompt,
        )

        system_content = build_whatsapp_approved_executor_system_prompt(
            session,
            mas_task=mas_task,
            module_hint=str(ctx.get("module_hint") or task_spec.get("module") or module),
            skill_id=skill_id,
            skill_module=WHATSAPP_APPROVED_MODULE if skill_id else None,
        )
        turn = await run_whatsapp_approved_executor_turn(
            session_id=session_id,
            token=token,
            user_text=query,
            tools=tools,
            system_content=system_content,
            event_callback=event_callback,
        )
    else:
        from app.agents.whatsapp_rejected.agent import run_whatsapp_rejected_executor_turn
        from app.agents.whatsapp_rejected.prompts import (
            build_whatsapp_rejected_executor_system_prompt,
        )

        system_content = build_whatsapp_rejected_executor_system_prompt(
            session,
            mas_task=mas_task,
            module_hint=str(ctx.get("module_hint") or task_spec.get("module") or module),
        )
        turn = await run_whatsapp_rejected_executor_turn(
            session_id=session_id,
            token=token,
            user_text=query,
            tools=tools,
            system_content=system_content,
            event_callback=event_callback,
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
        "mas_native_content": True,
    }
    if skill_id and eid == "whatsapp_approved_send":
        out["skill_id"] = skill_id
    return out
