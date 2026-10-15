"""Native MAS Image executor loop — enhance-before-generate tools."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.task_memory import get_mas_task
from app.request_context import set_request_token
from app.session_store import get_or_create_session, save_session

_PACKAGE = Path(__file__).resolve().parent


def is_native_image() -> bool:
    from app.mas.runtime.flags import is_image_native_enabled

    return is_image_native_enabled()


async def run_native_image_executor(
    ctx: dict[str, Any],
    executor_id: str,
    *,
    agent_md_dir: Path | None = None,
) -> dict[str, Any]:
    """Run one bounded Image tool loop for a MAS executor."""
    package = agent_md_dir or (_PACKAGE.parent / executor_id)
    meta = package_agent_md(package)
    task_spec = dict(ctx.get("task_spec") or {})
    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or "").strip()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()
    event_callback = ctx.get("event_callback")
    persist_chat = bool(ctx.get("persist_chat", True))
    eid = str(executor_id or "image_generate").strip().lower()

    if not session_id:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": eid,
            "error": "session_id required",
            "agent_md_loaded": not meta.get("missing"),
        }

    from app.agents.image.agent import run_image_executor_turn
    from app.agents.image.prompts import build_image_executor_system_prompt
    from app.agents.image.tools.schemas import tools_for_mas_image_executor

    set_request_token(token)
    session = await get_or_create_session(session_id, token=token, module="image")
    if task_spec.get("template_id"):
        session["template_id"] = task_spec["template_id"]
    mas_task = get_mas_task(session)
    entry = str(ctx.get("entry") or "").strip().lower()
    hub = entry in ("hub", "hub_autonomous", "cron", "event", "webhook") or bool(
        task_spec.get("hub_entry")
    )
    if hub or bool(task_spec.get("user_confirmed")):
        slots = mas_task.setdefault("slots", {})
        img = slots.get("image")
        if not isinstance(img, dict):
            img = {}
            slots["image"] = img
        img["auto_generate"] = True
        await save_session(session, token=token)
    tools = tools_for_mas_image_executor(eid)
    system_content = build_image_executor_system_prompt(
        session,
        eid,
        mas_task=mas_task,
        module_hint=str(ctx.get("module_hint") or task_spec.get("module") or "image"),
    )
    turn = await run_image_executor_turn(
        session_id=session_id,
        token=token,
        user_text=query,
        tools=tools,
        system_content=system_content,
        executor_id=eid,
        event_callback=event_callback,
        persist_chat=persist_chat,
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
        "mas_native_image": True,
    }
