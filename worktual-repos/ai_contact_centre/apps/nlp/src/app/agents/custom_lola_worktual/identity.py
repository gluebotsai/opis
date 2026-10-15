"""One OTP for a Worktual customer already stored in CDP."""

from __future__ import annotations

import secrets

from app.agents.custom_booxoo_bot.clients.cdp_store import lookup_customer
from app.agents.custom_lola_worktual.session import get_turn_context
from app.agents.custom_lola_worktual.session_card import get_chat_state, save_lola_card


def _organization_id(session_id: str) -> str:
    context = get_turn_context(session_id)
    return str(context.get("organization_id") or "1003")


def _apply_customer(state, record: dict, email: str, phone: str) -> None:
    customer = record.get("customer") or {}
    state.customer_found = True
    state.cdp_id = str(record.get("cdp_id") or state.cdp_id or "")
    found_email = str(customer.get("email") or email or "").strip()
    found_phone = str(customer.get("phone") or phone or "").strip()
    if found_email:
        state.contact["email"] = found_email
        state.stored_emails = [found_email]
    if found_phone:
        state.contact["phone"] = found_phone
        state.stored_phones = [found_phone]
    name = str(customer.get("name") or "").strip()
    if name and not state.contact.get("name"):
        state.contact["name"] = name


def lookup_worktual_customer(session_id: str, email: str = "", phone: str = "") -> dict:
    state = get_chat_state(session_id)
    email = (email or state.contact.get("email") or "").strip()
    phone = (phone or state.contact.get("phone") or "").strip()
    if not email and not phone:
        return {
            "ok": False,
            "found": False,
            "error": "email_or_phone_required",
            "message": "Ask for the email or phone on their Worktual account.",
        }
    record = lookup_customer(_organization_id(session_id), email, phone)
    if record is None:
        return {
            "ok": False,
            "found": False,
            "error": "customer_store_unavailable",
            "message": "The customer store is not available. Do not send a code.",
        }
    if not record.get("found"):
        state.customer_found = False
        return {
            "ok": False,
            "found": False,
            "error": "customer_not_found",
            "message": "We do not have a Worktual account for that email or phone. Ask for the one they use with Worktual.",
        }
    _apply_customer(state, record, email, phone)
    return {"ok": True, "found": True, "cdp_id": state.cdp_id, "customer": record.get("customer") or {}}


def send_session_otp(session_id: str, option: str = "", email: str = "", mobile: str = "") -> dict:
    state = get_chat_state(session_id)
    if state.authenticated:
        return {
            "status": "success",
            "sent": False,
            "already_authenticated": True,
            "message": "This customer is already verified in this chat. Do not send another code to email or phone.",
        }
    channel = str(option or "").strip().lower()
    if channel == "sms":
        channel = "mobile"
    lookup_email = email if channel != "mobile" else ""
    lookup_phone = mobile if channel != "email" else ""
    if not lookup_email and not lookup_phone:
        lookup_email = email or state.contact.get("email") or ""
        lookup_phone = "" if lookup_email else (mobile or state.contact.get("phone") or "")
    found = lookup_worktual_customer(session_id, lookup_email, lookup_phone)
    if not found.get("found"):
        return {"status": "success", "sent": False, **found}
    if channel not in ("email", "mobile"):
        if state.stored_emails and state.stored_phones:
            return {
                "status": "success",
                "sent": False,
                "error": "medium_required",
                "message": "Ask which stored destination they want: email or phone. Wait. Do not send yet.",
                "emails": state.stored_emails,
                "phones": state.stored_phones,
            }
        channel = "email" if state.stored_emails else "mobile"
    if state.otp_code:
        return {
            "status": "success",
            "sent": False,
            "already_sent": True,
            "channel": state.otp_channel,
            "destination": state.otp_destination,
            "message": "A verification code was already sent. Ask for that code. Do not send another.",
        }
    if channel == "email":
        destination = state.stored_emails[0] if state.stored_emails else ""
    else:
        destination = state.stored_phones[0] if state.stored_phones else ""
    if not destination:
        return {
            "status": "success",
            "sent": False,
            "error": "destination_missing",
            "message": "That contact method is not stored on the Worktual account. Use the stored email or phone.",
        }
    code = f"{secrets.randbelow(900000) + 100000}"
    name = state.contact.get("name") or ""
    if channel == "email":
        from app.agents.custom_lola_worktual.tools import send_otp_email

        sent = send_otp_email(destination, code, name)
    else:
        from app.agents.custom_lola_worktual.tools import send_otp_sms

        sent = send_otp_sms(destination, code, name)
    if sent != "success":
        state.otp_code = ""
        return {
            "status": "success",
            "sent": False,
            "error": "otp_send_failed",
            "message": "The code could not be sent. Do not claim it was sent.",
        }
    state.otp_code = code
    state.otp_channel = "email" if channel == "email" else "sms"
    state.otp_destination = destination
    save_lola_card(_organization_id(session_id), session_id, state)
    return {
        "status": "success",
        "sent": True,
        "channel": state.otp_channel,
        "destination": destination,
        "message": f"A code was sent by {state.otp_channel}. Ask for that code. Do not send another.",
    }


def verify_session_otp(session_id: str, otp: str) -> dict:
    state = get_chat_state(session_id)
    if state.authenticated:
        return {
            "status": "success",
            "authenticated": True,
            "already_authenticated": True,
            "message": "Already verified for this chat. Do not ask for another code.",
        }
    expected = state.otp_code
    if not expected:
        return {
            "status": "success",
            "authenticated": False,
            "error": "otp_not_sent",
            "message": "No code is waiting. Send one code first.",
        }
    if str(otp).strip() != str(expected):
        return {
            "status": "success",
            "authenticated": False,
            "error": "invalid_otp",
            "message": "That code does not match. Ask them to try the code they received. Do not reveal it.",
        }
    state.authenticated = True
    state.otp_code = ""
    save_lola_card(_organization_id(session_id), session_id, state)
    return {
        "status": "success",
        "authenticated": True,
        "message": "Verified for the rest of this chat. Do not send another code to email or phone.",
    }
