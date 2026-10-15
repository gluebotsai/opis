"""Lola fact card on the shared conversation session row."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.agents.custom_booxoo_bot.clients.cdp_store import _connect_url, store_configured
from app.config import get_settings
from app.logging import get_logger

logger = get_logger("nlp.custom_lola_worktual.session_card")

_READY = False
_LINE_LIMIT = 12
_STATE_KEY = "custom_lola_worktual"
_CREATE = """
CREATE TABLE IF NOT EXISTS ccass.conversation_session_state (
  organization_id bigint NOT NULL,
  conversation_id bigint NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, conversation_id)
)
"""


@dataclass
class LolaChatState:
    authenticated: bool = False
    customer_found: bool = False
    cdp_id: str = ""
    otp_code: str = ""
    otp_channel: str = ""
    otp_destination: str = ""
    contact: dict[str, str] = field(default_factory=dict)
    stored_emails: list[str] = field(default_factory=list)
    stored_phones: list[str] = field(default_factory=list)
    active_agent: str = ""
    last_ticket: dict[str, Any] = field(default_factory=dict)
    assistant_replied: bool = False
    recognized_greeting: bool = False
    customer_lines: list[str] = field(default_factory=list)
    card_loaded: bool = False


_states: dict[str, LolaChatState] = {}


def get_chat_state(conversation_id: str) -> LolaChatState:
    key = str(conversation_id or "")
    state = _states.get(key)
    if state is None:
        state = LolaChatState()
        _states[key] = state
    return state


def clear_chat_state(conversation_id: str) -> None:
    _states.pop(str(conversation_id or ""), None)


def _ids(organization_id: str, conversation_id: str) -> tuple[int, int] | None:
    org = str(organization_id or "").strip()
    conversation = str(conversation_id or "").strip()
    if not org.isdigit() or not conversation.isdigit():
        return None
    return int(org), int(conversation)


def _ensure(cur) -> None:
    global _READY
    if _READY:
        return
    cur.execute(_CREATE)
    _READY = True


def load_lola_card(organization_id: str, conversation_id: str) -> dict[str, Any] | None:
    ids = _ids(organization_id, conversation_id)
    if ids is None or not store_configured():
        return {}
    import psycopg

    try:
        with psycopg.connect(_connect_url(get_settings().database_url), connect_timeout=8) as conn:
            with conn.cursor() as cur:
                _ensure(cur)
                cur.execute(
                    """
                    SELECT state
                    FROM ccass.conversation_session_state
                    WHERE organization_id = %s AND conversation_id = %s
                    """,
                    ids,
                )
                row = cur.fetchone()
            conn.commit()
    except Exception as exc:
        logger.warning(
            "lola session state load failed organization_id=%s error=%s",
            organization_id,
            type(exc).__name__,
        )
        return None
    if not row or not isinstance(row[0], dict):
        return {}
    card = row[0].get(_STATE_KEY) or {}
    return card if isinstance(card, dict) else {}


def apply_lola_card(state: LolaChatState, card: dict[str, Any]) -> None:
    if not card:
        return
    if card.get("verified"):
        state.authenticated = True
        state.otp_code = ""
    elif card.get("otp_code") and not state.otp_code:
        state.otp_code = str(card["otp_code"])
    if card.get("customer_found"):
        state.customer_found = True
    if card.get("channel"):
        state.otp_channel = str(card["channel"])
    if card.get("destination"):
        state.otp_destination = str(card["destination"])
    if card.get("cdp_id") and not state.cdp_id:
        state.cdp_id = str(card["cdp_id"])
    contact = card.get("contact") if isinstance(card.get("contact"), dict) else {}
    for key in ("name", "email", "phone"):
        if contact.get(key) and not state.contact.get(key):
            state.contact[key] = str(contact[key])
    emails = card.get("stored_emails") if isinstance(card.get("stored_emails"), list) else []
    phones = card.get("stored_phones") if isinstance(card.get("stored_phones"), list) else []
    if emails and not state.stored_emails:
        state.stored_emails = [str(item) for item in emails if str(item).strip()]
    if phones and not state.stored_phones:
        state.stored_phones = [str(item) for item in phones if str(item).strip()]
    lines = card.get("customer_lines") if isinstance(card.get("customer_lines"), list) else []
    if lines and not state.customer_lines:
        state.customer_lines = [str(item) for item in lines if str(item).strip()][-_LINE_LIMIT:]
    if card.get("active_agent"):
        state.active_agent = str(card["active_agent"])
    ticket = card.get("last_ticket") if isinstance(card.get("last_ticket"), dict) else {}
    if ticket and not state.last_ticket:
        state.last_ticket = {str(key): value for key, value in ticket.items() if value}
    if card.get("assistant_replied"):
        state.assistant_replied = True
    if card.get("recognized_greeting"):
        state.recognized_greeting = True


def ensure_lola_card_loaded(organization_id: str, conversation_id: str) -> LolaChatState:
    state = get_chat_state(conversation_id)
    if state.card_loaded:
        return state
    card = load_lola_card(organization_id, conversation_id)
    if card is not None:
        apply_lola_card(state, card)
        state.card_loaded = True
    return state


def mark_email_sender_verified(
    organization_id: str,
    conversation_id: str,
    sender_email: str,
    sender_name: str = "",
) -> LolaChatState:
    """The email From address verifies this thread. Chat OTP state is not used."""
    state = ensure_lola_card_loaded(organization_id, conversation_id)
    email = sender_email.strip()
    state.authenticated = True
    state.otp_code = ""
    state.otp_channel = "email"
    state.otp_destination = email
    if email:
        state.contact["email"] = email
        if email.lower() not in {item.lower() for item in state.stored_emails}:
            state.stored_emails.append(email)
    name = sender_name.strip()
    if name and name.lower() != email.lower():
        state.contact["name"] = name
    save_lola_card(organization_id, conversation_id, state)
    return state


def save_lola_card(organization_id: str, conversation_id: str, state: LolaChatState | None = None) -> None:
    ids = _ids(organization_id, conversation_id)
    if ids is None or not store_configured():
        return
    import psycopg
    from psycopg.types.json import Json

    state = state or get_chat_state(conversation_id)
    contact = {
        key: str(state.contact.get(key) or "")
        for key in ("name", "email", "phone")
        if state.contact.get(key)
    }
    lines = [str(item).strip()[:500] for item in state.customer_lines if str(item).strip()]
    ticket = state.last_ticket if isinstance(state.last_ticket, dict) else {}
    payload = {
        _STATE_KEY: {
            "verified": bool(state.authenticated),
            "customer_found": bool(state.customer_found),
            "channel": state.otp_channel or "",
            "destination": state.otp_destination or "",
            "otp_code": "" if state.authenticated else (state.otp_code or ""),
            "cdp_id": state.cdp_id or "",
            "contact": contact,
            "stored_emails": list(state.stored_emails),
            "stored_phones": list(state.stored_phones),
            "customer_lines": lines[-_LINE_LIMIT:],
            "active_agent": state.active_agent or "",
            "last_ticket": {str(key): value for key, value in ticket.items() if value},
            "assistant_replied": bool(state.assistant_replied),
            "recognized_greeting": bool(state.recognized_greeting),
        }
    }
    try:
        with psycopg.connect(_connect_url(get_settings().database_url), connect_timeout=8) as conn:
            with conn.cursor() as cur:
                _ensure(cur)
                cur.execute(
                    """
                    INSERT INTO ccass.conversation_session_state (
                      organization_id, conversation_id, state, updated_at
                    )
                    VALUES (%s, %s, %s::jsonb, now())
                    ON CONFLICT (organization_id, conversation_id) DO UPDATE SET
                      state = ccass.conversation_session_state.state || EXCLUDED.state,
                      updated_at = now()
                    """,
                    (ids[0], ids[1], Json(payload)),
                )
            conn.commit()
    except Exception as exc:
        logger.warning(
            "lola session state save failed organization_id=%s error=%s",
            organization_id,
            type(exc).__name__,
        )


def remember_customer_line(conversation_id: str, message: str) -> None:
    text = " ".join(str(message or "").split())[:500]
    if not text:
        return
    state = get_chat_state(conversation_id)
    lines = list(state.customer_lines)
    if lines and lines[-1] == text:
        state.customer_lines = lines[-_LINE_LIMIT:]
        return
    lines.append(text)
    state.customer_lines = lines[-_LINE_LIMIT:]


def lola_session_note(conversation_id: str, recognized_name: str = "") -> str:
    state = get_chat_state(conversation_id)
    parts: list[str] = []
    if state.authenticated:
        channel = state.otp_channel or "OTP"
        destination = state.otp_destination or "the destination already used"
        parts.append(
            f"Session verification: verified once by {channel} to {destination}. Do not ask for another code."
        )
    elif state.otp_code:
        channel = state.otp_channel or "OTP"
        destination = state.otp_destination or "the destination already used"
        parts.append(f"Session verification: code sent by {channel} to {destination}.")
    elif state.customer_found:
        parts.append("This person is a Worktual customer. Session verification: not verified.")
    if state.stored_emails:
        parts.append("Stored emails: " + "; ".join(state.stored_emails))
    if state.stored_phones:
        parts.append("Stored phones: " + "; ".join(state.stored_phones))
    if state.active_agent:
        parts.append(f"Active specialist: {state.active_agent}.")
    ticket = state.last_ticket if isinstance(state.last_ticket, dict) else {}
    number = str(ticket.get("ticketNumber") or ticket.get("ticketId") or "").strip()
    if number:
        status = str(ticket.get("status") or "").strip()
        parts.append(f"Last ticket: {number}" + (f", status {status}." if status else "."))
    name = recognized_name.strip()
    if name and not state.recognized_greeting and state.assistant_replied:
        parts.append(
            f"The customer is now recognized as {name} after the chat began. Do not greet again. "
            "If their past summary contains an unfinished topic, briefly remind them where it stopped "
            "and guide them from there, then answer the latest message."
        )
    elif state.assistant_replied:
        parts.append("An assistant reply was already sent. Do not greet again.")
    elif name:
        parts.append(
            f"This is the first assistant reply. Greet {name} once using the local time of day. "
            "Briefly continue the latest past topic and its mood only when those are present in the past summary."
        )
    else:
        parts.append("This is the first assistant reply. Greet briefly using the local time of day.")
    lines = [str(item).strip() for item in state.customer_lines if str(item).strip()]
    if lines:
        quoted = "\n".join(f"- {line}" for line in lines[-8:])
        parts.append(
            "Customer messages so far, oldest first. The last line is the current request.\n" + quoted
        )
    return "\n".join(parts)
