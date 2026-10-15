"""Shared conversation session state.

One row per organization and conversation. Each bot merges its own object
inside the JSON state, so a restart keeps verification without a brand table.
"""

from __future__ import annotations

from typing import Any

from app.agents.custom_booxoo_bot.clients.cdp_store import _connect_url, store_configured
from app.config import get_settings
from app.logging import get_logger

logger = get_logger("nlp.custom_booxoo_bot.session_card")

_READY = False
_LINE_LIMIT = 12
_STATE_KEY = "custom_booxoo_bot"

_DROP_BRAND_TABLE = "DROP TABLE IF EXISTS ccass.booxoo_chat_session"
_CREATE = """
CREATE TABLE IF NOT EXISTS ccass.conversation_session_state (
  organization_id bigint NOT NULL,
  conversation_id bigint NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, conversation_id)
)
"""


def _ids(organization_id: str, conversation_id: str) -> tuple[int, int] | None:
    org = str(organization_id or "").strip()
    conversation = str(conversation_id or "").strip()
    if not org.isdigit() or not conversation.isdigit():
        return None
    return int(org), int(conversation)


def _ensure(cur) -> bool:
    global _READY
    if _READY:
        return True
    cur.execute(_DROP_BRAND_TABLE)
    cur.execute(_CREATE)
    _READY = True
    return True


def load_chat_card(organization_id: str, conversation_id: str) -> dict[str, Any] | None:
    """Return this bot's saved state, {} when none exists, or None when the store failed."""
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
            "conversation session state load failed organization_id=%s error=%s",
            organization_id,
            type(exc).__name__,
        )
        return None
    if not row or not isinstance(row[0], dict):
        return {}
    card = row[0].get(_STATE_KEY) or {}
    if not isinstance(card, dict):
        return {}
    contact = card.get("contact") if isinstance(card.get("contact"), dict) else {}
    lines = card.get("customer_lines") if isinstance(card.get("customer_lines"), list) else []
    return {
        "verified": bool(card.get("verified")),
        "ticketing_verified": bool(card.get("ticketing_verified")),
        "customer_found": bool(card.get("customer_found")),
        "channel": str(card.get("channel") or ""),
        "destination": str(card.get("destination") or ""),
        "otp_code": str(card.get("otp_code") or ""),
        "cdp_id": str(card.get("cdp_id") or ""),
        "contact": {key: str(value) for key, value in contact.items() if value},
        "customer_lines": [str(item) for item in lines if str(item).strip()],
        "active_agent": str(card.get("active_agent") or ""),
        "selected_order_id": str(card.get("selected_order_id") or ""),
        "selected_product_id": str(card.get("selected_product_id") or ""),
        "last_ticket": card.get("last_ticket") if isinstance(card.get("last_ticket"), dict) else {},
        "assistant_replied": bool(card.get("assistant_replied")),
    }


def apply_chat_card(session, card: dict[str, Any]) -> None:
    if not card:
        return
    if card.get("verified"):
        session.authenticated = True
        session.otp_code = None
    elif card.get("otp_code") and not session.otp_code:
        session.otp_code = str(card["otp_code"])
    if card.get("ticketing_verified"):
        session.ticketing_verified = True
    if card.get("customer_found"):
        session.customer_found = True
    if card.get("channel"):
        session.otp_channel = str(card["channel"])
    if card.get("destination"):
        session.otp_destination = str(card["destination"])
    if card.get("cdp_id") and not session.cdp_id:
        session.cdp_id = str(card["cdp_id"])
    contact = card.get("contact") or {}
    for key in ("name", "email", "phone"):
        if contact.get(key) and not session.contact.get(key):
            session.contact[key] = str(contact[key])
    if not session.customer_lines and card.get("customer_lines"):
        session.customer_lines = list(card["customer_lines"])[-_LINE_LIMIT:]
    if card.get("active_agent"):
        session.active_agent = str(card["active_agent"])
    if card.get("selected_order_id") and not session.selected_order_id:
        session.selected_order_id = str(card["selected_order_id"])
    if card.get("selected_product_id") and not session.selected_product_id:
        session.selected_product_id = str(card["selected_product_id"])
    ticket = card.get("last_ticket") if isinstance(card.get("last_ticket"), dict) else {}
    if ticket and not session.last_ticket:
        session.last_ticket = {str(key): value for key, value in ticket.items() if value}
    if card.get("assistant_replied"):
        session.assistant_replied = True


