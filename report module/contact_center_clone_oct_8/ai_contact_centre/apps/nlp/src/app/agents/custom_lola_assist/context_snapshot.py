"""Labeled customer context for one Lola Assist session."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.agents.custom_booxoo_bot.clients.cdp_store import (
    _connect_url,
    _organization_id,
    store_configured,
)
from app.agents.custom_lola_worktual.tools import get_crm_appointment_by_contact
from app.config import get_settings
from app.logging import get_logger

logger = get_logger("nlp.custom_lola_assist.context")

_EMAIL_KEYS = ("email", "email_secondary")
_PHONE_KEYS = ("phone", "phone_secondary", "whatsapp_phone")
_VISITOR_KEYS = ("webchat_visitor", "instagram_user", "facebook_user", "whatsapp_phone")


@dataclass(frozen=True)
class LolaCustomerContext:
    block: str
    found: bool
    cdp_id: str
    email: str
    phone: str
    emails: tuple[str, ...] = ()
    phones: tuple[str, ...] = ()


def load_lola_customer_context(
    organization_id: str,
    *,
    cdp_id: str = "",
    email: str = "",
    phone: str = "",
    visitor_id: str = "",
    conversation_id: str = "",
    context_payload: dict[str, Any] | None = None,
) -> LolaCustomerContext:
    payload = context_payload or {}
    loaded = _empty_snapshot()
    if store_configured():
        try:
            loaded = _load_snapshot(
                organization_id,
                cdp_id=cdp_id,
                email=email,
                phone=phone,
                visitor_id=visitor_id,
                conversation_id=conversation_id,
            )
        except Exception:
            logger.warning(
                "lola assist context snapshot failed organization_id=%s",
                organization_id,
                exc_info=True,
            )

    resolved_id = str(loaded.get("cdp_id") or "")
    if resolved_id:
        loaded["appointment"] = _load_appointment(resolved_id)
    emails = tuple(str(value) for value in loaded.get("emails") or [] if str(value).strip())
    phones = tuple(str(value) for value in loaded.get("phones") or [] if str(value).strip())
    return LolaCustomerContext(
        block=_render(loaded, payload, conversation_id),
        found=bool(loaded.get("found")),
        cdp_id=resolved_id,
        email=emails[0] if emails else "",
        phone=phones[0] if phones else "",
        emails=emails,
        phones=phones,
    )


def _load_snapshot(
    organization_id: str,
    *,
    cdp_id: str,
    email: str,
    phone: str,
    visitor_id: str,
    conversation_id: str,
) -> dict[str, Any]:
    org_id = _organization_id(organization_id)
    if org_id is None:
        return _empty_snapshot()
    import psycopg

    with psycopg.connect(_connect_url(get_settings().database_url), connect_timeout=8) as conn:
        with conn.cursor() as cur:
            resolved = _resolve_cdp_id(
                cur,
                org_id,
                cdp_id=cdp_id,
                email=email,
                phone=phone,
                visitor_id=visitor_id,
            )
            if not resolved:
                return _empty_snapshot()
            profile = _profile(cur, org_id, resolved)
            if not profile:
                return _empty_snapshot()
            emails, phones = _identities(cur, org_id, resolved)
            return {
                "found": True,
                "cdp_id": resolved,
                "profile": profile,
                "emails": emails,
                "phones": phones,
                "tickets": _tickets(cur, org_id, emails),
                "pages": _pages(cur, org_id, resolved),
                "recommendation": _recommendation(cur, org_id, resolved),
                "sentiment": _previous_sentiment(
                    cur,
                    org_id,
                    resolved,
                    conversation_id,
                ),
                "appointment": None,
            }


def _resolve_cdp_id(
    cur,
    org_id: int,
    *,
    cdp_id: str,
    email: str,
    phone: str,
    visitor_id: str,
) -> str:
    if cdp_id:
        cur.execute(
            "SELECT 1 FROM cdp.customer_profile WHERE organization_id = %s AND cdp_id = %s",
            (org_id, cdp_id.strip()),
        )
        if cur.fetchone():
            return cdp_id.strip()
    candidates = [
        (_EMAIL_KEYS, email, False),
        (_PHONE_KEYS, phone, True),
        (_VISITOR_KEYS, visitor_id, False),
    ]
    if _digits(visitor_id):
        candidates.append((_PHONE_KEYS, visitor_id, True))
    for key_types, value, digits in candidates:
        if not str(value or "").strip():
            continue
        normalized_digits = _digits(value) if digits else ""
        cur.execute(
            """
            SELECT cdp_id
            FROM cdp.identity_keys
            WHERE organization_id = %s
              AND key_type = ANY(%s)
              AND (
                lower(key_value) = lower(%s)
                OR (%s <> '' AND regexp_replace(key_value, '\\D', '', 'g') = %s)
              )
            ORDER BY created_at
            LIMIT 1
            """,
            (org_id, list(key_types), value, normalized_digits, normalized_digits),
        )
        row = cur.fetchone()
        if row:
            return str(row[0])
    return ""


def _profile(cur, org_id: int, cdp_id: str) -> dict[str, Any] | None:
    cur.execute(
        """
        SELECT first_name, last_name, city, country, company, contact_type,
               acquisition_channel, first_seen_at, last_seen_at, custom_fields
        FROM cdp.customer_profile
        WHERE organization_id = %s AND cdp_id = %s
        LIMIT 1
        """,
        (org_id, cdp_id),
    )
    row = cur.fetchone()
    if not row:
        return None
    custom = _json_object(row[9])
    return {
        "name": " ".join(str(part).strip() for part in row[:2] if str(part or "").strip()),
        "city": row[2] or "",
        "country": row[3] or "",
        "company": row[4] or "",
        "contact_type": row[5] or "",
        "acquisition_channel": row[6] or "",
        "first_seen": row[7],
        "last_seen": row[8],
        "summary": str(custom.get("omniChannelSummary") or "").strip(),
        "summary_updated": custom.get("omniChannelSummaryUpdatedAt"),
    }


def _identities(cur, org_id: int, cdp_id: str) -> tuple[list[str], list[str]]:
    cur.execute(
        """
        SELECT key_type, key_value
        FROM cdp.identity_keys
        WHERE organization_id = %s AND cdp_id = %s AND key_type = ANY(%s)
        ORDER BY created_at
        """,
        (org_id, cdp_id, list(_EMAIL_KEYS + _PHONE_KEYS)),
    )
    emails: list[str] = []
    phones: list[str] = []
    for key_type, key_value in cur.fetchall():
        value = str(key_value or "").strip()
        if key_type in _EMAIL_KEYS and value and value.lower() not in {
            item.lower() for item in emails
        }:
            emails.append(value)
        elif key_type in _PHONE_KEYS and value and _digits(value) not in {
            _digits(item) for item in phones
        }:
            phones.append(value)
    return emails, phones


def _tickets(cur, org_id: int, emails: list[str]) -> list[dict[str, Any]]:
    lowered = [item.lower() for item in emails if item]
    if not lowered:
        return []
    cur.execute(
        """
        SELECT ticket_number, status, subject, updated_at
        FROM ticketing.tickets
        WHERE organization_id = %s AND lower(customer_email) = ANY(%s)
        ORDER BY updated_at DESC NULLS LAST
        """,
        (org_id, lowered),
    )
    return [
        {
            "number": str(number or ""),
            "status": status or "",
            "subject": subject or "",
            "updated": updated,
        }
        for number, status, subject, updated in cur.fetchall()
    ]


def _pages(cur, org_id: int, cdp_id: str) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT page_title, page_path, occurred_at
        FROM cdp.customer_events
        WHERE organization_id = %s
          AND cdp_id = %s
          AND event_name IN ('page_view', 'page_transition')
        ORDER BY occurred_at DESC
        LIMIT 5
        """,
        (org_id, cdp_id),
    )
    return [
        {"title": title or "", "path": path or "", "viewed_at": viewed_at}
        for title, path, viewed_at in cur.fetchall()
    ]


