"""Native MAS Audience executor loop — bounded CRM tools, shared handlers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.config import get_settings
from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import get_mas_task
from app.request_context import set_request_token
from app.session_store import get_or_create_session

_PACKAGE = Path(__file__).resolve().parent


def is_native_audience() -> bool:
    return bool(get_settings().mas_audience_native)


async def run_native_audience_executor(
    ctx: dict[str, Any],
    executor_id: str,
    *,
    agent_md_dir: Path | None = None,
) -> dict[str, Any]:
    """Run one bounded Audience CRM tool loop for a MAS executor."""
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

    from app.agents.contacts.agent import run_contacts_executor_turn
    from app.agents.contacts.prompts import build_contacts_executor_system_prompt
    from app.agents.contacts.tools.schemas import tools_for_mas_audience_executor
    from app.mas.skills import CONTACTS_MODULE, get_active_skill_id, get_skill_registry

    set_request_token(token)
    existing = ctx.get("session") if isinstance(ctx.get("session"), dict) else {}
    module = str(
        existing.get("module")
        or ctx.get("module_hint")
        or task_spec.get("module")
        or "contacts"
    ).strip().lower()
    session = await get_or_create_session(session_id, token=token, module=module)
    mas_task = get_mas_task(session)
    skill_id = str(task_spec.get("skill_id") or "").strip().lower() or None
    if not skill_id and executor_id == "contact":
        skill_id = get_active_skill_id(session, CONTACTS_MODULE)
    if skill_id:
        tools = get_skill_registry().tools_for_skill(
            CONTACTS_MODULE, skill_id, session=session
        )
    else:
        tools = tools_for_mas_audience_executor(executor_id)
    system_content = build_contacts_executor_system_prompt(
        session,
        executor_id,
        mas_task=mas_task,
        module_hint=str(ctx.get("module_hint") or task_spec.get("module") or module),
        skill_id=skill_id,
    )

    turn = await run_contacts_executor_turn(
        session_id=session_id,
        token=token,
        user_text=query,
        tools=tools,
        system_content=system_content,
        event_callback=event_callback,
        executor_id=executor_id,
        skill_id=skill_id,
    )

    result_out: dict[str, Any] = {
        "ok": True,
        "action_status": "completed",
        "kind": "executor",
        "agent_id": executor_id,
        "message": turn.get("reply") or "",
        "reply": turn.get("reply") or "",
        "state": turn.get("state"),
        "ui_events": list(turn.get("ui_events") or []),
        "result": turn,
        "agent_md_loaded": not meta.get("missing"),
        "mas_owned_loop": True,
        "mas_native_audience": True,
    }
    if skill_id:
        result_out["skill_id"] = skill_id
    return result_out
