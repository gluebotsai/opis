"""Verified coworker-only mutations for Lola Assist."""

from __future__ import annotations

import hashlib
from typing import Any

from app.agents.custom_booxoo_bot.clients.cdp_store import lookup_customer
from app.agents.custom_booxoo_bot.clients.ticketing import TicketingClient
from app.agents.custom_lola_worktual.tools import (
    _appointment_is_upcoming,
    _live_appointment,
    cancel_crm_appointment,
)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _contact(ctx) -> tuple[str, str, str]:
    email = _text(ctx.session.contact.get("email"))
    phone = _text(ctx.session.contact.get("phone"))
    name = _text(ctx.session.contact.get("name"))
    if not name:
        name = email.split("@")[0] if email else "Customer"
    return name, email, phone


def create_lola_ticket(ctx, issue: str = "", subject: str = "", **_kwargs) -> dict[str, Any]:
    """Create one ticket only for an explicitly verified coworker request."""
    if not ctx.session.authenticated or not ctx.session.customer_found:
        return {
            "ok": False,
            "error": "customer_not_verified",
            "message": "The customer is not verified. The ticket was not created.",
        }
    issue = _text(issue)
    name, email, phone = _contact(ctx)
    missing = []
    if not issue:
        missing.append("issue")
    if not email and not phone:
        missing.append("email_or_phone")
    if missing:
        return {
            "ok": False,
            "error": "missing_fields",
            "missingFields": missing,
            "message": "The ticket was not created because required details are missing.",
        }

    conversation_id = _text(ctx.request.conversation_id)
    issue_key = hashlib.sha256(issue.encode()).hexdigest()[:16]
    status, payload = TicketingClient().create_ticket(
        name=name,
        issue=issue,
        email=email,
        mobile=phone,
        external_ref=conversation_id,
        idempotency_key=f"lola-assist:{conversation_id}:{issue_key}",
        metadata={
            "source": "lola_agent_assist",
            "conversationId": conversation_id,
            "organizationId": str(ctx.request.organization_id),
        },
        subject=_text(subject) or issue[:80],
        channel=str(ctx.request.channel or "webchat"),
    )
    ticket = payload.get("ticket") if isinstance(payload, dict) else None
    if not isinstance(ticket, dict) and isinstance(payload, dict):
        ticket = payload
    ticket = ticket if isinstance(ticket, dict) else {}
    number = _text(
        ticket.get("ticketNumber")
        or ticket.get("ticket_number")
        or ticket.get("ticketId")
        or ticket.get("id")
    )
    ticket_status = _text(ticket.get("status"))
    if status in (200, 201) and (number or ticket_status):
        ctx.session.last_ticket = {"ticketNumber": number, "status": ticket_status}
        return {
            "ok": True,
            "created": True,
            "ticketNumber": number,
            "status": ticket_status or "open",
        }
    if status == 409:
        return {
            "ok": True,
            "created": False,
            "existing": True,
            "ticketNumber": number,
            "status": ticket_status or "existing",
            "message": "A ticket for this request already exists.",
        }
    return {
        "ok": False,
        "error": "ticket_not_created",
        "httpStatus": status,
        "message": "The ticket was not created. Do not tell the customer it exists.",
    }


def cancel_lola_appointment(ctx, email: str = "", **_kwargs) -> dict[str, Any]:
    """Cancel the verified customer's one live CRM appointment."""
    if not ctx.session.authenticated or not ctx.session.customer_found:
        return {
            "ok": False,
            "error": "customer_not_verified",
            "message": "The customer is not verified. The appointment was not cancelled.",
        }
    stored_email = _text(ctx.session.contact.get("email"))
    requested_email = _text(email)
    if requested_email and stored_email and requested_email.lower() != stored_email.lower():
        return {
            "ok": False,
            "error": "email_not_verified",
            "message": "That email is not the verified customer's stored email.",
        }
    target_email = stored_email or requested_email
    if not target_email:
        return {
            "ok": False,
            "error": "email_required",
            "message": "The customer's stored email is required before cancellation.",
        }

    organization_id = str(ctx.request.organization_id)
    record = lookup_customer(organization_id, target_email, "")
    if not record or not record.get("found") or not record.get("cdp_id"):
        return {
            "ok": False,
            "error": "customer_not_found",
            "message": "No Worktual customer was found for that email. Nothing was cancelled.",
        }
    appointment = _live_appointment(str(record["cdp_id"]))
    if not isinstance(appointment, dict):
        return {
            "ok": False,
            "error": "appointment_not_found",
            "message": "No live appointment was found. Nothing was cancelled.",
        }
    if not _appointment_is_upcoming(appointment):
        return {
            "ok": False,
            "error": "appointment_not_upcoming",
            "message": "The appointment is not upcoming. Nothing was cancelled.",
        }
    appointment_id = _text(appointment.get("id"))
    if not appointment_id:
        return {
            "ok": False,
            "error": "appointment_id_missing",
            "message": "The live appointment could not be identified. Nothing was cancelled.",
        }
    response = cancel_crm_appointment(appointment_id)
    if response.status_code not in (200, 204):
        return {
            "ok": False,
            "error": "appointment_not_cancelled",
            "httpStatus": response.status_code,
            "message": "The appointment was not cancelled.",
        }
    payload: dict[str, Any] = {}
    try:
        payload = response.json() if response.content else {}
    except ValueError:
        payload = {}
    return {
        "ok": True,
        "cancelled": True,
        "appointmentId": appointment_id,
        "startsAt": appointment.get("startsAt"),
        "data": payload,
    }
