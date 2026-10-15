"""Create a Booxoo ticket after the human agent confirms the proposal."""

from __future__ import annotations

from typing import Any

from app.agents.custom_booxoo_assist.assist import assist_session
from app.agents.custom_booxoo_bot.clients.ticketing import TicketingClient
from app.agents.custom_booxoo_bot.contact import usable_email, usable_phone
from app.agents.custom_booxoo_bot.tools.ticketing import (
    _subject_from,
    _ticket_fields,
    _ticket_label,
)

_client = TicketingClient()


def _text(value: Any) -> str:
    return str(value or "").strip()


def create_confirmed_ticket(
    *,
    organization_id: str,
    conversation_id: str,
    collected_inputs: dict[str, Any],
) -> dict[str, Any]:
    name = _text(collected_inputs.get("name"))
    issue = _text(collected_inputs.get("issue") or collected_inputs.get("description"))
    email = usable_email(_text(collected_inputs.get("email")))
    mobile = usable_phone(_text(collected_inputs.get("phone") or collected_inputs.get("mobile")))
    order_id = _text(collected_inputs.get("orderId") or collected_inputs.get("order_id"))
    product_id = _text(collected_inputs.get("productId") or collected_inputs.get("product_id"))
    missing = []
    if not name:
        missing.append("name")
    if not issue:
        missing.append("issue")
    if not email and not mobile:
        missing.append("email_or_phone")
    if missing:
        return {"ok": False, "error": "missing_fields", "missingFields": missing}

    references = []
    if order_id:
        references.append({"type": "order", "id": order_id})
    if product_id:
        references.append({"type": "product", "id": product_id})
    metadata = {
        "source": "agent_assist",
        "conversationId": conversation_id,
        "organizationId": organization_id,
    }
    if order_id:
        metadata["orderId"] = order_id
    if product_id:
        metadata["productId"] = product_id
    status, payload = _client.create_ticket(
        name=name,
        issue=issue,
        email=email,
        mobile=mobile,
        external_ref=conversation_id,
        metadata=metadata,
        subject=_subject_from(issue, _text(collected_inputs.get("subject"))),
        references=references or None,
    )
    fields = _ticket_fields(payload) if isinstance(payload, dict) else {}
    number = _ticket_label(fields.get("ticketNumber") or fields.get("ticketId"))
    if status in (200, 201, 409) and (number or fields.get("status")):
        session = assist_session(organization_id, conversation_id)
        session.last_ticket = {key: value for key, value in fields.items() if value}
        return {
            "ok": True,
            "httpStatus": status,
            "ticketId": fields.get("ticketId"),
            "ticketNumber": number or fields.get("ticketNumber"),
            "status": fields.get("status") or ("open" if status != 409 else "existing"),
            "existing": status == 409,
        }
    return {
        "ok": False,
        "httpStatus": status,
        "error": "ticket_not_created",
        "message": "The ticket was not created. Do not tell the customer a ticket exists.",
    }


def create_booxoo_ticket(
    ctx,
    name: str = "",
    issue: str = "",
    email: str = "",
    phone: str = "",
    order_id: str = "",
    product_id: str = "",
    **_kwargs,
) -> dict[str, Any]:
    """Create a ticket only after the support agent asked and the customer is verified."""
    if not ctx.session.authenticated:
        return {
            "ok": False,
            "error": "customer_not_verified",
            "message": (
                "The customer is not verified. The ticket was not created. "
                "Tell the support agent that verification is required first."
            ),
        }
    return create_confirmed_ticket(
        organization_id=str(ctx.request.organization_id),
        conversation_id=str(ctx.request.conversation_id or ""),
        collected_inputs={
            "name": name,
            "issue": issue,
            "email": email,
            "phone": phone,
            "orderId": order_id,
            "productId": product_id,
        },
    )


def create_booxoo_ticket_tool():
    from app.agents.custom_booxoo_bot.tools.base import Tool

    schema = {
        "type": "function",
        "function": {
            "name": "create_booxoo_ticket",
            "description": (
                "Create one Booxoo ticket. Call only when the support agent asked to create "
                "a ticket for this customer and this session is already verified. "
                "Name, issue, and email or phone must already be known."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Customer name from the profile."},
                    "issue": {"type": "string", "description": "The issue the support agent wants on the ticket."},
                    "email": {"type": "string", "description": "Customer email from Identity, when present."},
                    "phone": {"type": "string", "description": "Customer phone from Identity, when present."},
                    "order_id": {"type": "string", "description": "Order number when the issue is about an order."},
                    "product_id": {"type": "string", "description": "Product id when an item was selected."},
                },
                "required": ["name", "issue"],
            },
        },
    }
    return Tool(schema, create_booxoo_ticket)
