"""One labeled CDP snapshot for a Booxoo assist session and the chat bot.

Email does not use this module. The assist and the webchat or social bot both call
load_customer_context.
"""

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
from app.config import get_settings
from app.logging import get_logger

logger = get_logger("nlp.custom_booxoo_assist.context")

_EMAIL_KEYS = ("email", "email_secondary")
_PHONE_KEYS = ("phone", "phone_secondary", "whatsapp_phone")
_VISITOR_KEYS = ("webchat_visitor", "instagram_user", "facebook_user", "whatsapp_phone")


@dataclass(frozen=True)
class CustomerContext:
    block: str
    found: bool
    email: str
    phone: str
    emails: tuple[str, ...] = ()
    phones: tuple[str, ...] = ()


def load_customer_context(
    organization_id: str,
    *,
    cdp_id: str = "",
    email: str = "",
    phone: str = "",
    visitor_id: str = "",
    conversation_id: str = "",
    context_payload: dict[str, Any] | None = None,
) -> CustomerContext:
    memory = _memory_sections(context_payload or {}, conversation_id)
    if not store_configured():
        return CustomerContext(_render(_empty_cdp(), memory), False, "", "")
    try:
        loaded = _load_cdp(
            organization_id,
            cdp_id=cdp_id,
            email=email,
            phone=phone,
            visitor_id=visitor_id,
        )
    except Exception:
        logger.warning("booxoo assist context snapshot failed organization_id=%s", organization_id)
        loaded = _empty_cdp()
    emails = tuple(str(item) for item in (loaded.get("emails") or []) if str(item).strip())
    phones = tuple(str(item) for item in (loaded.get("phones") or []) if str(item).strip())
    return CustomerContext(
        _render(loaded, memory),
        bool(loaded.get("found")),
        str(loaded.get("email") or ""),
        str(loaded.get("phone") or ""),
        emails,
        phones,
    )


def _load_cdp(
    organization_id: str,
    *,
    cdp_id: str,
    email: str,
    phone: str,
    visitor_id: str,
) -> dict[str, Any]:
    org_id = _organization_id(organization_id)
    if org_id is None:
        return _empty_cdp()
    import psycopg

    with psycopg.connect(_connect_url(get_settings().database_url), connect_timeout=8) as conn:
        with conn.cursor() as cur:
            resolved = _resolve_cdp_id(
                cur,
                org_id,
                cdp_id=cdp_id.strip(),
                email=email.strip(),
                phone=phone.strip(),
                visitor_id=visitor_id.strip(),
            )
            if not resolved:
                return _empty_cdp()
            profile = _profile(cur, org_id, resolved)
            if not profile:
                return _empty_cdp()
            emails, phones = _identity(cur, org_id, resolved)
            return {
                "found": True,
                "profile": profile,
                "emails": emails,
                "phones": phones,
                "email": emails[0] if emails else "",
                "phone": phones[0] if phones else "",
                "orders": _orders(cur, org_id, resolved),
                "tickets": _tickets(cur, org_id, emails),
                "recommendation": _recommendation(cur, org_id, resolved),
                "pages": _pages(cur, org_id, resolved),
            }


def _resolve_cdp_id(cur, org_id: int, *, cdp_id: str, email: str, phone: str, visitor_id: str) -> str:
    if cdp_id and _profile_exists(cur, org_id, cdp_id):
        return cdp_id
    if email:
        found = _find_key(cur, org_id, _EMAIL_KEYS, email, digits=False)
        if found:
            return found
    if phone:
        found = _find_key(cur, org_id, _PHONE_KEYS, phone, digits=True)
        if found:
            return found
    if visitor_id:
        found = _find_key(cur, org_id, _VISITOR_KEYS, visitor_id, digits=False)
        if found:
            return found
        if _digits(visitor_id):
            found = _find_key(cur, org_id, _PHONE_KEYS, visitor_id, digits=True)
            if found:
                return found
    return ""


def _profile_exists(cur, org_id: int, cdp_id: str) -> bool:
    cur.execute(
        """
        SELECT 1
        FROM cdp.customer_profile
        WHERE organization_id = %s AND cdp_id = %s
        LIMIT 1
        """,
        (org_id, cdp_id),
    )
    return cur.fetchone() is not None


