"""Visitor identity and OTP tools for custom_booxoo_bot."""

from __future__ import annotations

import secrets

from app.agents.custom_booxoo_bot.clients.cdp import load_customer_profile
from app.agents.custom_booxoo_bot.clients.email_otp import send_otp_email
from app.agents.custom_booxoo_bot.clients.sms import send_otp_sms
from app.agents.custom_booxoo_bot.contact import usable_email, usable_phone
from app.agents.custom_booxoo_bot.tools.base import Tool
from app.config import get_settings


def _merge_contact(ctx, name: str = "", email: str = "", phone: str = "") -> dict:
    previous_email = (ctx.session.contact.get("email") or "").strip()
    previous_phone = (ctx.session.contact.get("phone") or "").strip()
    contact = dict(ctx.session.contact)
    if name:
        contact["name"] = name.strip()
    email = usable_email(email)
    phone = usable_phone(phone)
    if ctx.session.authenticated:
        known_email = usable_email(previous_email)
        known_phone = usable_phone(previous_phone)
        if email and known_email and email.lower() != known_email.lower():
            email = ""
        if phone and known_phone and phone != known_phone:
            phone = ""
    if email:
        contact["email"] = email
    if phone:
        contact["phone"] = phone
    ctx.session.contact = contact
    newly_identified = (contact.get("email") or "") != previous_email or (
        contact.get("phone") or ""
    ) != previous_phone
    if newly_identified and not ctx.session.customer_profile:
        load_customer_profile(ctx.session, ctx.request.visitor_id)
    return contact


def _order_count(profile: dict) -> int:
    orders = profile.get("orders") or profile.get("order_details") or []
    return len(orders) if isinstance(orders, list) else 0


def _capped_orders(profile: dict) -> list:
    orders = profile.get("orders") or profile.get("order_details") or []
    if not isinstance(orders, list):
        return []
    return orders[:5]


def get_visitor_contact(ctx, **_kwargs):
    contact = dict(ctx.session.contact)
    profile = ctx.session.customer_profile or {}
    return {
        "ok": True,
        "configured": True,
        "present": bool(contact.get("email") or contact.get("phone")),
        "authenticated": bool(ctx.session.authenticated),
        "registered": bool(ctx.session.registered_customer),
        "contact": contact,
        "profile_found": bool(ctx.session.customer_profile),
        "summary": {
            "name": contact.get("name") or profile.get("name") or "",
            "email": contact.get("email") or profile.get("email") or "",
            "phone": contact.get("phone") or profile.get("mobile_number") or profile.get("phone") or "",
            "cdp_id": ctx.session.cdp_id or "",
            "order_count": _order_count(profile) if profile else 0,
        },
        "orders": _capped_orders(profile) if profile else [],
    }


def _digits(value: str) -> str:
    digits = "".join(ch for ch in (value or "") if ch.isdigit())
    return digits[2:] if digits.startswith("00") else digits


def _same_phone(left: str, right: str) -> bool:
    a = _digits(left)
    b = _digits(right)
    if len(a) < 8 or len(b) < 8:
        return False
    return a == b or a.endswith(b) or b.endswith(a)


def _known_emails(ctx) -> list[str]:
    values = [str(item) for item in (getattr(ctx.session, "stored_emails", ()) or [])]
    contact_email = usable_email(ctx.session.contact.get("email") or "")
    if contact_email:
        values.append(contact_email)
    found: list[str] = []
    for value in values:
        email = usable_email(value)
        if email and email.lower() not in {item.lower() for item in found}:
            found.append(email)
    return found


def _known_phones(ctx) -> list[str]:
    values = [str(item) for item in (getattr(ctx.session, "stored_phones", ()) or [])]
    contact_phone = usable_phone(ctx.session.contact.get("phone") or "")
    if contact_phone:
        values.append(contact_phone)
    found: list[str] = []
    for value in values:
        phone = usable_phone(value)
        if phone and not any(_same_phone(phone, item) for item in found):
            found.append(phone)
    return found


def _matching_phone(candidate: str, phones: list[str]) -> str:
    phone = usable_phone(candidate)
    if not phone:
        return ""
    for item in phones:
        if _same_phone(phone, item):
            return item
    return ""


def _persist_chat_card(ctx) -> None:
    if str(getattr(ctx.request, "channel", "") or "") == "email":
        return
    from app.agents.custom_booxoo_bot.session_card import save_chat_card

    save_chat_card(
        str(ctx.request.organization_id),
        str(ctx.request.conversation_id or ""),
        ctx.session,
    )


