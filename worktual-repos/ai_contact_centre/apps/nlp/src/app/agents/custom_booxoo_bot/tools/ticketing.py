"""Support ticket tools for custom_booxoo_bot."""

from __future__ import annotations

import hashlib

from app.agents.custom_booxoo_bot.clients.ticketing import TicketingClient
from app.agents.custom_booxoo_bot.contact import resolve_identity
from app.agents.custom_booxoo_bot.tools.base import Tool

_client = TicketingClient()


def _identity(ctx, email: str = "", mobile: str = "") -> tuple[str, str]:
    return resolve_identity(
        ctx.session.contact,
        email,
        mobile,
        lock=bool(ctx.session.authenticated),
    )


def _gate(ctx, require_order: bool = False) -> dict | None:
    if not ctx.session.authenticated and not _is_email(ctx):
        return {
            "ok": False,
            "error": "otp_required",
            "http_status": None,
            "user_message": (
                "This session is not verified. Do not mention any ticket number, subject, or status. "
                "Look up the customer, then send one OTP to a stored email or phone. "
                "After the code succeeds, retry this request. Do not ask for another code later in this session."
            ),
        }
    if ctx.session.authenticated and not _is_email(ctx):
        ctx.session.ticketing_verified = True
    if not ctx.session.ticketing_verified:
        return {
            "ok": False,
            "error": "customer_not_verified",
            "http_status": None,
            "user_message": (
                "This session is not ready for a ticket. "
                "If a code already succeeded on email or phone, do not send another code. "
                "Look up the customer, then continue this request."
            ),
        }
    if require_order:
        if not ctx.session.selected_order_id:
            return {"ok": False, "error": "order_required", "http_status": None}
        if not ctx.session.selected_product_id:
            return {"ok": False, "error": "product_required", "http_status": None}
    return None


def _is_email(ctx) -> bool:
    return str(getattr(ctx.request, "channel", "") or "") == "email"


def _public_error(status: int, ctx=None) -> dict:
    if status == 401:
        if ctx is not None and _is_email(ctx):
            follow = (
                "The sender address is already the customer. Do not ask for a verification code. "
                "Ask for an order only when the issue is about an order. "
                "If several details are still missing, ask for all of them in this one email."
            )
        else:
            follow = (
                "If lookup_customer_details already found them, continue with OTP. "
                "Ask for an order only when the issue is about an order."
            )
        return {
            "ok": False,
            "http_status": 401,
            "error": "support_system_unavailable",
            "user_message": (
                "The ticket service rejected this request. Do not tell the customer the support system is down. "
                f"Do not offer a live agent. {follow}"
            ),
        }
    if status == 404:
        if ctx is not None and _is_email(ctx):
            return {
                "ok": False,
                "http_status": 404,
                "error": "ticket_request_rejected",
                "user_message": (
                    "The sender address has already been used and must not be requested again. "
                    "Call get_ticket_status with the sender address. If an existing ticket clearly "
                    "covers this issue, explain that ticket. Otherwise say the request could not be "
                    "opened right now without claiming success."
                ),
            }
        return {
            "ok": False,
            "http_status": 404,
            "error": "no_customer_account",
            "user_message": "We do not have an account for that email or phone. Ask for the email or phone they used when they purchased.",
        }
    if status == 400:
        return {"ok": False, "http_status": 400, "error": "missing_fields"}
    if status == 422:
        return {
            "ok": False,
            "http_status": 422,
            "error": "customer_not_in_store",
            "user_message": (
                "This person is not in the customer store, so a ticket cannot be opened. "
                "Do not send another verification code. Ask for the email or phone they used when they purchased."
            ),
        }
    if status == 0:
        return {"ok": False, "http_status": 0, "error": "ticketing_not_configured"}
    if status == 403:
        return {
            "ok": False,
            "http_status": 403,
            "error": "customer_not_active",
            "user_message": "That account is not active for support tickets.",
        }
    if status == 409:
        return {
            "ok": False,
            "http_status": 409,
            "error": "ticket_already_exists",
            "user_message": "A ticket for this request already exists. Tell the user that and stop. Do not escalate unless they ask.",
        }
    return {"ok": False, "http_status": status, "error": "ticketing_error"}


def _store_customer(ctx) -> dict:
    ctx.session.ticketing_verified = True
    return {
        "ok": True,
        "http_status": 200,
        "source": "customer_store",
        "customer": {
            "name": ctx.session.contact.get("name") or "",
            "email": ctx.session.contact.get("email") or "",
            "phone": ctx.session.contact.get("phone") or "",
            "contact_type": getattr(ctx.session, "contact_type", "") or "",
        },
        "user_message": (
            "This person is already in the customer store, including a lead. "
            "The sender address is the customer. Do not ask for a verification code. "
            "Ask for an order only when the issue is about an order. "
            "If several details are still missing, ask for all of them in this one email. "
            "Do not offer a live agent."
            if _is_email(ctx)
            else "This person is already in the customer store, including a lead. Continue with one OTP. Ask for an order only when an order already exists. A failed payment has no order id. Do not offer a live agent."
        ),
    }