def save_chat_card(organization_id: str, conversation_id: str, session) -> None:
    ids = _ids(organization_id, conversation_id)
    if ids is None or not store_configured():
        return
    import psycopg
    from psycopg.types.json import Json

    contact = {
        key: str(session.contact.get(key) or "")
        for key in ("name", "email", "phone")
        if session.contact.get(key)
    }
    lines = [str(item).strip()[:500] for item in (session.customer_lines or []) if str(item).strip()]
    router = getattr(session, "router", None)
    current = getattr(getattr(router, "current_agent", None), "name", "") or session.active_agent or ""
    ticket = session.last_ticket if isinstance(session.last_ticket, dict) else {}
    state = {
        _STATE_KEY: {
            "verified": bool(session.authenticated),
            "ticketing_verified": bool(session.ticketing_verified),
            "customer_found": bool(session.customer_found),
            "channel": session.otp_channel or "",
            "destination": session.otp_destination or "",
            "otp_code": "" if session.authenticated else (session.otp_code or ""),
            "cdp_id": session.cdp_id or "",
            "contact": contact,
            "customer_lines": lines[-_LINE_LIMIT:],
            "active_agent": current,
            "selected_order_id": session.selected_order_id or "",
            "selected_product_id": session.selected_product_id or "",
            "last_ticket": {str(key): value for key, value in ticket.items() if value},
            "assistant_replied": bool(session.assistant_replied),
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
                    (ids[0], ids[1], Json(state)),
                )
            conn.commit()
    except Exception as exc:
        logger.warning(
            "conversation session state save failed organization_id=%s error=%s",
            organization_id,
            type(exc).__name__,
        )


def remember_customer_line(session, message: str) -> None:
    text = " ".join(str(message or "").split())[:500]
    if not text:
        return
    lines = list(session.customer_lines or [])
    if lines and lines[-1] == text:
        session.customer_lines = lines[-_LINE_LIMIT:]
        return
    lines.append(text)
    session.customer_lines = lines[-_LINE_LIMIT:]


def chat_session_note(session, *, include_history: bool) -> str:
    """Facts for this turn. The latest customer message chooses the rule."""
    parts: list[str] = []
    if session.authenticated:
        channel = session.otp_channel or "OTP"
        destination = session.otp_destination or "the destination already used"
        parts.append(
            f"Session verification: verified once by {channel} to {destination}. Do not ask for another code."
        )
    elif session.otp_code:
        channel = session.otp_channel or "OTP"
        destination = session.otp_destination or "the destination already used"
        parts.append(f"Session verification: code sent by {channel} to {destination}.")
    else:
        if session.registered_customer:
            parts.append("This visitor is an existing customer. Session verification: not verified.")
        emails = [str(item).strip() for item in (session.stored_emails or []) if str(item).strip()]
        phones = [str(item).strip() for item in (session.stored_phones or []) if str(item).strip()]
        if emails:
            parts.append("Stored emails: " + "; ".join(emails))
        if phones:
            parts.append("Stored phones: " + "; ".join(phones))
    if session.selected_order_id:
        parts.append(f"Selected order: {session.selected_order_id}.")
    if session.selected_product_id:
        parts.append(f"Selected product: {session.selected_product_id}.")
    ticket = session.last_ticket if isinstance(session.last_ticket, dict) else {}
    number = str(ticket.get("ticketNumber") or ticket.get("ticketId") or "").strip()
    if number:
        status = str(ticket.get("status") or "").strip()
        parts.append(f"Last ticket: {number}" + (f", status {status}." if status else "."))
    if session.assistant_replied:
        parts.append("An assistant reply was already sent. Do not greet again.")
    else:
        parts.append("This is the first assistant reply. Greet from the UK time line.")
    if include_history:
        lines = [str(item).strip() for item in (session.customer_lines or []) if str(item).strip()]
        if lines:
            quoted = "\n".join(f"- {line}" for line in lines[-8:])
            parts.append(
                "Customer messages so far, oldest first. The last line is the current request. "
                "If it changes the task, follow the new one.\n" + quoted
            )
    return "\n".join(parts)
