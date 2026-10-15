"""Shared execution and parity fallback for Form specialist executors."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Awaitable, Callable

from app.mas.runtime.load_agent_md import package_agent_md
from app.session_store import get_or_create_session, public_state

SpecialistFn = Callable[..., Awaitable[dict[str, Any]]]

_EXECUTOR_ROOT = Path(__file__).resolve().parents[1]


async def run_form_specialist_executor(
    agent_id: str,
    specialist: SpecialistFn,
    ctx: dict[str, Any],
) -> dict[str, Any]:
    """Run one Form specialist, retaining the legacy chat fallback for parity."""
    meta = package_agent_md(_EXECUTOR_ROOT / agent_id)
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
            "agent_id": agent_id,
            "error": "session_id required",
            "agent_md_loaded": not meta.get("missing"),
        }

    if task_spec.get("full_forms_turn"):
        return await _forms_turn_parity(
            agent_id,
            meta,
            session_id,
            token,
            query,
            event_callback,
        )

    if query:
        result = await specialist(
            session_id,
            token,
            query,
            event_callback=event_callback,
        )
        if result.get("ok"):
            session = await get_or_create_session(
                session_id,
                token=token,
                module="forms",
            )
            reply = (
                str(
                    result.get("change_summary")
                    or result.get("message")
                    or ""
                ).strip()
                or "Updated the form."
            )
            ui_events = [result["ui_event"]] if result.get("ui_event") else []
            return {
                "ok": True,
                "action_status": "completed",
                "kind": "executor",
                "agent_id": agent_id,
                "message": reply,
                "reply": reply,
                "state": public_state(session),
                "ui_events": ui_events,
                "result": result,
                "agent_md_loaded": not meta.get("missing"),
                "mas_specialist": True,
            }

    return await _forms_turn_parity(
        agent_id,
        meta,
        session_id,
        token,
        query,
        event_callback,
    )


async def _forms_turn_parity(
    agent_id: str,
    meta: dict[str, Any],
    session_id: str,
    token: str,
    query: str,
    event_callback: Any,
) -> dict[str, Any]:
    from app.agents.forms.agent import run_forms_turn

    turn = await run_forms_turn(
        session_id,
        token,
        query,
        event_callback=event_callback,
    )
    return {
        "ok": True,
        "action_status": "completed",
        "kind": "executor",
        "agent_id": agent_id,
        "message": turn.get("reply") or "",
        "reply": turn.get("reply") or "",
        "state": turn.get("state"),
        "ui_events": list(turn.get("ui_events") or []),
        "result": turn,
        "agent_md_loaded": not meta.get("missing"),
        "mas_specialist": False,
    }
