"""Compact facts from a stored session template card (not chat-intent parsing)."""

from __future__ import annotations

from typing import Any

from app.text_cleanup import strip_html_tags

_BODY_PLAIN_MAX = 1200


def _norm_ch(value: Any) -> str:
    ch = str(value or "").strip().lower()
    if ch == "web_push":
        return "web"
    if ch == "app_push":
        return "push"
    return ch


def _fields(card: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(card, dict):
        return {}
    raw = card.get("fields")
    return dict(raw) if isinstance(raw, dict) else {}


def compiled_html(card: dict[str, Any] | None) -> str:
    fields = _fields(card)
    html = str(fields.get("compiled_html") or fields.get("html") or "").strip()
    return html


def hero_media_url(card: dict[str, Any] | None) -> str:
    """First campaign /api/media/ hero on the card — empty if none."""
    from app.mas.phase2_compose.html_images import is_campaign_media_url

    fields = _fields(card)
    for key in ("header_image", "image_url", "image", "header_media_url"):
        url = str(fields.get(key) or "").strip()
        if is_campaign_media_url(url):
            return url
    for row in fields.get("image_assets") or []:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "").strip()
        if is_campaign_media_url(url):
            return url
    html = compiled_html(card)
    if "/api/media/" in html.lower():
        lower = html.lower()
        idx = lower.find("/api/media/")
        # Walk back to http(s) if present.
        start = html.rfind("http", 0, idx)
        if start < 0:
            start = idx
        end = start
        while end < len(html) and html[end] not in "\"' >":
            end += 1
        url = html[start:end].strip()
        if is_campaign_media_url(url):
            return url
    return ""


def image_media_urls(card: dict[str, Any] | None) -> list[str]:
    from app.mas.phase2_compose.html_images import is_campaign_media_url

    seen: list[str] = []
    hero = hero_media_url(card)
    if hero:
        seen.append(hero)
    fields = _fields(card)
    for row in fields.get("image_assets") or []:
        if not isinstance(row, dict):
            continue
        url = str(row.get("url") or "").strip()
        if is_campaign_media_url(url) and url not in seen:
            seen.append(url)
    return seen


def pick_session_template(
    session: dict[str, Any] | None,
    *,
    template_id: str = "",
    channel: str = "",
) -> dict[str, Any] | None:
    """Latest matching card. Explicit template_id wins; else latest for channel or last email."""
    rows = [
        t
        for t in ((session or {}).get("templates") or [])
        if isinstance(t, dict) and str(t.get("template_id") or t.get("id") or "").strip()
    ]
    if not rows:
        return None
    tid = str(template_id or "").strip()
    if tid:
        for row in reversed(rows):
            if str(row.get("template_id") or row.get("id") or "").strip() == tid:
                return row
        return None
    ch = _norm_ch(channel)
    if ch:
        for row in reversed(rows):
            if _norm_ch(row.get("channel")) == ch:
                return row
        return None
    for row in reversed(rows):
        if _norm_ch(row.get("channel")) == "email":
            return row
    return rows[-1]


def compact_template_extract(card: dict[str, Any] | None) -> dict[str, Any]:
    """Facts for the main-chat LLM — no compiled_html."""
    if not isinstance(card, dict):
        return {}
    fields = _fields(card)
    html = compiled_html(card)
    plain = strip_html_tags(html) if html else ""
    if len(plain) > _BODY_PLAIN_MAX:
        plain = plain[:_BODY_PLAIN_MAX].rstrip() + "…"
    tid = str(card.get("template_id") or card.get("id") or "").strip()
    out: dict[str, Any] = {
        "template_id": tid,
        "channel": _norm_ch(card.get("channel")) or "email",
        "subject": str(fields.get("subject") or "").strip(),
        "preheader": str(fields.get("preheader") or "").strip(),
        "body_plain": plain,
        "word_count": len(plain.split()) if plain else 0,
        "html_len": len(html),
        "hero_url": hero_media_url(card),
        "image_urls": image_media_urls(card),
    }
    prior = str(card.get("prior_template_id") or "").strip()
    if prior:
        out["prior_template_id"] = prior
    return out