def _recommendation(cur, org_id: int, cdp_id: str) -> dict[str, Any] | None:
    cur.execute(
        """
        SELECT recommendation, generated_at
        FROM cdp.customer_recommendations
        WHERE organization_id = %s
          AND cdp_id = %s
          AND recommendation_type = 'next_best_action'
        ORDER BY generated_at DESC
        LIMIT 1
        """,
        (org_id, cdp_id),
    )
    row = cur.fetchone()
    return (
        {"recommendation": str(row[0] or "").strip(), "generated_at": row[1]}
        if row
        else None
    )


def _previous_sentiment(
    cur,
    org_id: int,
    cdp_id: str,
    conversation_id: str,
) -> dict[str, Any] | None:
    current = int(conversation_id) if str(conversation_id).isdigit() else None
    cur.execute(
        """
        SELECT sentiment.customer_label,
               sentiment.customer_score,
               sentiment.rationale->>'customer',
               sentiment.created_at
        FROM ccass.conversations conversation
        INNER JOIN LATERAL (
          SELECT customer_label, customer_score, rationale, created_at
          FROM ccass.conversation_sentiment_turns
          WHERE organization_id = conversation.organization_id
            AND conversation_id = conversation.id
          ORDER BY created_at DESC
          LIMIT 1
        ) sentiment ON TRUE
        WHERE conversation.organization_id = %s
          AND conversation.contact_id = %s
          AND (%s::bigint IS NULL OR conversation.id <> %s::bigint)
        ORDER BY conversation.updated_at DESC
        LIMIT 1
        """,
        (org_id, cdp_id, current, current),
    )
    row = cur.fetchone()
    return (
        {
            "label": row[0],
            "score": row[1],
            "rationale": row[2] or "",
            "at": row[3],
        }
        if row
        else None
    )


