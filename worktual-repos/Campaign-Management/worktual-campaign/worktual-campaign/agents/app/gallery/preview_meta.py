"""Map agent fields → library preview metadata for Template Gallery cards."""

from __future__ import annotations

from typing import Any

_VISUAL_KEYS = (
    "launch",
    "webinar",
    "renewal",
    "handshake",
    "dashboard",
    "growth",
    "calendar",
    "offer",
    "announce",
    "checklist",
    "pipeline",
    "demo",
    "boardroom",
    "security",
    "support",
    "team",
    "mobile",
    "feedback",
)


def _visual_key_for_variant(variant_index: int, design_plan: dict[str, Any] | None) -> str:
    if isinstance(design_plan, dict):
        theme = str(design_plan.get("theme_id") or design_plan.get("pattern_id") or "").strip()
        if theme and theme in _VISUAL_KEYS:
            return theme
    idx = max(0, int(variant_index or 1) - 1)
    return _VISUAL_KEYS[idx % len(_VISUAL_KEYS)]


def _email_bullets(fields: dict[str, Any]) -> list[str]:
    sections = fields.get("sections")
    if not isinstance(sections, list):
        return []
    bullets: list[str] = []
    for row in sections:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("type") or "text").strip().lower()
        if kind in ("divider", "cta", "secondary_link", "image"):
            continue
        content = str(row.get("content") or "").strip()
        if content:
            bullets.append(content[:200])
        items = row.get("items")
        if isinstance(items, list):
            for item in items:
                text = str(item or "").strip()
                if text:
                    bullets.append(text[:200])
        if len(bullets) >= 4:
            break
    return bullets[:4]


def _body_text(fields: dict[str, Any]) -> str:
    paras = fields.get("paragraphs")
    if isinstance(paras, list):
        for row in paras:
            text = str(row or "").strip()
            if text:
                return text[:2000]
    body = str(fields.get("body") or fields.get("message") or fields.get("text") or "").strip()
    return body[:2000]


def _headline(fields: dict[str, Any], fallback: str) -> str:
    return str(
        fields.get("subject")
        or fields.get("title")
        or fields.get("headline")
        or fallback
    ).strip()[:200]


def _image_url_from_fields(fields: dict[str, Any], agent_channel: str) -> str | None:
    ch = agent_channel.strip().lower()
    if ch == "email":
        url = str(fields.get("header_image") or fields.get("image_url") or "").strip()
        return url or None
    if ch == "whatsapp":
        url = str(fields.get("header_media_url") or fields.get("image_url") or "").strip()
        return url or None
    if ch in ("web_push", "web"):
        url = str(fields.get("image_url") or fields.get("header_image") or "").strip()
        return url or None
    return None


def build_library_preview_meta(
    *,
    fields: dict[str, Any],
    primary_channel: str,
    agent_channel: str,
    has_image: bool,
    variant_index: int,
    idea_title: str,
    design_plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Produce preview JSON matching frontend TemplatePreviewKind."""
    headline = _headline(fields, idea_title)
    body = _body_text(fields)
    visual_key = _visual_key_for_variant(variant_index, design_plan)
    cta = str(fields.get("cta_label") or fields.get("button_text") or "").strip() or None

    ch = primary_channel.strip().lower()
    ac = agent_channel.strip().lower()

    if ch == "email" or ac == "email":
        kind = "email_hero" if has_image else "email_text"
        return {
            "kind": kind,
            "visualKey": visual_key,
            "headline": headline,
            "subject": str(fields.get("subject") or headline).strip(),
            "body": body,
            "greeting": str(fields.get("greeting") or "Dear {{firstName}},").strip(),
            "bullets": _email_bullets(fields),
            "cta": cta,
            "closing": str(fields.get("signoff") or fields.get("footer") or "").strip() or None,
        }

    if ch == "whatsapp" or ac == "whatsapp":
        kind = "wa_media" if has_image else "wa_text"
        return {
            "kind": kind,
            "visualKey": visual_key,
            "headline": headline,
            "body": body,
            "footer": str(fields.get("footer") or "").strip() or "WhatsApp Business",
        }

    if ch == "web_push" or ac == "web":
        kind = "web_visual" if has_image else "web_text"
        return {
            "kind": kind,
            "visualKey": visual_key,
            "headline": headline,
            "body": body,
            "cta": cta,
        }

    if ch == "app_push" or ac == "push":
        kind = "app_visual" if has_image else "app_text"
        return {
            "kind": kind,
            "visualKey": visual_key,
            "headline": headline,
            "body": body,
            "iconKey": visual_key,
        }

    return {
        "kind": "email_text",
        "visualKey": visual_key,
        "headline": headline,
        "body": body,
    }


def preview_image_url(
    fields: dict[str, Any],
    agent_channel: str,
    explicit: str | None = None,
) -> str | None:
    if explicit and str(explicit).strip():
        return str(explicit).strip()
    return _image_url_from_fields(fields, agent_channel)