def _find_key(cur, org_id: int, key_types: tuple[str, ...], value: str, *, digits: bool) -> str:
    digits_value = _digits(value) if digits else ""
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
        LIMIT 1
        """,
        (org_id, list(key_types), value, digits_value, digits_value),
    )
    row = cur.fetchone()
    return str(row[0]) if row else ""


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
        "name": " ".join(part.strip() for part in (row[0] or "", row[1] or "") if str(part or "").strip()),
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


def _identity(cur, org_id: int, cdp_id: str) -> tuple[list[str], list[str]]:
    cur.execute(
        """
        SELECT key_type, key_value
        FROM cdp.identity_keys
        WHERE organization_id = %s
          AND cdp_id = %s
          AND key_type = ANY(%s)
        ORDER BY created_at
        """,
        (org_id, cdp_id, list(_EMAIL_KEYS + _PHONE_KEYS)),
    )
    emails: list[str] = []
    phones: list[str] = []
    for key_type, key_value in cur.fetchall():
        value = str(key_value or "").strip()
        if not value:
            continue
        if key_type in _EMAIL_KEYS and value.lower() not in {item.lower() for item in emails}:
            emails.append(value)
        elif key_type in _PHONE_KEYS and value not in phones:
            phones.append(value)
    return emails, phones


def _orders(cur, org_id: int, cdp_id: str) -> list[dict[str, Any]]:
    cur.execute(
        """
        SELECT order_id, order_number, status, payment_status, fulfillment_status, created_at
        FROM cdp.orders
        WHERE organization_id = %s AND cdp_id = %s
        ORDER BY created_at DESC NULLS LAST
        LIMIT 3
        """,
        (org_id, cdp_id),
    )
    rows = list(cur.fetchall())
    if not rows:
        return []
    order_ids = [row[0] for row in rows]
    cur.execute(
        """
        SELECT oi.order_id, p.name, oi.custom_fields->>'sku'
        FROM cdp.order_items oi
        LEFT JOIN inventory.products p
          ON p.organization_id = oi.organization_id
         AND p.sku = oi.custom_fields->>'sku'
        WHERE oi.organization_id = %s
          AND oi.order_id = ANY(%s)
        ORDER BY oi.order_item_id
        """,
        (org_id, order_ids),
    )
    names: dict[str, list[str]] = {}
    for order_id, name, sku in cur.fetchall():
        label = str(name or sku or "").strip()
        if label:
            names.setdefault(str(order_id), []).append(label)
    orders = []
    for order_id, order_number, status, payment_status, fulfillment_status, created_at in rows:
        item_names = names.get(str(order_id), [])[:3]
        orders.append(
            {
                "order_number": str(order_number or order_id),
                "status": status or "",
                "payment_status": payment_status or "",
                "fulfillment_status": fulfillment_status or "",
                "date": created_at,
                "items": ", ".join(item_names),
            }
        )
    return orders


def _tickets(cur, org_id: int, emails: list[str]) -> list[dict[str, Any]]:
    lowered = [item.lower() for item in emails if item]
    if not lowered:
        return []
    cur.execute(
        """
        SELECT ticket_number, status, subject, updated_at
        FROM ticketing.tickets
        WHERE organization_id = %s
          AND lower(customer_email) = ANY(%s)
        ORDER BY updated_at DESC NULLS LAST
        """,
        (org_id, lowered),
    )
    return [
        {
            "ticket_number": str(ticket_number or ""),
            "status": status or "",
            "subject": subject or "",
            "updated": updated_at,
        }
        for ticket_number, status, subject, updated_at in cur.fetchall()
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
    if not row:
        return None
    return {"recommendation": str(row[0] or "").strip(), "generated_at": row[1]}


def _pages(cur, org_id: int, cdp_id: str) -> list[dict[str, Any]]:
    cur.execute(
        """
        WITH page_events AS (
          SELECT event_name, page_title, page_path, occurred_at, session_id,
                 LEAD(occurred_at) OVER (
                   PARTITION BY session_id
                   ORDER BY occurred_at
                 ) AS next_at
          FROM cdp.customer_events
          WHERE organization_id = %s
            AND cdp_id = %s
            AND session_id IS NOT NULL
            AND event_name IN ('page_view', 'page_transition')
        )
        SELECT page_title, page_path, occurred_at, next_at
        FROM page_events
        WHERE event_name = 'page_view'
        ORDER BY occurred_at DESC
        LIMIT 5
        """,
        (org_id, cdp_id),
    )
    return [
        {
            "title": title or "",
            "path": path or "",
            "viewed_at": viewed_at,
            "next_at": next_at,
        }
        for title, path, viewed_at, next_at in cur.fetchall()
    ]


def _empty_cdp() -> dict[str, Any]:
    return {
        "found": False,
        "profile": {},
        "emails": [],
        "phones": [],
        "email": "",
        "phone": "",
        "orders": [],
        "tickets": [],
        "recommendation": None,
        "pages": [],
    }


def _render(loaded: dict[str, Any], memory: list[str]) -> str:
    profile = loaded.get("profile") or {}
    sections = [
        _profile_section(profile),
        _identity_section(loaded.get("emails") or [], loaded.get("phones") or []),
        _order_section(loaded.get("orders") or []),
        _ticket_section(loaded.get("tickets") or []),
        _recommendation_section(loaded.get("recommendation")),
        _page_section(loaded.get("pages") or []),
        _summary_section(profile),
        *memory,
    ]
    return "Verified customer context:\n\n" + "\n\n".join(sections)


def _profile_section(profile: dict[str, Any]) -> str:
    if not profile:
        return "Customer profile:\nnone"
    lines = [
        f"- Name: {_text(profile.get('name'))}",
        f"- City: {_text(profile.get('city'))}",
        f"- Country: {_text(profile.get('country'))}",
        f"- Company: {_text(profile.get('company'))}",
        f"- Contact type: {_text(profile.get('contact_type'))}",
        f"- Acquisition channel: {_text(profile.get('acquisition_channel'))}",
        f"- First seen: {_when(profile.get('first_seen'))}",
        f"- Last seen: {_when(profile.get('last_seen'))}",
    ]
    return "Customer profile:\n" + "\n".join(lines)


def _identity_section(emails: list[str], phones: list[str]) -> str:
    lines = [f"- Email: {item}" for item in emails] + [f"- Phone: {item}" for item in phones]
    return "Identity:\n" + ("\n".join(lines) if lines else "none")


def _order_section(orders: list[dict[str, Any]]) -> str:
    if not orders:
        return "Latest orders:\nnone"
    lines = []
    for index, order in enumerate(orders, start=1):
        lines.append(
            f"{index}. Order number: {_text(order.get('order_number'))}"
            f" | Status: {_text(order.get('status'))}"
            f" | Payment status: {_text(order.get('payment_status'))}"
            f" | Fulfillment status: {_text(order.get('fulfillment_status'))}"
            f" | Date: {_when(order.get('date'))}"
            f" | Items: {_text(order.get('items'))}"
        )
    return "Latest orders:\n" + "\n".join(lines)


def _ticket_section(tickets: list[dict[str, Any]]) -> str:
    if not tickets:
        return "Latest tickets:\nnone"
    lines = []
    for index, ticket in enumerate(tickets, start=1):
        lines.append(
            f"{index}. Ticket number: {_text(ticket.get('ticket_number'))}"
            f" | Status: {_text(ticket.get('status'))}"
            f" | Subject: {_text(ticket.get('subject'))}"
            f" | Updated: {_when(ticket.get('updated'))}"
        )
    return "Latest tickets:\n" + "\n".join(lines)


def _recommendation_section(recommendation: dict[str, Any] | None) -> str:
    if not recommendation or not recommendation.get("recommendation"):
        return "Next best action:\n- Recommendation: none | Generated at: none"
    return (
        "Next best action:\n"
        f"- Recommendation: {_text(recommendation.get('recommendation'))}"
        f" | Generated at: {_when(recommendation.get('generated_at'))}"
    )


def _page_section(pages: list[dict[str, Any]]) -> str:
    if not pages:
        return "Website pages:\nnone"
    lines = []
    for index, page in enumerate(pages, start=1):
        lines.append(
            f"{index}. Page title: {_text(page.get('title'))}"
            f" | Path: {_text(page.get('path'))}"
            f" | Viewed at: {_when(page.get('viewed_at'))}"
            f" | Time spent: {_duration(page.get('viewed_at'), page.get('next_at'))}"
        )
    return "Website pages:\n" + "\n".join(lines)


def _summary_section(profile: dict[str, Any]) -> str:
    summary = _text(profile.get("summary")) if profile else "none"
    updated = _when(profile.get("summary_updated")) if profile and profile.get("summary") else "none"
    return f"Omni channel summary:\n- Summary: {summary} | Updated: {updated}"


def _memory_sections(context_payload: dict[str, Any], conversation_id: str) -> list[str]:
    bot_memory = context_payload.get("botMemory") if isinstance(context_payload.get("botMemory"), dict) else {}
    session_memory = (
        context_payload.get("sessionMemory") if isinstance(context_payload.get("sessionMemory"), dict) else {}
    )
    rolling = _text(bot_memory.get("rollingSummary"))
    long_term = _text(session_memory.get("longTermSummary"))
    facts = []
    for source in (bot_memory.get("extractedFacts"), session_memory.get("extractedFacts")):
        if not isinstance(source, list):
            continue
        for item in source:
            text = _text(item)
            if text != "none" and text not in facts:
                facts.append(text)
            if len(facts) >= 8:
                break
        if len(facts) >= 8:
            break
    lines = [f"- Rolling summary: {rolling}"]
    if long_term != "none" and long_term != rolling:
        lines.append(f"- Long-term summary: {long_term}")
    if facts:
        lines.extend(f"- Fact: {fact}" for fact in facts)
    elif rolling == "none" and long_term == "none":
        lines = ["none"]

    prior = []
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
        "This conversation:\n" + "\n".join(lines),
        "Prior channels:\n" + ("\n".join(prior) if prior else "none"),
    ]


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


def _digits(value: str) -> str:
    return "".join(ch for ch in value if ch.isdigit())


def _text(value: Any) -> str:
    text = " ".join(str(value or "").split())
    return text or "none"


def _when(value: Any) -> str:
    if value is None or value == "":
        return "none"
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M")
    text = str(value).replace("T", " ")
    return text[:16] if len(text) >= 16 else _text(text)


def _duration(start: Any, end: Any) -> str:
    if not isinstance(start, datetime) or not isinstance(end, datetime):
        return "unknown"
    seconds = int((end - start).total_seconds())
    if seconds < 0:
        return "unknown"
    if seconds < 60:
        return f"{seconds}s"
    minutes, remain = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m {remain}s" if remain else f"{minutes}m"
    hours, minutes = divmod(minutes, 60)
    return f"{hours}h {minutes}m" if minutes else f"{hours}h"
