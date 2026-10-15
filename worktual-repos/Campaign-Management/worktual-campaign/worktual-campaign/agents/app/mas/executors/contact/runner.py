"""Contact Executor — Audience CRM via bounded native MAS loop."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from app.mas.runtime.load_agent_md import package_agent_md
from app.mas.runtime.tool_adapters import dispatch_executor_tool

_PACKAGE = Path(__file__).resolve().parent


def _hub_create_tool_args(task_spec: dict[str, Any]) -> dict[str, Any]:
    args: dict[str, Any] = {
        "user_confirmed": True,
        "first_name": str(task_spec.get("first_name") or "").strip(),
        "change_summary": "Hub Super Agent create contact",
    }
    for key in ("last_name", "email", "phone", "company_name", "city"):
        val = str(task_spec.get(key) or "").strip()
        if val:
            args[key] = val
    return args


async def _run_hub_create_via_executor_tool(
    *,
    ctx: dict[str, Any],
    task_spec: dict[str, Any],
    token: str,
    session_id: str,
    event_callback: Any,
    meta: dict[str, Any],
) -> dict[str, Any]:
    """Hub structured create — Executor dispatches CREATE_CONTACT (full MAS path)."""
    first_name = str(task_spec.get("first_name") or "").strip()
    email = str(task_spec.get("email") or "").strip()
    phone = str(task_spec.get("phone") or "").strip()
    if not first_name:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": "contact",
            "error": "first_name is required",
            "agent_md_loaded": not meta.get("missing"),
        }
    if not email and not phone:
        return {
            "ok": False,
            "action_status": "failed",
            "kind": "executor",
            "agent_id": "contact",
            "error": "email or phone is required",
            "agent_md_loaded": not meta.get("missing"),
        }

    sid = session_id or str(
        task_spec.get("session_id")
        or f"hub-contacts-{uuid.uuid4().hex[:12]}"
    )
    result = await dispatch_executor_tool(
        "contact",
        "CREATE_CONTACT",
        _hub_create_tool_args(task_spec),
        session_id=sid,
        token=token,
        event_callback=event_callback,
    )
    ok = bool(result.get("ok"))
    contact = result.get("contact") if isinstance(result.get("contact"), dict) else {}
    contact_id = str(result.get("contact_id") or contact.get("id") or "").strip()
    ui_events = [result["ui_event"]] if result.get("ui_event") else []
    return {
        "ok": ok,
        "status": "completed" if ok else "failed",
        "action_status": "completed" if ok else "failed",
        "kind": "executor",
        "agent_id": "contact",
        "message": result.get("message") or result.get("error") or "",
        "reply": result.get("message") or result.get("error") or "",
        "result": result,
        "contact_id": contact_id or None,
        "contact": contact or None,
        "session_id": sid,
        "ui_events": ui_events,
        "agent_md_loaded": not meta.get("missing"),
        "mas_hub_create": True,
    }


async def run_contact_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    """
    Audience contact executor:
    - explicit tool in task_spec → tool adapter
    - hub_create fields → CREATE_CONTACT via adapter (after Super → Domain)
    - interactive chat → native bounded CRM loop
    """
    meta = package_agent_md(_PACKAGE)
    entry = str(ctx.get("entry") or "").strip().lower()
    task_spec = dict(ctx.get("task_spec") or {})
    token = str(ctx.get("token") or "").strip()
    session_id = str(ctx.get("session_id") or task_spec.get("session_id") or "").strip()
    query = str(task_spec.get("query") or ctx.get("query") or "").strip()
    event_callback = ctx.get("event_callback")

    tool_name = str(task_spec.get("tool") or task_spec.get("tool_name") or "").strip()
    if tool_name:
        result = await dispatch_executor_tool(
            "contact",
            tool_name,
            dict(task_spec.get("tool_args") or task_spec),
            session_id=session_id,
            token=token,
            event_callback=event_callback,
        )
        ok = bool(result.get("ok"))
        return {
            "ok": ok,
            "status": "completed" if ok else "failed",
            "action_status": "completed" if ok else "failed",
            "kind": "executor",
            "agent_id": "contact",
            "message": result.get("message") or result.get("error") or "",
            "result": result,
            "ui_events": [result["ui_event"]] if result.get("ui_event") else [],
            "agent_md_loaded": not meta.get("missing"),
        }

    if task_spec.get("hub_create"):
        return await _run_hub_create_via_executor_tool(
            ctx=ctx,
            task_spec=task_spec,
            token=token,
            session_id=session_id,
            event_callback=event_callback,
            meta=meta,
        )

    if query or entry in ("interactive", "sticky_domain"):
        from app.mas.executors.shared.audience_native import run_native_audience_executor

        if not session_id:
            return {
                "ok": False,
                "action_status": "failed",
                "kind": "executor",
                "agent_id": "contact",
                "error": "session_id required for contacts chat turn",
                "agent_md_loaded": not meta.get("missing"),
            }
        return await run_native_audience_executor(
            ctx, "contact", agent_md_dir=_PACKAGE
        )

    return {
        "ok": False,
        "action_status": "needs_input",
        "kind": "executor",
        "agent_id": "contact",
        "message": "Contact executor needs query or create fields.",
        "agent_md_loaded": not meta.get("missing"),
    }
