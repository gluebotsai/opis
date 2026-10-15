"""Contacts Agent — create contact from hub fields (no chat clarification)."""

from __future__ import annotations

import uuid
from typing import Any

from app.agents.contacts.tools.handlers import handle_create

SKILL_ID = "contacts"


async def run_contacts_agent(ctx: dict[str, Any]) -> dict[str, Any]:
    """Create a contact. Hub task implies confirmation (user_confirmed=true)."""
    token = str(ctx.get("token") or "").strip()
    payload = ctx.get("payload") if isinstance(ctx.get("payload"), dict) else {}
    organization_id = str(ctx.get("organization_id") or "").strip()

    if not token:
        return {
            "ok": False,
            "skill": SKILL_ID,
            "status": "failed",
            "error": "token required",
        }

    first_name = str(payload.get("first_name") or "").strip()
    last_name = str(payload.get("last_name") or "").strip()
    email = str(payload.get("email") or "").strip()
    phone = str(payload.get("phone") or "").strip()
    company_name = str(payload.get("company_name") or "").strip()
    city = str(payload.get("city") or "").strip()

    if not first_name:
        return {
            "ok": False,
            "skill": SKILL_ID,
            "status": "failed",
            "error": "first_name is required",
            "errors": [
                {"code": "MISSING_FIRST_NAME", "field": "first_name"},
            ],
        }
    if not email and not phone:
        return {
            "ok": False,
            "skill": SKILL_ID,
            "status": "failed",
            "error": "email or phone is required",
            "errors": [
                {"code": "MISSING_IDENTITY", "field": "email|phone"},
            ],
        }

    session_id = str(
        payload.get("session_id")
        or ctx.get("session_id")
        or f"hub-contacts-{organization_id or 'org'}-{uuid.uuid4().hex[:12]}"
    )

    args: dict[str, Any] = {
        "user_confirmed": True,
        "first_name": first_name,
        "change_summary": "Hub Super Agent create contact",
    }
    if last_name:
        args["last_name"] = last_name
    if email:
        args["email"] = email
    if phone:
        args["phone"] = phone
    if company_name:
        args["company_name"] = company_name
    if city:
        args["city"] = city

    result = await handle_create(session_id, token, args)
    ok = bool(result.get("ok"))
    contact = result.get("contact") if isinstance(result.get("contact"), dict) else {}
    contact_id = str(
        result.get("contact_id") or contact.get("id") or ""
    ).strip()

    return {
        "ok": ok,
        "skill": SKILL_ID,
        "status": "ok" if ok else "failed",
        "error": None if ok else (result.get("error") or "create contact failed"),
        "contact_id": contact_id or None,
        "contact": contact or None,
        "session_id": session_id,
        "message": result.get("message"),
        "raw": result if not ok else None,
    }
