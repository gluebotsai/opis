"""Audience-scoped tools for Lola Assist."""

from __future__ import annotations

import secrets
from typing import Any

from app.agents.custom_booxoo_bot.clients.cdp_store import lookup_customer
from app.agents.custom_booxoo_bot.clients.ticketing import TicketingClient
from app.agents.custom_booxoo_bot.tools.base import Tool
from app.agents.custom_lola_assist.actions import (
    cancel_lola_appointment,
    create_lola_ticket,
)
from app.agents.custom_lola_worktual.tools import (
    get_sales_knowledge,
    get_service_knowledge,
)


def _schema(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties,
                "required": required,
                "additionalProperties": False,
            },
        },
    }


def lookup_worktual_customer(ctx, email: str = "", phone: str = "", **_kwargs) -> dict:
    email = str(email or "").strip()
    phone = str(phone or "").strip()
    if not email and not phone:
        return {
            "ok": False,
            "found": False,
            "error": "email_or_phone_required",
            "message": "Ask for an email or phone used with Worktual.",
        }
    record = lookup_customer(str(ctx.request.organization_id), email, phone)
    if record is None:
        return {
            "ok": False,
            "found": False,
            "error": "customer_store_unavailable",
        }
    if not record.get("found"):
        ctx.session.customer_found = False
        return {
            "ok": False,
            "found": False,
            "error": "customer_not_found",
            "message": "No Worktual customer was found for that email or phone.",
        }
    customer = record.get("customer") if isinstance(record.get("customer"), dict) else {}
    found_email = str(customer.get("email") or email or "").strip()
    found_phone = str(customer.get("phone") or phone or "").strip()
    name = str(customer.get("name") or "").strip()
    ctx.session.customer_found = True
    ctx.session.cdp_id = str(record.get("cdp_id") or "")
    if found_email:
        ctx.session.contact["email"] = found_email
        ctx.session.stored_emails = (found_email,)
    if found_phone:
        ctx.session.contact["phone"] = found_phone
        ctx.session.stored_phones = (found_phone,)
    if name:
        ctx.session.contact["name"] = name
    return {
        "ok": True,
        "found": True,
        "customer": {
            "name": name,
            "email": found_email,
            "phone": found_phone,
        },
    }


def send_worktual_otp(ctx, channel: str = "", **_kwargs) -> dict[str, Any]:
    if ctx.session.authenticated:
        return {"ok": True, "sent": False, "alreadyAuthenticated": True}
    if not ctx.session.customer_found:
        return {
            "ok": False,
            "sent": False,
            "error": "customer_not_found",
            "message": "Find the Worktual customer before sending a code.",
        }
    if ctx.session.otp_code:
        return {
            "ok": True,
            "sent": False,
            "alreadySent": True,
            "channel": ctx.session.otp_channel,
            "destination": ctx.session.otp_destination,
        }
    normalized = str(channel or "").strip().lower()
    if normalized == "mobile":
        normalized = "sms"
    if normalized not in {"email", "sms"}:
        return {
            "ok": False,
            "sent": False,
            "error": "medium_required",
            "available": [
                medium
                for medium, values in (
                    ("email", ctx.session.stored_emails),
                    ("sms", ctx.session.stored_phones),
                )
                if values
            ],
        }
    destination = (
        ctx.session.stored_emails[0]
        if normalized == "email" and ctx.session.stored_emails
        else ctx.session.stored_phones[0]
        if normalized == "sms" and ctx.session.stored_phones
        else ""
    )
    if not destination:
        return {
            "ok": False,
            "sent": False,
            "error": "destination_missing",
        }
    code = f"{secrets.randbelow(900000) + 100000}"
    name = str(ctx.session.contact.get("name") or "")
    if normalized == "email":
        from app.agents.custom_lola_worktual.tools import send_otp_email

        sent = send_otp_email(destination, code, name)
    else:
        from app.agents.custom_lola_worktual.tools import send_otp_sms

        sent = send_otp_sms(destination, code, name)
    if sent != "success":
        return {
            "ok": False,
            "sent": False,
            "error": "otp_send_failed",
        }
    ctx.session.otp_code = code
    ctx.session.otp_channel = normalized
    ctx.session.otp_destination = destination
    return {
        "ok": True,
        "sent": True,
        "channel": normalized,
        "destination": destination,
    }