def send_otp(
    ctx,
    email: str = "",
    phone: str = "",
    channel: str = "",
    **_kwargs,
):
    if ctx.session.authenticated:
        return {
            "ok": True,
            "sent": False,
            "already_authenticated": True,
            "message": "This visitor is already verified in this session. Do not send another OTP.",
        }
    known_emails = _known_emails(ctx)
    known_phones = _known_phones(ctx)
    email = usable_email(email)
    phone = usable_phone(phone)
    if not ctx.session.customer_found:
        return {"ok": False, "sent": False, "error": "customer_not_found"}
    if email and not any(email.lower() == item.lower() for item in known_emails):
        return {
            "ok": False,
            "sent": False,
            "error": "destination_mismatch",
            "channel": "email",
        }
    chosen_phone = _matching_phone(phone, known_phones) if phone else ""
    if phone and not chosen_phone:
        return {
            "ok": False,
            "sent": False,
            "error": "destination_mismatch",
            "channel": "sms",
        }
    selected_channel = str(channel or "").strip().lower()
    if selected_channel not in ("", "email", "sms"):
        return {"ok": False, "sent": False, "error": "invalid_otp_channel"}
    if not selected_channel:
        if known_emails and known_phones:
            return {
                "ok": False,
                "sent": False,
                "error": "medium_required",
                "available": ["email", "sms"],
                "emails": known_emails,
                "phones": known_phones,
            }
        selected_channel = "email" if known_emails else "sms"
    if selected_channel == "email":
        destination = email or (known_emails[0] if known_emails else "")
    else:
        destination = chosen_phone or (known_phones[0] if len(known_phones) == 1 else "")
    if not destination:
        missing = {
            "ok": False,
            "sent": False,
            "error": f"{selected_channel}_destination_required",
            "channel": selected_channel,
        }
        if selected_channel == "sms":
            missing["phones"] = known_phones
        else:
            missing["emails"] = known_emails
        return missing
    if ctx.session.otp_code:
        return {
            "ok": True,
            "sent": False,
            "already_sent": True,
            "channel": ctx.session.otp_channel,
            "destination": ctx.session.otp_destination,
            "message": "A verification code was already sent. Ask for that code; do not send another.",
        }
    if selected_channel == "sms":
        ctx.session.contact["phone"] = destination
    dev_code = get_settings().custom_booxoo_bot_otp_dev_code.strip()
    code = dev_code or f"{secrets.randbelow(900000) + 100000}"
    contact = ctx.session.contact
    if selected_channel == "email":
        sent = send_otp_email(
            str(ctx.request.organization_id),
            destination,
            code,
            contact.get("name") or "",
        )
    else:
        sent = send_otp_sms(destination, code, contact.get("name") or "")
    if not sent.get("ok"):
        ctx.session.otp_code = None
        ctx.session.otp_channel = None
        ctx.session.otp_destination = None
        ctx.session.authenticated = False
        return {"ok": False, "sent": False, "channel": selected_channel, **sent}
    ctx.session.otp_code = code
    ctx.session.otp_channel = selected_channel
    ctx.session.otp_destination = str(sent.get("destination") or destination)
    _persist_chat_card(ctx)
    return {
        "ok": True,
        "sent": True,
        "channel": selected_channel,
        "destination": ctx.session.otp_destination,
        "http_status": sent.get("http_status"),
    }


def verify_otp(ctx, code: str, **_kwargs):
    if ctx.session.authenticated:
        return {"ok": True, "authenticated": True, "already_authenticated": True}
    expected = getattr(ctx.session, "otp_code", None)
    if not expected:
        return {"ok": False, "authenticated": False, "error": "otp_not_sent"}
    if str(code).strip() != str(expected):
        return {"ok": False, "authenticated": False, "error": "invalid_otp"}
    ctx.session.authenticated = True
    ctx.session.ticketing_verified = True
    ctx.session.otp_code = None
    _persist_chat_card(ctx)
    return {
        "ok": True,
        "authenticated": True,
        "message": "Verified for the rest of this session. Do not send another code to email or phone.",
    }


def identity_tools() -> list[Tool]:
    return [
        Tool(
            {
                "type": "function",
                "function": {
                    "name": "get_visitor_contact",
                    "description": "Load name, email, phone, and a short customer profile summary including order count when a profile is already known.",
                    "parameters": {"type": "object", "properties": {}, "required": []},
                },
            },
            get_visitor_contact,
        ),
        Tool(
            {
                "type": "function",
                "function": {
                    "name": "send_otp",
                    "description": "Send one code to a stored email or phone after lookup finds the customer. Pass channel when both exist. Pass phone when more than one phone is stored. One success covers the rest of this session. Claim a send only when sent is true.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "email": {"type": "string"},
                            "phone": {"type": "string"},
                            "channel": {
                                "type": "string",
                                "enum": ["email", "sms"],
                            },
                        },
                        "required": [],
                    },
                },
            },
            send_otp,
        ),
        Tool(
            {
                "type": "function",
                "function": {
                    "name": "verify_otp",
                    "description": "Verify the one-time code the user provided.",
                    "parameters": {
                        "type": "object",
                        "properties": {"code": {"type": "string"}},
                        "required": ["code"],
                    },
                },
            },
            verify_otp,
        ),
    ]
