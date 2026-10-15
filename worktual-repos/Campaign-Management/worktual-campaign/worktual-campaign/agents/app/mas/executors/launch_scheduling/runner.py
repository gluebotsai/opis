"""Launch/Scheduling Executor — Hub on-demand + native launch_campaign loop."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.create_campaign_native import (
    is_native_create_campaign,
    run_native_create_executor,
)
from app.mas.runtime.load_agent_md import package_agent_md

_PACKAGE = Path(__file__).resolve().parent


async def run_launch_scheduling_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    entry = str(ctx.get("entry") or "").strip().lower()
    task_spec = dict(ctx.get("task_spec") or {})
    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or "").strip()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()
    event_callback = ctx.get("event_callback")

    if entry in ("hub", "hub_autonomous", "cron", "event", "webhook") or task_spec.get("hub_on_demand"):
        from app.hub_super.sub_agents.on_demand_agent import run_on_demand_agent

        hub_out = await run_on_demand_agent(
            {
                "token": token,
                "organization_id": ctx.get("organization_id") or task_spec.get("organization_id") or "",
                "session_id": session_id,
                "intent": task_spec.get("intent") or "on_demand_send",
                "payload": dict(task_spec.get("payload") or task_spec),
            }
        )
        ok = bool(hub_out.get("ok"))
        return {
            "ok": ok,
            "status": hub_out.get("status") or ("completed" if ok else "failed"),
            "action_status": "completed" if ok else "failed",
            "kind": "executor",
            "agent_id": "launch_scheduling",
            "message": hub_out.get("message") or hub_out.get("error") or "",
            "result": hub_out,
            "agent_md_loaded": not meta.get("missing"),
        }

    if is_native_create_campaign():
        return await run_native_create_executor(ctx, "launch_scheduling", agent_md_dir=_PACKAGE)

    from app.agents.create_campaign.agent import run_create_campaign_turn

    if not session_id:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": "launch_scheduling",
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
        "agent_id": "launch_scheduling",
        "message": turn.get("reply") or "",
        "reply": turn.get("reply") or "",
        "state": turn.get("state"),
        "ui_events": list(turn.get("ui_events") or []),
        "result": turn,
        "agent_md_loaded": not meta.get("missing"),
    }
