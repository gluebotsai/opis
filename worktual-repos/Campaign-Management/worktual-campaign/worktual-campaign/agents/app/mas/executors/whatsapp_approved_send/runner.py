"""WhatsApp Approved Send Executor."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.content_native import (
    is_native_content,
    run_native_content_executor,
)
from app.mas.runtime.load_agent_md import package_agent_md

_PACKAGE = Path(__file__).resolve().parent


async def run_whatsapp_approved_send_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    task_spec = dict(ctx.get("task_spec") or {})
    entry = str(ctx.get("entry") or "").strip().lower()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()

    if (query or entry in ("interactive", "sticky_domain")) and is_native_content():
        return await run_native_content_executor(
            ctx, "whatsapp_approved_send", agent_md_dir=_PACKAGE
        )

    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or "").strip()
    from app.agents.whatsapp_approved.agent import run_whatsapp_approved_turn

    turn = await run_whatsapp_approved_turn(
        session_id, token, query, event_callback=ctx.get("event_callback")
    )
    return {
        "ok": True,
        "action_status": "completed",
        "kind": "executor",
        "agent_id": "whatsapp_approved_send",
        "message": turn.get("reply") or "",
        "reply": turn.get("reply") or "",
        "state": turn.get("state"),
        "ui_events": list(turn.get("ui_events") or []),
        "result": turn,
        "agent_md_loaded": not meta.get("missing"),
    }
