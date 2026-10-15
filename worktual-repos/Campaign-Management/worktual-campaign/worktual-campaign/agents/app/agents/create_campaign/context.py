"""Org + audience context loaders (cached)."""

from __future__ import annotations

import time
from typing import Any

import httpx

from app.config import get_settings
from app.session_store import get_or_create_session, save_session

_SUMMARY_CACHE_TTL_S = 300.0
_summary_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _compact_summary(raw: dict[str, Any]) -> dict[str, Any]:
    def rows(key: str, limit: int = 12) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for row in raw.get(key) or []:
            if not isinstance(row, dict):
                continue
            label = str(row.get("label") or "").strip()
            count = int(row.get("count") or 0)
            if not label or count <= 0:
                continue
            out.append({"label": label, "count": count})
        return out[:limit]

    return {
        "total_contacts": int(raw.get("total_contacts") or 0),
        "with_email": int(raw.get("with_email") or 0),
        "with_phone": int(raw.get("with_phone") or 0),
        "by_city": rows("by_city"),
        "by_segment": rows("by_segment"),
        "by_company": rows("by_company", 10),
        "join_windows": rows("join_windows", 5),
    }


async def load_audience_segmentation_summary(token: str) -> dict[str, Any]:
    cache_key = (token or "")[-24:] or "anon"
    now = time.monotonic()
    cached = _summary_cache.get(cache_key)
    if cached and (now - cached[0]) < _SUMMARY_CACHE_TTL_S:
        return dict(cached[1])

    settings = get_settings()
    url = f"{settings.campaign_api_base.rstrip('/')}/contacts/audience-summary"
    headers = {"Authorization": f"Bearer {token}"}
    empty = _compact_summary({})
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            body = res.json()
        raw = body.get("summary") or (body.get("data") or {}).get("summary") or {}
        if isinstance(raw, dict):
            compact = _compact_summary(raw)
            _summary_cache[cache_key] = (now, compact)
            return compact
    except Exception:  # noqa: BLE001
        pass
    _summary_cache[cache_key] = (now, empty)
    return empty


async def ensure_audience_summary(session_id: str, token: str) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    existing = session.get("audience_segmentation")
    if isinstance(existing, dict) and existing.get("total_contacts") is not None:
        return existing
    summary = await load_audience_segmentation_summary(token)
    session["audience_segmentation"] = summary
    await save_session(session)
    return summary


def invalidate_audience_summary_cache(token: str | None = None) -> None:
    """Drop TTL cache so the next ensure_* reloads from API."""
    if token:
        key = (token or "")[-24:] or "anon"
        _summary_cache.pop(key, None)
    else:
        _summary_cache.clear()


async def refresh_audience_summary(session_id: str, token: str) -> dict[str, Any]:
    """Force-refresh session + TTL cache (e.g. after contact create/import)."""
    invalidate_audience_summary_cache(token)
    session = await get_or_create_session(session_id)
    session.pop("audience_segmentation", None)
    await save_session(session)
    return await ensure_audience_summary(session_id, token)


def format_audience_summary_for_prompt(
    summary: dict[str, Any] | None,
    *,
    max_rows: int = 5,
) -> str:
    """Compact CRM peek for the strategist (totals + top rows only)."""
    s = summary if isinstance(summary, dict) else {}
    total = int(s.get("total_contacts") or 0)
    if total <= 0:
        return (
            "No contacts in CRM yet. For a named email/phone, call check_contacts then "
            "create_contact if missing (reuse the email/phone already given). "
            "For bulk lists, they can upload CSV in Audience."
        )
    lines = [
        f"Total contacts: {total}",
        f"Reachable — email: {int(s.get('with_email') or 0)}, phone: {int(s.get('with_phone') or 0)}",
    ]

    def append_section(title: str, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        bits = [f"{r.get('label')} ({r.get('count')})" for r in rows[:max_rows]]
        lines.append(f"{title}: " + ", ".join(bits))

    append_section("By segment", s.get("by_segment") or [])
    append_section("By city", s.get("by_city") or [])
    append_section("By company", s.get("by_company") or [])
    append_section("Joined", s.get("join_windows") or [])
    lines.append(
        "Offer these real segments or named emails/phones; call select_audience / "
        "lookup_contacts when they choose."
    )
    return "\n".join(lines)


"""Org bootstrap — filterable fields + channel scope for create-campaign."""

from app.agents.create_campaign.filtering import load_filterable_fields

_ALLOWED_CHANNELS = [
    {"id": "email", "label": "Email"},
    {"id": "whatsapp", "label": "WhatsApp"},
    {"id": "web", "label": "Web push"},
    {"id": "push", "label": "App push"},
]


async def ensure_org_context(
    session_id: str,
    token: str,
    *,
    force: bool = False,
) -> dict[str, Any]:
    session = await get_or_create_session(session_id)
    existing = session.get("org_context")
    if (
        not force
        and isinstance(existing, dict)
        and existing.get("filterable_fields")
    ):
        return existing

    fields = await load_filterable_fields(token)
    compact = [
        {
            "key": str(f.get("key") or ""),
            "source": str(f.get("source") or ""),
            "description": str(f.get("description") or f.get("key") or ""),
        }
        for f in fields
        if f.get("key")
    ]
    ctx = {
        "filterable_fields": compact,
        "channels_available": list(_ALLOWED_CHANNELS),
        "channels_excluded": ["sms", "ppc"],
        "filter_help": (
            "Contacts can be filtered by emails, phones, search (name), "
            "and org-specific fields listed in filterable_fields."
        ),
    }
    session["org_context"] = ctx
    await save_session(session)
    return ctx


def filter_field_summary(
    org_context: dict[str, Any] | None,
    *,
    max_fields: int = 12,
) -> str:
    if not org_context:
        return "Emails, phones, and name search."
    lines = ["Filter by: emails, phones, search (name)"]
    n = 0
    for row in org_context.get("filterable_fields") or []:
        if not isinstance(row, dict):
            continue
        key = str(row.get("key") or "").strip()
        if key in ("emails", "phones", "search") or not key:
            continue
        desc = str(row.get("description") or key)
        lines.append(f"- {key}: {desc}")
        n += 1
        if n >= max_fields:
            break
    return "\n".join(lines)


__all__ = [
    "ensure_org_context",
    "ensure_audience_summary",
    "filter_field_summary",
    "format_audience_summary_for_prompt",
    "invalidate_audience_summary_cache",
    "refresh_audience_summary",
]
