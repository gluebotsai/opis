"""Template Coach Executor."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.runtime.load_agent_md import package_agent_md

_PACKAGE = Path(__file__).resolve().parent


async def run_template_coach_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    meta = package_agent_md(_PACKAGE)
    task_spec = dict(ctx.get("task_spec") or {})
    from app.agents.template_coach.agent import run_template_coach

    out = await run_template_coach(
        mode=str(task_spec.get("mode") or "assist"),
        channel=str(task_spec.get("channel") or "email"),
        campaign=task_spec.get("campaign") if isinstance(task_spec.get("campaign"), dict) else {},
        fields=task_spec.get("fields") if isinstance(task_spec.get("fields"), dict) else {},
        selected=task_spec.get("selected") if isinstance(task_spec.get("selected"), dict) else None,
        idea_chat=task_spec.get("idea_chat") if isinstance(task_spec.get("idea_chat"), list) else [],
        instruction=task_spec.get("instruction") or task_spec.get("query") or ctx.get("query"),
    )
    ok = bool(out.get("ok", True)) if isinstance(out, dict) else True
    return {
        "ok": ok,
        "action_status": "completed" if ok else "failed",
        "kind": "executor",
        "agent_id": "template_coach",
        "message": str((out or {}).get("walkthrough") or (out or {}).get("message") or ""),
        "result": out,
        "agent_md_loaded": not meta.get("missing"),
    }
