"""Native MAS Forms executor loop — bounded specialist tools."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import get_mas_task
from app.request_context import set_request_token
from app.session_store import get_or_create_session

_PACKAGE = Path(__file__).resolve().parent


def is_native_forms() -> bool:
    from app.mas.runtime.flags import is_forms_native_enabled

    return is_forms_native_enabled()


async def run_native_forms_executor(
    ctx: dict[str, Any],
    executor_id: str,
    *,
    agent_md_dir: Path | None = None,
) -> dict[str, Any]:
    """Run one bounded Forms tool loop for a MAS executor."""
    package = agent_md_dir or (_PACKAGE.parent / executor_id)
    meta = package_agent_md(package)
    task_spec = dict(ctx.get("task_spec") or {})
    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or "").strip()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()
    event_callback = ctx.get("event_callback")
    eid = str(executor_id or "form_theme").strip().lower()

    if not session_id:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": eid,
            "error": "session_id required",
            "agent_md_loaded": not meta.get("missing"),
        }

    from app.agents.forms.agent import run_forms_executor_turn
    from app.agents.forms.prompts import build_forms_executor_system_prompt
    from app.agents.forms.tools.schemas import tools_for_mas_forms_executor

    set_request_token(token)
    session = await get_or_create_session(session_id, token=token, module="forms")
    mas_task = get_mas_task(session)
    tools = tools_for_mas_forms_executor(eid)
    system_content = build_forms_executor_system_prompt(
        session,
        eid,
        mas_task=mas_task,
        module_hint=str(ctx.get("module_hint") or task_spec.get("module") or "forms"),
    )
    turn = await run_forms_executor_turn(
        session_id=session_id,
        token=token,
        user_text=query,
        tools=tools,
        system_content=system_content,
        executor_id=eid,
        event_callback=event_callback,
    )

    return {
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
        "mas_native_forms": True,
    }
