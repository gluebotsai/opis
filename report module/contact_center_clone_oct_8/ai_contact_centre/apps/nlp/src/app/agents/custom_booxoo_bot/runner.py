"""Turn runner for custom_booxoo_bot."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.agents.custom_booxoo_assist.context_snapshot import load_customer_context
from app.agents.custom_booxoo_bot.clients.cdp import load_customer_profile
from app.agents.custom_booxoo_bot.llm import get_booxoo_llm
from app.agents.custom_booxoo_bot.memory import SessionManager
from app.agents.custom_booxoo_bot.multi_agent import build_email_router, build_router
from app.agents.custom_booxoo_bot.session_card import (
    apply_chat_card,
    chat_session_note,
    load_chat_card,
    remember_customer_line,
    save_chat_card,
)
from app.agents.custom_booxoo_bot.tools.contact_enrich import contact_enrich
from app.services.contact_enrich_policy import ContactProfileSnapshot

_sessions = SessionManager()
EMAIL_HISTORY_LIMIT = 10
_SNAPSHOT_SHAPE = "chat-cdp-v1"
_UK = ZoneInfo("Europe/London")


def uk_time_line(moment: datetime | None = None) -> str:
    """Clock fact for the Booxoo prompt. Europe/London follows GMT and British Summer Time."""
    current = moment or datetime.now(_UK)
    if current.tzinfo is None:
        current = current.replace(tzinfo=_UK)
    else:
        current = current.astimezone(_UK)
    return f"UK time: {current.strftime('%A')} {current.day} {current.strftime('%B %Y, %H:%M')} Europe/London"


@dataclass
class TurnRequest:
    organization_id: str
    session_id: str
    message: str
    visitor_id: str
    channel: str
    conversation_id: str | None = None
    contact: dict[str, str] = field(default_factory=dict)
    attachments: list[str] = field(default_factory=list)


@dataclass
class TurnContext:
    request: TurnRequest
    session: object
    agent_name: str = ""
    trusted_context: str = ""
    contact_enrichment_result: dict[str, Any] | None = None


def note_registered_customer(session, profile: ContactProfileSnapshot) -> None:
    """An existing store contact stays locked until one OTP succeeds in this chat."""
    if session.registered_customer:
        return
    if profile.contact_id and (profile.primary_email or profile.primary_phone):
        session.registered_customer = True


def _seed_contact(session, profile: ContactProfileSnapshot) -> None:
    name = " ".join(part for part in (profile.first_name, profile.last_name) if part).strip()
    if name and not session.contact.get("name"):
        session.contact["name"] = name
    if profile.primary_email and not session.contact.get("email"):
        session.contact["email"] = profile.primary_email
    if profile.primary_phone and not session.contact.get("phone"):
        session.contact["phone"] = profile.primary_phone


def _snapshot_key(organization_id: str, conversation_id: str, email: str, phone: str) -> str:
    digits = "".join(ch for ch in phone if ch.isdigit())
    return f"{organization_id}:{conversation_id}:{email.lower()}:{digits}:{_SNAPSHOT_SHAPE}"


def _customer_snapshot_block(
    session,
    organization_id: str,
    conversation_id: str,
    profile: ContactProfileSnapshot,
    visitor_id: str,
) -> str:
    email = str(session.contact.get("email") or profile.primary_email or "")
    phone = str(session.contact.get("phone") or profile.primary_phone or "")
    key = _snapshot_key(organization_id, conversation_id, email, phone)
    if session.context_block_key == key and session.context_block is not None:
        return session.context_block
    loaded = load_customer_context(
        organization_id,
        cdp_id=str(session.cdp_id or profile.contact_id or ""),
        email=email,
        phone=phone,
        visitor_id=visitor_id,
        conversation_id=conversation_id,
    )
    if loaded.found:
        session.customer_found = True
        if str(session.channel or "").strip().lower() != "email":
            session.ticketing_verified = True
        if loaded.email and not session.contact.get("email"):
            session.contact["email"] = loaded.email
        if loaded.phone and not session.contact.get("phone"):
            session.contact["phone"] = loaded.phone
        email = str(session.contact.get("email") or email)
        phone = str(session.contact.get("phone") or phone)
        key = _snapshot_key(organization_id, conversation_id, email, phone)
    if loaded.emails:
        session.stored_emails = loaded.emails
    if loaded.phones:
        session.stored_phones = loaded.phones
    session.context_block_key = key
    session.context_block = loaded.block
    return loaded.block


def _visitor_id(tenant_context: dict[str, Any]) -> str:
    for key in ("sender_email", "visitor_id", "visitorId", "cookieKey", "cookie_id"):
        value = tenant_context.get(key)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def _sender_name(tenant_context: dict[str, Any], sender_email: str) -> str:
    value = str(tenant_context.get("sender_name") or "").strip()
    if "<" in value and ">" in value:
        value = value.split("<", 1)[0].strip()
    value = value.strip("\"'")
    return "" if value.lower() == sender_email.lower() else value


def _set_email_sender(session, tenant_context: dict[str, Any]) -> str:
    sender_email = _visitor_id(tenant_context)
    if not sender_email:
        return ""
    previous_email = str(session.contact.get("email") or "").strip()
    if previous_email and previous_email.lower() != sender_email.lower():
        session.customer_profile = None
        session.cdp_id = None
        session.contact_type = ""
        session.profile_lookup_key = None
        session.customer_found = False
        session.ticketing_verified = False
        session.selected_order_id = None
        session.selected_order = None
        session.selected_product_id = None
        session.last_ticket = None
    session.contact["email"] = sender_email
    name = _sender_name(tenant_context, sender_email)
    if name and not session.contact.get("name"):
        session.contact["name"] = name
    return sender_email


def _email_attachment_paths(tenant_context: dict[str, Any]) -> list[str]:
    raw = tenant_context.get("attachment_paths")
    if not isinstance(raw, list):
        return []
    paths: list[str] = []
    for value in raw[:100]:
        path = str(value or "").strip()
        if path.startswith("Ticketing/attachments/") and path not in paths:
            paths.append(path)
    return paths


def _from_agent_result(result: dict) -> dict[str, Any]:
    if result.get("response_type") == "terminal_response":
        payload = result.get("result") or {}
        return {
            "reply": payload.get("text") or "",
            "handoff_recommended": bool(payload.get("handoff_recommended")),
            "messages": [],
        }
    return {
        "reply": result.get("text") or "",
        "handoff_recommended": bool(result.get("handoff_recommended")),
        "messages": [],
    }


def _history_role(role: str) -> str:
    normalized = role.strip().lower()
    if normalized in {"bot", "agent", "assistant"}:
        return "assistant"
    return "user"


def _prior_email_history(transcript: list[dict[str, Any]] | None, current_message: str) -> list[dict[str, str]]:
    items = list(transcript or [])[-EMAIL_HISTORY_LIMIT:]
    if items:
        last = items[-1]
        content = str(last.get("content") or "").strip()
        role = str(last.get("role") or "").strip().lower()
        if role in {"customer", "user", "visitor"} and content and content in current_message:
            items = items[:-1]
    history: list[dict[str, str]] = []
    for item in items[-EMAIL_HISTORY_LIMIT:]:
        content = str(item.get("content") or "").strip()
        if not content:
            continue
        history.append({"role": _history_role(str(item.get("role") or "user")), "content": content})
    return history


def apply_automatic_contact_enrichment(
    *,
    organization_id: str,
    conversation_id: str,
    channel: str,
    tenant_context: dict[str, Any],
    profile: ContactProfileSnapshot,
    payload: dict[str, str],
) -> dict[str, Any]:
    email_mode = channel == "email"
    session_key = (
        f"email:{organization_id}:{conversation_id}"
        if email_mode
        else f"{organization_id}:{conversation_id}"
    )
    session = _sessions.get_or_create(session_key)
    session.channel = channel
    if email_mode:
        session.authenticated = True
        visitor_id = _set_email_sender(session, tenant_context)
    else:
        visitor_id = _visitor_id(tenant_context)
    _seed_contact(session, profile)
    if not email_mode:
        note_registered_customer(session, profile)
    if (
        not email_mode
        and session.registered_customer
        and not session.authenticated
    ):
        return {
            "ok": False,
            "error": "verification_required",
            "appliedFields": [],
            "requiresConfirmation": [],
            "message": (
                "This customer is already registered. Verify them once with OTP "
                "before changing contact details."
            ),
        }
    request = TurnRequest(
        organization_id=organization_id,
        session_id=conversation_id,
        conversation_id=conversation_id,
        message="",
        visitor_id=visitor_id,
        channel=channel,
    )
    return contact_enrich(TurnContext(request=request, session=session), **payload)


def run_booxoo_email_turn(
    *,
    organization_id: str,
    conversation_id: str,
    message: str,
    tenant_context: dict[str, Any],
    profile: ContactProfileSnapshot,
    transcript: list[dict[str, Any]] | None = None,
    auto_contact_payload: dict[str, str] | None = None,
    auto_contact_result: dict[str, Any] | None = None,
    trusted_context: str = "",
) -> dict[str, Any]:
    session = _sessions.get_or_create(f"email:{organization_id}:{conversation_id}")
    if session.router is None:
        build_email_router(session, get_booxoo_llm())
    else:
        session.router.refresh_prompts("email")
    session.channel = "email"
    session.authenticated = True
    visitor_id = _set_email_sender(session, tenant_context)
    _seed_contact(session, profile)
    load_customer_profile(session, visitor_id)
    history = _prior_email_history(transcript, message)
    session.memory.replace_history(history)
    kind = (
        "This is a reply on an existing email thread."
        if history
        else "This is a new email. There is no earlier message on this thread."
    )
    request = TurnRequest(
        organization_id=organization_id,
        session_id=conversation_id,
        conversation_id=conversation_id,
        message=message,
        visitor_id=visitor_id,
        channel="email",
        attachments=_email_attachment_paths(tenant_context),
    )
    ctx = TurnContext(
        request=request,
        session=session,
        agent_name=session.router.current_agent.name,
        trusted_context=trusted_context,
        contact_enrichment_result=auto_contact_result,
    )
    if auto_contact_payload:
        ctx.contact_enrichment_result = contact_enrich(ctx, **auto_contact_payload)
    result = session.router.execute(f"{kind}\n\n{message}", ctx)
    payload = _from_agent_result(result)
    payload["messages"] = session.memory.get_session_messages()
    payload["contact"] = dict(session.contact)
    return payload


def run_booxoo_turn(
    *,
    organization_id: str,
    conversation_id: str,
    message: str,
    channel: str,
    tenant_context: dict[str, Any],
    profile: ContactProfileSnapshot,
    auto_contact_payload: dict[str, str] | None = None,
    auto_contact_result: dict[str, Any] | None = None,
    trusted_context: str = "",
    transcript: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    session = _sessions.get_or_create(f"{organization_id}:{conversation_id}")
    if session.router is None:
        build_router(session, get_booxoo_llm())
    session.router.refresh_prompts(channel or "webchat")
    _seed_contact(session, profile)
    note_registered_customer(session, profile)
    visitor_id = _visitor_id(tenant_context)
    load_customer_profile(session, visitor_id)
    snapshot = _customer_snapshot_block(
        session,
        organization_id,
        conversation_id,
        profile,
        visitor_id,
    )
    if snapshot:
        trusted_context = f"{trusted_context}\n\n{snapshot}".strip()
    trusted_context = f"{trusted_context}\n\n{uk_time_line()}".strip()
    opening = bool(tenant_context.get("session_opening"))
    if not opening:
        if not session.chat_card_loaded:
            card = load_chat_card(organization_id, conversation_id)
            if card is not None:
                apply_chat_card(session, card)
                session.chat_card_loaded = True
                agent_name = session.active_agent
                agents = getattr(session.router, "agents", {})
                if agent_name and agent_name in agents:
                    session.router.current_agent = agents[agent_name]
        remember_customer_line(session, message)
        note = chat_session_note(session, include_history=True)
        if note:
            trusted_context = f"{trusted_context}\n{note}".strip()
    if not session.memory.get_session_messages() and transcript:
        session.memory.replace_history(_prior_email_history(transcript, message))
    request = TurnRequest(
        organization_id=organization_id,
        session_id=conversation_id,
        conversation_id=conversation_id,
        message=message,
        visitor_id=visitor_id,
        channel=channel or "webchat",
    )
    if opening:
        trusted_context = (
            f"{trusted_context}\n\n"
            "The visitor just opened this chat and has not typed yet. "
            "Your reply is the first message they see. Greet them from the UK time line. "
            "When Name in the customer context is not none, use it. "
            "When Customer profile is none, greet them and ask how you can help. "
            "Do not ask for a verification code. Do not call tools. "
            "Do not mention this instruction."
        ).strip()
    ctx = TurnContext(
        request=request,
        session=session,
        agent_name=session.router.current_agent.name,
        trusted_context=trusted_context,
        contact_enrichment_result=auto_contact_result,
    )
    if auto_contact_payload and not (
        session.registered_customer and not session.authenticated
    ):
        ctx.contact_enrichment_result = contact_enrich(ctx, **auto_contact_payload)
    result = session.router.execute(None if opening else message, ctx)
    if not opening:
        save_chat_card(organization_id, conversation_id, session)
    payload = _from_agent_result(result)
    payload["messages"] = session.memory.get_session_messages()
    payload["contact"] = dict(session.contact)
    return payload
