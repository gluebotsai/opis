"""Tool handlers for form design agent."""

from __future__ import annotations

import uuid
from typing import Any

from app.agents.forms.intake import (
    build_campaign_handoff_query,
    queue_campaign_handoff,
)
from app.agents.routing import dispatch_route_to_module, route_to_module_result
from app.session_store import get_or_create_session, save_session

_FIELD_TYPES = frozenset({"text", "email", "tel", "textarea"})


def _normalize_fields(raw: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for idx, row in enumerate(raw or []):
        if not isinstance(row, dict):
            continue
        ftype = str(row.get("type") or "text").strip().lower()
        if ftype not in _FIELD_TYPES:
            ftype = "text"
        placeholder = (
            str(row.get("placeholder")).strip()
            if row.get("placeholder")
            else None
        )
        default = (
            row.get("defaultValue")
            or row.get("default_value")
            or row.get("value")
        )
        default_value = (
            str(default).strip() if default is not None and str(default).strip() else None
        )
        item: dict[str, Any] = {
            "id": str(row.get("id") or f"field-{idx}-{uuid.uuid4().hex[:6]}"),
            "label": str(row.get("label") or "Field").strip() or "Field",
            "type": ftype,
            "required": bool(row.get("required")),
            "placeholder": placeholder or default_value,
        }
        if default_value:
            item["defaultValue"] = default_value
        out.append(item)
    return out


def _normalize_theme(raw: Any, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    base = dict(existing or {})
    if not isinstance(raw, dict):
        return base
    for key in (
        "primaryColor",
        "backgroundColor",
        "surfaceColor",
        "textColor",
        "mutedColor",
        "buttonText",
        "logoUrl",
        "fontFamily",
    ):
        if key in raw and raw[key] is not None:
            base[key] = str(raw[key])
    aliases = {
        "primary_color": "primaryColor",
        "background_color": "backgroundColor",
        "surface_color": "surfaceColor",
        "text_color": "textColor",
        "muted_color": "mutedColor",
        "button_text": "buttonText",
        "logo_url": "logoUrl",
        "font_family": "fontFamily",
    }
    for src, dest in aliases.items():
        if src in raw and raw[src] is not None:
            base[dest] = str(raw[src])
    if "borderRadiusPx" in raw or "border_radius_px" in raw:
        try:
            base["borderRadiusPx"] = float(
                raw.get("borderRadiusPx", raw.get("border_radius_px"))
            )
        except (TypeError, ValueError):
            pass
    if "spacingScale" in raw or "spacing_scale" in raw:
        try:
            base["spacingScale"] = float(
                raw.get("spacingScale", raw.get("spacing_scale"))
            )
        except (TypeError, ValueError):
            pass
    return base


def default_form_design() -> dict[str, Any]:
    return {
        "title": "Book a product demo",
        "description": "B2B demo request — work email and company required.",
        "thank_you_message": "Thanks — our team will reach out shortly.",
        "fields": [
            {
                "id": "field-name",
                "label": "Full name",
                "type": "text",
                "required": True,
                "placeholder": "Jane Smith",
            },
            {
                "id": "field-email",
                "label": "Work email",
                "type": "email",
                "required": True,
                "placeholder": "jane@company.com",
            },
            {
                "id": "field-company",
                "label": "Company",
                "type": "text",
                "required": True,
                "placeholder": "Acme Inc.",
            },
            {
                "id": "field-role",
                "label": "Role",
                "type": "text",
                "required": False,
                "placeholder": "Marketing manager",
            },
        ],
        "theme": {
            "primaryColor": "#5b4bdb",
            "backgroundColor": "#f3f4f6",
            "surfaceColor": "#ffffff",
            "textColor": "#111827",
            "mutedColor": "#6b7280",
            "buttonText": "Request demo",
            "logoUrl": "",
            "borderRadiusPx": 12,
            "spacingScale": 1,
            "fontFamily": "Inter, system-ui, sans-serif",
        },
    }


async def _emit_and_save(
    session: dict[str, Any],
    token: str,
    current: dict[str, Any],
    change_summary: str,
    event_callback=None,
    form_event_id: Any = None,
) -> dict[str, Any]:
    session["form_design"] = current
    if form_event_id:
        session["form_event_id"] = session.get("form_event_id") or form_event_id
    session["stage"] = "form_designed"

    payload = {
        "title": current.get("title"),
        "description": current.get("description"),
        "thank_you_message": current.get("thank_you_message"),
        "fields": current.get("fields") or [],
        "theme": current.get("theme") or {},
        "change_summary": change_summary,
    }
    ui_event = {"type": "form_design", "payload": payload}
    if event_callback:
        await event_callback(ui_event)

    await save_session(session, token=token)

    return {
        "ok": True,
        "field_count": len(payload["fields"]),
        "title": payload.get("title"),
        "change_summary": change_summary,
        "ui_event": ui_event,
    }


async def apply_form_design(
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback=None,
) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token, module="forms")
    current = dict(session.get("form_design") or default_form_design())

    if isinstance(args.get("title"), str) and args["title"].strip():
        current["title"] = args["title"].strip()
    if isinstance(args.get("description"), str):
        current["description"] = args["description"].strip()
    thank = args.get("thank_you_message") or args.get("thankYouMessage")
    if isinstance(thank, str):
        current["thank_you_message"] = thank.strip()

    raw_fields = args.get("fields") or args.get("formFields")
    if isinstance(raw_fields, list) and raw_fields:
        current["fields"] = _normalize_fields(raw_fields)

    theme = _normalize_theme(args.get("theme"), current.get("theme") or {})
    button = args.get("button_text") or args.get("buttonText")
    if isinstance(button, str) and button.strip():
        theme["buttonText"] = button.strip()
    if theme:
        current["theme"] = theme

    change_summary = str(args.get("change_summary") or "").strip()
    return await _emit_and_save(
        session,
        token,
        current,
        change_summary,
        event_callback=event_callback,
        form_event_id=args.get("form_event_id"),
    )


async def update_form_theme(
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback=None,
) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token, module="forms")
    current = dict(session.get("form_design") or default_form_design())
    theme = _normalize_theme(args.get("theme"), current.get("theme") or {})
    button = args.get("button_text") or args.get("buttonText")
    if isinstance(button, str) and button.strip():
        theme["buttonText"] = button.strip()
    current["theme"] = theme
    change_summary = str(args.get("change_summary") or "").strip() or (
        "Updated form colors / style."
    )
    return await _emit_and_save(
        session,
        token,
        current,
        change_summary,
        event_callback=event_callback,
        form_event_id=args.get("form_event_id"),
    )


