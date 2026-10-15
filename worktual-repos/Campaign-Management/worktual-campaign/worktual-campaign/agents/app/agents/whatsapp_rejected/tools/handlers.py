"""Rejected WhatsApp agent tool dispatch — emits ui_events for the FE workspace."""

from __future__ import annotations

from typing import Any


async def handle_set_fields(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    from app.session_store import get_or_create_session, save_session

    session = await get_or_create_session(
        session_id, token=token, module="whatsapp_rejected"
    )
    snap = dict(session.get("whatsapp_template_snapshot") or {})
    for key in ("name", "header", "body", "footer", "buttons"):
        if args.get(key) is not None and str(args.get(key)).strip() != "":
            snap[key] = str(args[key]).strip()
    session["whatsapp_template_snapshot"] = snap
    session["last_action"] = "set_template_fields"
    await save_session(session, token=token)
    return {
        "ok": True,
        "message": args.get("change_summary") or "Template draft updated.",
        "template": snap,
        "ui_event": {
            "type": "whatsapp_template_updated",
            "payload": {"template": snap},
        },
    }


async def handle_submit(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    if not args.get("user_confirmed"):
        return {
            "ok": False,
            "error": "User did not confirm. Ask Submit for Meta approval? (yes/no).",
        }
    from app.session_store import get_or_create_session

    session = await get_or_create_session(
        session_id, token=token, module="whatsapp_rejected"
    )
    snap = session.get("whatsapp_template_snapshot") or {}
    return {
        "ok": True,
        "message": args.get("change_summary")
        or "Submit requested — FE will create a new draft and call Meta.",
        "ui_event": {
            "type": "whatsapp_template_submit",
            "payload": {"template": snap, "source_template_id": snap.get("id")},
        },
    }


async def dispatch_tool(
    name: str,
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback=None,
) -> dict[str, Any]:
    handlers = {
        "SET_TEMPLATE_FIELDS": handle_set_fields,
        "SUBMIT_FOR_APPROVAL": handle_submit,
    }
    fn = handlers.get(name)
    if not fn:
        return {"ok": False, "error": f"Unknown tool {name}"}
    result = await fn(session_id, token, args or {})
    if event_callback and result.get("ui_event"):
        try:
            await event_callback(result["ui_event"])
        except Exception:  # noqa: BLE001
            pass
    return result