def _load_appointment(cdp_id: str) -> dict[str, Any] | None:
    try:
        response = get_crm_appointment_by_contact(cdp_id)
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            logger.warning("lola assist appointment lookup returned status=%s", response.status_code)
            return None
        body = response.json() if getattr(response, "content", None) else {}
        appointment = body.get("appointment") if isinstance(body, dict) else None
        if not isinstance(appointment, dict) and isinstance(body, dict) and body.get("id"):
            appointment = body
        if not isinstance(appointment, dict) or not appointment.get("id"):
            return None
        if str(appointment.get("status") or "").lower() == "canceled":
            return None
        return appointment
    except Exception:
        logger.warning("lola assist appointment lookup failed", exc_info=True)
        return None


def _render(
    loaded: dict[str, Any],
    context_payload: dict[str, Any],
    conversation_id: str,
) -> str:
    profile = loaded.get("profile") or {}
    sections = [
        "Customer profile:\n"
        + (
            "\n".join(
                [
                    f"- Name: {_text(profile.get('name'))}",
                    f"- Company: {_text(profile.get('company'))}",
                    f"- City: {_text(profile.get('city'))}",
                    f"- Country: {_text(profile.get('country'))}",
                    f"- Contact type: {_text(profile.get('contact_type'))}",
                ]
            )
            if profile
            else "none"
        ),
        _identity_section(loaded.get("emails") or [], loaded.get("phones") or []),
        _ticket_section(loaded.get("tickets") or []),
        _appointment_section(loaded.get("appointment")),
        _page_section(loaded.get("pages") or []),
        _recommendation_section(loaded.get("recommendation")),
        _sentiment_section(loaded.get("sentiment")),
        "Omni-channel summary:\n"
        f"- Summary: {_text(profile.get('summary'))}"
        f" | Updated: {_when(profile.get('summary_updated'))}",
        *_memory_sections(context_payload, conversation_id),
    ]
    return "Verified Worktual customer context:\n\n" + "\n\n".join(sections)