def verify_worktual_otp(ctx, otp: str = "", **_kwargs) -> dict[str, Any]:
    if ctx.session.authenticated:
        return {"ok": True, "authenticated": True, "alreadyAuthenticated": True}
    if not ctx.session.otp_code:
        return {"ok": False, "authenticated": False, "error": "otp_not_sent"}
    if str(otp or "").strip() != str(ctx.session.otp_code):
        return {"ok": False, "authenticated": False, "error": "invalid_otp"}
    ctx.session.authenticated = True
    ctx.session.otp_code = None
    return {"ok": True, "authenticated": True}


def get_lola_ticket_status(ctx, ticket_id: str = "", **_kwargs) -> dict[str, Any]:
    if not ctx.session.authenticated or not ctx.session.customer_found:
        return {
            "ok": False,
            "error": "customer_not_verified",
            "message": "Verification is required before ticket lookup.",
        }
    email = str(ctx.session.contact.get("email") or "")
    phone = str(ctx.session.contact.get("phone") or "")
    status, payload = TicketingClient().lookup(email=email, mobile=phone)
    tickets = payload.get("tickets") if isinstance(payload, dict) else []
    tickets = tickets if isinstance(tickets, list) else []
    requested = str(ticket_id or "").strip()
    if requested:
        tickets = [
            ticket
            for ticket in tickets
            if isinstance(ticket, dict)
            and str(
                ticket.get("ticketNumber")
                or ticket.get("ticket_id")
                or ticket.get("id")
                or ""
            )
            == requested
        ]
    return {
        "ok": status == 200,
        "tickets": tickets,
        "empty": not tickets,
        "httpStatus": status,
    }


def search_worktual_sales_knowledge(ctx, query: str, **_kwargs) -> dict:
    result = get_sales_knowledge(query, organization_id=str(ctx.request.organization_id))
    return {
        **result,
        "ok": result.get("status") == "success" and bool(str(result.get("context") or "").strip()),
    }


def search_worktual_service_knowledge(ctx, query: str, **_kwargs) -> dict:
    result = get_service_knowledge(query, organization_id=str(ctx.request.organization_id))
    return {
        **result,
        "ok": result.get("status") == "success" and bool(str(result.get("context") or "").strip()),
    }


def build_lola_assist_tools(audience: str = "customer") -> list[Tool]:
    tools = [
        Tool(
            _schema(
                "search_worktual_sales_knowledge",
                "Search approved Worktual business knowledge. Use only returned text.",
                {"query": {"type": "string"}},
                ["query"],
            ),
            search_worktual_sales_knowledge,
        ),
        Tool(
            _schema(
                "lookup_worktual_customer",
                "Find a Worktual customer by an email or phone they provided.",
                {
                    "email": {"type": "string"},
                    "phone": {"type": "string"},
                },
                [],
            ),
            lookup_worktual_customer,
        ),
        Tool(
            _schema(
                "get_lola_ticket_status",
                "Read the verified customer's ticket status.",
                {"ticket_id": {"type": "string"}},
                [],
            ),
            get_lola_ticket_status,
        ),
    ]
    if audience == "agent":
        tools.extend(
            [
                Tool(
                    _schema(
                        "send_worktual_otp",
                        "Send one OTP after customer lookup. Call only when the support agent requests verification.",
                        {"channel": {"type": "string", "enum": ["email", "sms"]}},
                        ["channel"],
                    ),
                    send_worktual_otp,
                ),
                Tool(
                    _schema(
                        "verify_worktual_otp",
                        "Verify the OTP supplied to the support agent.",
                        {"otp": {"type": "string"}},
                        ["otp"],
                    ),
                    verify_worktual_otp,
                ),
                Tool(
                    _schema(
                        "create_lola_ticket",
                        "Create one ticket only when the support agent explicitly asks and the customer is verified.",
                        {
                            "issue": {"type": "string"},
                            "subject": {"type": "string"},
                        },
                        ["issue"],
                    ),
                    create_lola_ticket,
                ),
                Tool(
                    _schema(
                        "cancel_lola_appointment",
                        "Cancel the verified customer's live appointment only when the support agent explicitly asks.",
                        {"email": {"type": "string"}},
                        [],
                    ),
                    cancel_lola_appointment,
                ),
            ]
        )
    return tools