def verify_ticketing_customer(ctx, email: str = "", mobile: str = "", **_kwargs):
    if not ctx.session.customer_found or not ctx.session.cdp_id:
        return {
            "ok": False,
            "error": "lookup_required",
            "user_message": "Call lookup_customer_details with the email or phone first. Do not tell the customer the support system is down. Do not offer a live agent.",
        }
    if _is_email(ctx):
        email, mobile = _identity(ctx, email, mobile)
        status, _payload = _client.verify_customer(email=email, mobile=mobile)
        if status != 200:
            return _public_error(status, ctx)
    return _store_customer(ctx)


def _subject_from(issue: str, subject: str = "") -> str:
    text = " ".join((subject or issue).split())
    if not text:
        return "Support request"
    first = text.split(".")[0].strip() or text
    if len(first) > 80:
        return first[:77].rstrip() + "..."
    return first


def _ticket_fields(payload: dict) -> dict:
    ticket = payload.get("ticket") if isinstance(payload.get("ticket"), dict) else payload
    return {
        "ticketId": ticket.get("ticketId") or ticket.get("ticket_id") or ticket.get("id"),
        "ticketNumber": ticket.get("ticketNumber") or ticket.get("ticket_number") or ticket.get("number"),
        "status": ticket.get("status"),
        "subject": ticket.get("subject"),
    }


def _ticket_label(number) -> str:
    text = str(number or "").strip()
    if not text:
        return ""
    return text if text.startswith("#") else f"#{text}"


def _slim_tickets(payload, *, limit: int | None = 5) -> list[dict]:
    tickets = (payload.get("tickets") or []) if isinstance(payload, dict) else []
    chosen = tickets if limit is None else tickets[:limit]
    slim = []
    for ticket in chosen:
        if not isinstance(ticket, dict):
            continue
        number = (
            ticket.get("ticketNumber")
            or ticket.get("ticket_number")
            or ticket.get("number")
            or ticket.get("id")
        )
        slim.append(
            {
                "ticketNumber": _ticket_label(number) or None,
                "status": ticket.get("status"),
                "subject": ticket.get("subject") or ticket.get("issue"),
                "updatedAt": ticket.get("updatedAt") or ticket.get("updated_at"),
            }
        )
    return slim


def create_support_ticket(
    ctx,
    name: str = "",
    issue: str = "",
    subject: str = "",
    email: str = "",
    mobile: str = "",
    **_kwargs,
):
    blocked = _gate(ctx)
    if blocked:
        return blocked
    email, mobile = _identity(ctx, email, mobile)
    name = (name or ctx.session.contact.get("name") or "").strip()
    description = (issue or "").strip()
    missing_fields = []
    if not name:
        missing_fields.append("name")
    if not description:
        missing_fields.append("issue")
    if not email and not mobile:
        missing_fields.append("email_or_phone")
    if missing_fields:
        return {
            "ok": False,
            "http_status": 400,
            "error": "missing_fields",
            "missingFields": missing_fields,
            "user_message": (
                "Ask for every field in missingFields in one email. The From address is already "
                "the customer email and must not be requested again."
                if _is_email(ctx)
                else "Ask for the missing fields."
            ),
        }
    references = []
    order_id = ctx.session.selected_order_id or ""
    product_id = ctx.session.selected_product_id or ""
    if order_id:
        references.append({"type": "order", "id": order_id})
    if product_id:
        references.append({"type": "product", "id": product_id})
    external_ref = ctx.request.conversation_id or ctx.request.session_id
    issue_key = hashlib.sha256(description.encode()).hexdigest()[:16]
    idempotency_key = f"{external_ref}:{issue_key}" if external_ref else issue_key
    metadata = {
        "source": ctx.request.channel or "webchat",
        "conversationId": ctx.request.conversation_id or "",
        "visitorId": ctx.request.visitor_id,
        "sessionId": ctx.request.session_id,
    }
    if order_id:
        metadata["orderId"] = order_id
    if product_id:
        metadata["productId"] = product_id
    attachments = list(getattr(ctx.request, "attachments", []) or []) if _is_email(ctx) else None
    status, payload = _client.create_ticket(
        name=name,
        issue=description,
        email=email,
        mobile=mobile,
        external_ref=external_ref,
        metadata=metadata,
        subject=_subject_from(description, subject),
        references=references or None,
        attachments=attachments,
        channel=str(getattr(ctx.request, "channel", "") or "webchat"),
        idempotency_key=idempotency_key,
    )
    if status in (200, 201) and isinstance(payload, dict):
        fields = _ticket_fields(payload)
        ctx.session.last_ticket = {k: v for k, v in fields.items() if v}
        label = _ticket_label(fields.get("ticketNumber") or fields.get("ticketId"))
        return {
            "ok": True,
            "http_status": status,
            "user_message": (
                f"Reply in your own words. Tell them ticket {label or 'the new ticket'} is open "
                "and the team will contact them soon. Do not answer with only the ticket number and status. "
                "Do not offer a live agent."
            ),
            **fields,
        }
    if status == 409:
        fields = _ticket_fields(payload) if isinstance(payload, dict) else {}
        number = _ticket_label(fields.get("ticketNumber") or fields.get("ticketId"))
        return {
            "ok": True,
            "http_status": 409,
            "error": "ticket_already_exists",
            "user_message": (
                f"A ticket for this request already exists{f' ({number})' if number else ''}. "
                "Tell them that calmly, and that the team will contact them soon. Do not create another. "
                "Do not offer a live agent."
            ),
            **fields,
        }
    if status == 404 and _is_email(ctx):
        lookup_status, lookup_payload = _client.lookup(email=email, mobile=mobile)
        existing = _slim_tickets(lookup_payload) if lookup_status == 200 else []
        if existing:
            return {
                "ok": False,
                "http_status": 404,
                "error": "ticket_create_rejected_existing_tickets",
                "existingTickets": existing,
                "user_message": (
                    "The sender address is already confirmed. Never ask for it again. Compare the "
                    "current issue with existingTickets. If one clearly covers the same issue, tell "
                    "the customer its number and status and do not create a duplicate. If none "
                    "covers it, say the new request could not be opened right now."
                ),
            }
    return _public_error(status, ctx)


