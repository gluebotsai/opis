"""Resolve one Booxoo ticket from assist. Status is always Resolved."""

from __future__ import annotations

from urllib.parse import quote

import httpx

from app.agents.custom_booxoo_bot.tools.base import Tool
from app.config import get_settings
from app.logging import get_logger

logger = get_logger("nlp.custom_booxoo_assist.resolve")

SCHEMA = {
    "type": "function",
    "function": {
        "name": "resolve_ticket",
        "description": (
            "Set one existing ticket to Resolved. Call only when the human agent asked "
            "to resolve that ticket and this session is already verified. "
            "The only status sent is Resolved. Do not use this for any other status."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "ticket_number": {
                    "type": "string",
                    "description": "Ticket number from Latest tickets, including the # when it has one.",
                },
            },
            "required": ["ticket_number"],
        },
    },
}


def resolve_ticket(ctx, ticket_number: str = "", **_kwargs):
    if not ctx.session.authenticated:
        return {
            "ok": False,
            "error": "customer_not_verified",
            "message": (
                "The customer is not verified. Do not say the ticket was resolved. "
                "Ask for verification first."
            ),
        }
    number = _ticket_number(ticket_number)
    if not number:
        return {
            "ok": False,
            "error": "ticket_number_required",
            "message": "The ticket was not resolved. A ticket number is required.",
        }
    api_key = get_settings().custom_booxoo_bot_ticketing_api_key.strip()
    if not api_key:
        return {
            "ok": False,
            "error": "ticketing_not_configured",
            "message": "The ticket was not resolved.",
        }
    base_url = get_settings().custom_booxoo_bot_ticketing_base_url.strip().rstrip("/")
    url = f"{base_url}/api/integration/tickets/{quote(number, safe='')}"
    try:
        response = httpx.put(
            url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={"status": "Resolved"},
            timeout=20.0,
        )
    except httpx.HTTPError:
        logger.warning("booxoo assist resolve failed ticket=%s", number)
        return {"ok": False, "error": "ticket_not_resolved", "message": "The ticket was not resolved."}
    if response.status_code not in (200, 201):
        logger.info(
            "booxoo assist resolve rejected ticket=%s http_status=%s",
            number,
            response.status_code,
        )
        return {
            "ok": False,
            "http_status": response.status_code,
            "error": "ticket_not_resolved",
            "message": "The ticket was not resolved.",
        }
    return {"ok": True, "http_status": response.status_code, "ticketNumber": number, "status": "Resolved"}


def resolve_ticket_tool() -> Tool:
    return Tool(SCHEMA, resolve_ticket)


def _ticket_number(value: str) -> str:
    text = " ".join(str(value or "").split())
    if not text or text.lower() == "none":
        return ""
    if text.startswith("#"):
        return text
    return f"#{text}"