async def update_form_fields(
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback=None,
) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token, module="forms")
    current = dict(session.get("form_design") or default_form_design())

    if isinstance(args.get("title"), str) and args["title"].strip():
        current["title"] = args["title"].strip()
    if isinstance(args.get("description"), str):
        current["description"] = args["description"].strip()
    thank = args.get("thank_you_message") or args.get("thankYouMessage")
    if isinstance(thank, str):
        current["thank_you_message"] = thank.strip()

    raw_fields = args.get("fields") or args.get("formFields")
    if isinstance(raw_fields, list) and raw_fields:
        current["fields"] = _normalize_fields(raw_fields)

    change_summary = str(args.get("change_summary") or "").strip() or (
        "Updated form fields / copy."
    )
    return await _emit_and_save(
        session,
        token,
        current,
        change_summary,
        event_callback=event_callback,
        form_event_id=args.get("form_event_id"),
    )


async def route_to_create_campaign(
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback=None,
) -> dict[str, Any]:
    session = await get_or_create_session(session_id, token=token, module="forms")
    campaign_goal = str(args.get("campaign_goal") or "").strip()
    user_confirmed = bool(args.get("user_confirmed"))
    change_summary = str(args.get("change_summary") or "").strip()

    if not user_confirmed:
        queued = queue_campaign_handoff(session, campaign_goal=campaign_goal)
        await save_session(session, token=token)
        if not queued.get("ok"):
            return queued
        return {
            **queued,
            "change_summary": change_summary
            or "Handoff queued — awaiting user confirmation in chat.",
        }

    readiness_check = queue_campaign_handoff(session, campaign_goal=campaign_goal)
    if not readiness_check.get("ok"):
        return readiness_check

    query = build_campaign_handoff_query(session, campaign_goal=campaign_goal)
    title = str((session.get("form_design") or {}).get("title") or "your form").strip()
    result = route_to_module_result(
        module="create_campaign",
        query=query,
        change_summary=change_summary
        or f'Opening Create campaign for "{title}". You\'ll continue there with this form linked.',
    )
    session["pending_route"] = None
    await save_session(session, token=token)
    if event_callback and result.get("ui_event"):
        await event_callback(result["ui_event"])
    return result


async def dispatch_tool(
    name: str,
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback=None,
) -> dict[str, Any]:
    # Main agent → internal specialists (lazy import avoids circular deps).
    if name == "RUN_THEME_SPECIALIST":
        from app.agents.forms.specialists import run_theme_specialist

        return await run_theme_specialist(
            session_id,
            token,
            str(args.get("instruction") or ""),
            event_callback=event_callback,
        )
    if name == "RUN_FIELDS_SPECIALIST":
        from app.agents.forms.specialists import run_fields_specialist

        return await run_fields_specialist(
            session_id,
            token,
            str(args.get("instruction") or ""),
            event_callback=event_callback,
        )
    if name == "RUN_DESIGN_SPECIALIST":
        from app.agents.forms.specialists import run_design_specialist

        return await run_design_specialist(
            session_id,
            token,
            str(args.get("instruction") or ""),
            event_callback=event_callback,
        )
    # Direct apply (used by specialists / tests).
    if name == "UPDATE_FORM_THEME":
        return await update_form_theme(
            session_id, token, args, event_callback=event_callback
        )
    if name == "UPDATE_FORM_FIELDS":
        return await update_form_fields(
            session_id, token, args, event_callback=event_callback
        )
    if name == "APPLY_FORM_DESIGN":
        return await apply_form_design(
            session_id, token, args, event_callback=event_callback
        )
    if name == "ROUTE_TO_CREATE_CAMPAIGN":
        return await route_to_create_campaign(
            session_id, token, args, event_callback=event_callback
        )
    if name == "ROUTE_TO_MODULE":
        result = await dispatch_route_to_module(args)
        if event_callback and result.get("ui_event"):
            await event_callback(result["ui_event"])
        return result
    return {"ok": False, "error": f"Unknown tool: {name}"}

