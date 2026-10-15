"""Analytics Executor — native MAS loop for reports + events_report."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.executors.shared.optimization_native import (
    is_native_optimization,
    run_native_optimization_executor,
)
from app.mas.runtime.load_agent_md import package_agent_md

_PACKAGE = Path(__file__).resolve().parent


async def run_analytics_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    task_spec = dict(ctx.get("task_spec") or {})
    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or task_spec.get("session_id") or "").strip()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()
    event_callback = ctx.get("event_callback")
    entry = str(ctx.get("entry") or "interactive").strip().lower()

    if not session_id:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": "analytics",
            "error": "session_id required",
            "agent_md_loaded": not meta.get("missing"),
        }

    if (query or entry in ("interactive", "sticky_domain", "hub")) and is_native_optimization():
        return await run_native_optimization_executor(ctx, "analytics", agent_md_dir=_PACKAGE)

    surface = str(task_spec.get("surface") or "reports").strip().lower()
    if surface == "events_report":
        from app.agents.events_report.agent import run_events_report_turn

        turn = await run_events_report_turn(
            session_id, token, query, event_callback=event_callback
        )
    else:
        from app.agents.reports.agent import run_reports_turn

        turn = await run_reports_turn(
            session_id, token, query, event_callback=event_callback
        )

    out = {
        "ok": True,
        "action_status": "completed",
        "kind": "executor",
        "agent_id": "analytics",
        "message": turn.get("reply") or "",
        "reply": turn.get("reply") or "",
        "state": turn.get("state"),
        "ui_events": list(turn.get("ui_events") or []),
        "result": turn,
        "agent_md_loaded": not meta.get("missing"),
    }
    if turn.get("analytics"):
        out["analytics"] = turn["analytics"]
    if turn.get("suggestions"):
        out["suggestions"] = turn["suggestions"]
    return out