def _identity_section(emails: list[str], phones: list[str]) -> str:
    lines = [f"- Email: {value}" for value in emails]
    lines.extend(f"- Phone: {value}" for value in phones)
    return "Identity:\n" + ("\n".join(lines) if lines else "none")


def _ticket_section(tickets: list[dict[str, Any]]) -> str:
    if not tickets:
        return "Existing tickets:\nnone"
    return "Existing tickets:\n" + "\n".join(
        f"{index}. Ticket: {_text(ticket.get('number'))}"
        f" | Status: {_text(ticket.get('status'))}"
        f" | Subject: {_text(ticket.get('subject'))}"
        f" | Updated: {_when(ticket.get('updated'))}"
        for index, ticket in enumerate(tickets, start=1)
    )


def _appointment_section(appointment: dict[str, Any] | None) -> str:
    if not appointment:
        return "Live appointment:\nnone"
    return (
        "Live appointment:\n"
        f"- Appointment id: {_text(appointment.get('id'))}"
        f" | Status: {_text(appointment.get('status') or 'scheduled')}"
        f" | Starts at: {_when(appointment.get('startsAt'))}"
        f" | Join URL: {_text(appointment.get('joinUrl'))}"
    )


def _page_section(pages: list[dict[str, Any]]) -> str:
    if not pages:
        return "Recent website pages:\nnone"
    return "Recent website pages:\n" + "\n".join(
        f"{index}. Title: {_text(page.get('title'))}"
        f" | Path: {_text(page.get('path'))}"
        f" | Viewed at: {_when(page.get('viewed_at'))}"
        for index, page in enumerate(pages, start=1)
    )


def _recommendation_section(value: dict[str, Any] | None) -> str:
    if not value or not value.get("recommendation"):
        return "Next best action:\nnone"
    return (
        "Next best action:\n"
        f"- Recommendation: {_text(value.get('recommendation'))}"
        f" | Generated at: {_when(value.get('generated_at'))}"
    )


def _sentiment_section(value: dict[str, Any] | None) -> str:
    if not value:
        return "Previous sentiment:\nnone"
    return (
        "Previous sentiment:\n"
        f"- Label: {_text(value.get('label'))}"
        f" | Rationale: {_text(value.get('rationale'))}"
        f" | At: {_when(value.get('at'))}"
    )


def _memory_sections(context_payload: dict[str, Any], conversation_id: str) -> list[str]:
    messages = context_payload.get("messages")
    lines: list[str] = []
    if isinstance(messages, list):
        for item in messages[-20:]:
            if not isinstance(item, dict):
                continue
            role = _text(item.get("role") or item.get("senderType"))
            body = _text(item.get("body") or item.get("content"))
            if body != "none":
                lines.append(f"- {role}: {body}")

    prior: list[str] = []
    rows = context_payload.get("crossChannelSummary")
    if isinstance(rows, list):
        for item in rows:
            if not isinstance(item, dict):
                continue
            if str(item.get("conversationId") or "") == conversation_id:
                continue
            prior.append(
                f"{len(prior) + 1}. Channel: {_text(item.get('channel'))}"
                f" | Summary: {_text(item.get('summary'))}"
                f" | Occurred at: {_when(item.get('occurredAt'))}"
            )
            if len(prior) >= 5:
                break
    return [
        "This conversation:\n" + ("\n".join(lines) if lines else "none"),
        "Prior interactions:\n" + ("\n".join(prior) if prior else "none"),
    ]


def _empty_snapshot() -> dict[str, Any]:
    return {
        "found": False,
        "cdp_id": "",
        "profile": {},
        "emails": [],
        "phones": [],
        "tickets": [],
        "pages": [],
        "recommendation": None,
        "sentiment": None,
        "appointment": None,
    }


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _digits(value: Any) -> str:
    return "".join(character for character in str(value or "") if character.isdigit())


def _text(value: Any) -> str:
    text = " ".join(str(value or "").split())
    return text or "none"


def _when(value: Any) -> str:
    if value in (None, ""):
        return "none"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    text = str(value).replace("T", " ")
    return text[:16] if len(text) >= 16 else _text(text)
