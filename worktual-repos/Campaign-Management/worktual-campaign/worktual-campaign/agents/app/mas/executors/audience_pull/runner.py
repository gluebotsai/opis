"""Audience Pull Executor — bounded native CRM loop."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.tool_adapters import dispatch_executor_tool

_PACKAGE = Path(__file__).resolve().parent


async def run_audience_pull_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    task_spec = dict(ctx.get("task_spec") or {})
    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or task_spec.get("session_id") or "").strip()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()
    event_callback = ctx.get("event_callback")
    entry = str(ctx.get("entry") or "").strip().lower()

    tool_name = str(task_spec.get("tool") or task_spec.get("tool_name") or "").strip()
    if tool_name:
        result = await dispatch_executor_tool(
            "audience_pull",
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
            "agent_id": "audience_pull",
            "message": result.get("message") or result.get("error") or "",
            "result": result,
            "ui_events": [result["ui_event"]] if result.get("ui_event") else [],
            "agent_md_loaded": not meta.get("missing"),
        }

    if query or entry in ("interactive", "sticky_domain"):
        from app.mas.executors.shared.audience_native import run_native_audience_executor

        if not session_id:
            return {
                "ok": False,
                "action_status": "failed",
                "kind": "executor",
                "agent_id": "audience_pull",
                "error": "session_id required",
                "agent_md_loaded": not meta.get("missing"),
            }
        return await run_native_audience_executor(
            ctx, "audience_pull", agent_md_dir=_PACKAGE
        )

    return {
        "ok": False,
        "action_status": "needs_input",
        "kind": "executor",
        "agent_id": "audience_pull",
        "message": "Audience pull needs a query or tool call.",
        "agent_md_loaded": not meta.get("missing"),
    }