def get_ticket_status(ctx, email: str = "", mobile: str = "", **_kwargs):
    blocked = _gate(ctx)
    if blocked:
        return blocked
    email, mobile = _identity(ctx, email, mobile)
    if not email and not mobile:
        return {"ok": False, "error": "email_or_phone_required"}
    status, payload = _client.lookup(email=email, mobile=mobile)
    if status == 200 and isinstance(payload, dict):
        slim = _slim_tickets(payload, limit=None)
        return {"ok": True, "http_status": 200, "tickets": slim}
    return _public_error(status, ctx)


def ticketing_tools(email_mode: bool = False) -> list[Tool]:
    verify_description = (
        "After lookup_customer_details finds the sender, confirm that the ticketing service also "
        "recognizes that same From address. Email never uses OTP."
        if email_mode
        else "Call only after lookup_customer_details has found this person. A customer or lead already in the customer store is eligible. Then send OTP. Do not call this before lookup, and do not offer a live agent if it fails."
    )
    create_description = (
        "Create a support ticket when all required details are present. The From address is the "
        "customer email; never ask for it. Do not require an order for login, password, account, "
        "or other non-order issues. For order or product issues, collect all missing order, item, "
        "issue, and requested-resolution details in one email before calling. Check existing "
        "tickets first and never create a duplicate."
        if email_mode
        else "Open a ticket only after troubleshooting did not solve the issue, or the customer said they are not satisfied, and after one OTP on email or phone. That one code covers this session. Do not ask for the other medium. Ask once if they want to add anything, then call this once. Do not require an order, cart id, or transaction id. A payment that failed before an order was created has no order. If they already said they have no reference, call this with the details they gave. Ask for an order number only for a refund, return, exchange, damaged or wrong item, or delivery of an order that exists."
    )
    status_description = (
        "Look up every ticket for the confirmed From address. Use this before creating a "
        "ticket so the model can avoid a semantically duplicate request."
        if email_mode
        else "Look up this customer's tickets after this session is verified once. Describe only tickets in the result. Do not troubleshoot a status check."
    )
    tools = []
    if email_mode:
        tools.append(
            Tool(
                {
                    "type": "function",
                    "function": {
                        "name": "verify_ticketing_customer",
                        "description": verify_description,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "email": {"type": "string"},
                                "mobile": {"type": "string"},
                            },
                            "required": [],
                        },
                    },
                },
                verify_ticketing_customer,
            )
        )
    tools.extend(
        [
            Tool(
                {
                    "type": "function",
                    "function": {
                        "name": "create_support_ticket",
                        "description": create_description,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "subject": {"type": "string"},
                                "issue": {"type": "string"},
                                "email": {"type": "string"},
                                "mobile": {"type": "string"},
                            },
                            "required": ["issue"],
                        },
                    },
                },
                create_support_ticket,
            ),
            Tool(
                {
                    "type": "function",
                    "function": {
                        "name": "get_ticket_status",
                        "description": status_description,
                        "parameters": {
                            "type": "object",
                            "properties": {
                                "email": {"type": "string"},
                                "mobile": {"type": "string"},
                            },
                            "required": [],
                        },
                    },
                },
                get_ticket_status,
            ),
        ]
    )
    return tools
