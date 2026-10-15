"""Monitoring Executor — native MAS loop + Hub monitoring agent."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.optimization_native import (
    is_native_optimization,
    run_native_optimization_executor,
)
from app.mas.runtime.load_agent_md import package_agent_md

_PACKAGE = Path(__file__).resolve().parent


async def run_monitoring_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    entry = str(ctx.get("entry") or "").strip().lower()
    task_spec = dict(ctx.get("task_spec") or {})
    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or task_spec.get("session_id") or "").strip()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()
    event_callback = ctx.get("event_callback")

    tool_name = str(task_spec.get("tool") or task_spec.get("tool_name") or "").strip()
    if tool_name:
        from app.mas.runtime.tool_adapters import dispatch_executor_tool

        result = await dispatch_executor_tool(
            "monitoring",
            tool_name,
            dict(task_spec.get("tool_args") or task_spec),
            session_id=session_id,
            token=token,
            event_callback=event_callback,
        )
        ok = bool(result.get("ok"))
        return {
            "ok": ok,
            "action_status": "completed" if ok else "failed",
            "kind": "executor",
            "agent_id": "monitoring",
            "message": result.get("message") or result.get("error") or "",
            "result": result,
            "ui_events": [result["ui_event"]] if result.get("ui_event") else [],
            "agent_md_loaded": not meta.get("missing"),
        }

    if entry in ("hub", "hub_autonomous", "cron", "event", "webhook") or task_spec.get(
        "hub_monitoring"
    ):
        from app.hub_super.sub_agents.monitoring_agent import run_monitoring_agent

        hub_out = await run_monitoring_agent(
            {
                "token": token,
                "organization_id": ctx.get("organization_id")
                or task_spec.get("organization_id")
                or "",
                "session_id": session_id,
                "intent": task_spec.get("intent") or ctx.get("intent") or "campaign_report",
                "payload": {
                    "campaign_id": task_spec.get("campaign_id"),
                    "action": task_spec.get("action"),
                    "channel": task_spec.get("channel"),
                    "reason": task_spec.get("reason"),
                    "session_id": session_id,
                },
            }
        )
        ok = bool(hub_out.get("ok"))
        return {
            "ok": ok,
            "status": hub_out.get("status") or ("completed" if ok else "failed"),
            "action_status": "completed" if ok else "failed",
            "kind": "executor",
            "agent_id": "monitoring",
            "message": hub_out.get("message") or hub_out.get("error") or "",
            "result": hub_out,
            "agent_md_loaded": not meta.get("missing"),
        }

    if (query or entry in ("interactive", "sticky_domain")) and is_native_optimization():
        return await run_native_optimization_executor(ctx, "monitoring", agent_md_dir=_PACKAGE)

    if query or entry in ("interactive", "sticky_domain"):
        from app.agents.monitoring.agent import run_monitoring_turn

        turn = await run_monitoring_turn(
            session_id, token, query, event_callback=event_callback
        )
        return {
            "ok": True,
            "action_status": "completed",
            "kind": "executor",
            "agent_id": "monitoring",
            "message": turn.get("reply") or "",
            "reply": turn.get("reply") or "",
            "state": turn.get("state"),
            "ui_events": list(turn.get("ui_events") or []),
            "result": turn,
            "agent_md_loaded": not meta.get("missing"),
        }

    return {
        "ok": False,
        "action_status": "needs_input",
        "kind": "executor",
        "agent_id": "monitoring",
        "message": "Monitoring executor needs query or hub payload.",
        "agent_md_loaded": not meta.get("missing"),
    }
