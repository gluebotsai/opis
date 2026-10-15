"""Save customer-provided contact fields for custom_booxoo_bot."""

from __future__ import annotations

import httpx

from app.agents.custom_booxoo_bot.tools.base import Tool
from app.config import get_settings

_FIELDS = (
    "email",
    "phone",
    "firstName",
    "lastName",
    "displayName",
    "company",
    "city",
    "country",
)


def _chat_requires_verification(ctx) -> bool:
    channel = str(getattr(ctx.request, "channel", "") or "").strip().lower()
    if channel == "email":
        return False
    return bool(ctx.session.registered_customer) and not bool(ctx.session.authenticated)


def contact_enrich(ctx, confirmedFields=None, **kwargs):
    if _chat_requires_verification(ctx):
        contact = ctx.session.contact
        available = []
        if contact.get("email"):
            available.append("email")
        if contact.get("phone"):
            available.append("sms")
        return {
            "ok": False,
            "error": "verification_required",
            "appliedFields": [],
            "requiresConfirmation": [],
            "availableMediums": available,
            "message": (
                "This customer is already registered. Verify them once with OTP "
                "before changing contact details."
            ),
        }
    fields: dict[str, str] = {}
    for key in _FIELDS:
        value = kwargs.get(key)
        if isinstance(value, str) and value.strip():
            fields[key] = value.strip()
    confirmed = list(dict.fromkeys(confirmedFields or []))
    pending = getattr(ctx.session, "pending_contact_fields", {})
    for field in confirmed:
        if field not in fields or pending.get(field) != fields[field]:
            return {
                "ok": False,
                "error": "confirmation_mismatch",
                "appliedFields": [],
                "requiresConfirmation": list(pending),
            }
    organization_id = str(ctx.request.organization_id or "")
    conversation_id = str(ctx.request.conversation_id or ctx.request.session_id or "")
    if not organization_id or not conversation_id:
        return {
            "ok": False,
            "error": "missing_conversation_context",
            "appliedFields": [],
            "requiresConfirmation": [],
        }
    if not fields:
        return {
            "ok": False,
            "error": "no_contact_fields",
            "appliedFields": [],
            "requiresConfirmation": [],
        }

    settings = get_settings()
    headers = {
        "accept": "application/json",
        "content-type": "application/json",
        "x-tenant-id": organization_id,
    }
    if settings.internal_service_key:
        headers["x-internal-service-key"] = settings.internal_service_key
    try:
        response = httpx.post(
            (
                f"{settings.cc_core_url.rstrip('/')}/internal/v1/conversations/"
                f"{conversation_id}/contact/enrich"
            ),
            headers=headers,
            json={"contactEntities": fields, "confirmedFields": confirmed},
            timeout=settings.cc_core_timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError:
        return {
            "ok": False,
            "error": "contact_enrichment_unavailable",
            "appliedFields": [],
            "requiresConfirmation": [],
        }
    except ValueError:
        return {
            "ok": False,
            "error": "invalid_contact_enrichment_response",
            "appliedFields": [],
            "requiresConfirmation": [],
        }

    result = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(result, dict):
        return {
            "ok": False,
            "error": "empty_contact_enrichment_result",
            "appliedFields": [],
            "requiresConfirmation": [],
        }

    contact = result.get("contact")
    if isinstance(contact, dict):
        _apply_saved_contact(
            ctx,
            contact,
            result.get("appliedFields") or [],
            result.get("canonicalContactId"),
        )
    requires_confirmation = result.get("requiresConfirmation") or []
    if requires_confirmation:
        ctx.session.pending_contact_fields = {
            field: fields[field]
            for field in requires_confirmation
            if field in fields
        }
    elif confirmed:
        ctx.session.pending_contact_fields = {}

    return {
        "ok": True,
        "outcome": result.get("outcome"),
        "canonicalContactId": result.get("canonicalContactId"),
        "appliedFields": result.get("appliedFields") or [],
        "skippedFields": result.get("skippedFields") or [],
        "requiresConfirmation": result.get("requiresConfirmation") or [],
        "contact": contact,
    }


def _apply_saved_contact(
    ctx,
    contact: dict,
    applied_fields: list[str],
    canonical_contact_id,
) -> None:
    name = " ".join(
        part
        for part in (
            str(contact.get("firstName") or contact.get("first_name") or "").strip(),
            str(contact.get("lastName") or contact.get("last_name") or "").strip(),
        )
        if part
    )
    email = contact.get("primaryEmail") or contact.get("email") or ""
    phone = contact.get("primaryPhone") or contact.get("phone") or ""
    if name:
        ctx.session.contact["name"] = name
    if email:
        ctx.session.contact["email"] = str(email).strip()
    if phone:
        ctx.session.contact["phone"] = str(phone).strip()
    if canonical_contact_id:
        ctx.session.cdp_id = str(canonical_contact_id)
    if not ctx.session.registered_customer:
        ctx.session.profile_created_here = True
    if {"email", "phone"}.intersection(applied_fields):
        ctx.session.otp_code = None
        ctx.session.otp_channel = None
        ctx.session.otp_destination = None


def contact_enrich_tool() -> Tool:
    return Tool(
        {
            "type": "function",
            "function": {
                "name": "contact_enrich",
                "description": (
                    "Save contact details the customer explicitly provided. "
                    "An anonymous visitor can be created and edited. "
                    "An existing customer returns verification_required until one OTP succeeds in this session. "
                    "After that, send confirmedFields only after the customer approves replacing values on file. "
                    "The result reports appliedFields, skippedFields, and requiresConfirmation."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "email": {"type": "string"},
                        "phone": {"type": "string"},
                        "firstName": {"type": "string"},
                        "lastName": {"type": "string"},
                        "displayName": {"type": "string"},
                        "company": {"type": "string"},
                        "city": {"type": "string"},
                        "country": {"type": "string"},
                        "confirmedFields": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": [],
                },
            },
        },
        contact_enrich,
    )
