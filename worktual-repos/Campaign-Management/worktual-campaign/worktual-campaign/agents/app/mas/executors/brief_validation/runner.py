"""Brief Validation Executor — native bounded update_campaign_setup loop."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.create_campaign_native import (
    is_native_create_campaign,
    run_native_create_executor,
)
from app.mas.runtime.load_agent_md import package_agent_md

_PACKAGE = Path(__file__).resolve().parent


async def run_brief_validation_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    if is_native_create_campaign():
        return await run_native_create_executor(ctx, "brief_validation", agent_md_dir=_PACKAGE)

    task_spec = dict(ctx.get("task_spec") or {})
    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or "").strip()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()
    event_callback = ctx.get("event_callback")
    from app.agents.create_campaign.agent import run_create_campaign_turn

    if not session_id:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": "brief_validation",
            "error": "session_id required",
            "agent_md_loaded": not meta.get("missing"),
        }
    turn = await run_create_campaign_turn(
        session_id, token, query, event_callback=event_callback
    )
    return {
        "ok": True,
        "action_status": "completed",
        "kind": "executor",
        "agent_id": "brief_validation",
        "message": turn.get("reply") or "",
        "reply": turn.get("reply") or "",
        "state": turn.get("state"),
        "ui_events": list(turn.get("ui_events") or []),
        "result": turn,
        "agent_md_loaded": not meta.get("missing"),
    }
