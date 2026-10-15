"""Gallery template specs — source of truth for keys / channels / design version."""

from __future__ import annotations

from typing import Any

GALLERY_TEMPLATES_PER_CHANNEL = 10
GALLERY_EMAIL_HERO_IDEA_COUNT = 5
GALLERY_EMAIL_ONLY_PHASE = True
GALLERY_PHASE_CHANNELS = ("email", "web_push")
GALLERY_EMAIL_DESIGN_VERSION = "gallery-email-v2"
GALLERY_MIN_IDEAS = 10
MAX_TEMPLATE_FAILURES = 3

_CHANNEL_MAP = {
    "email": "email",
    "whatsapp": "whatsapp",
    "web_push": "web",
    "app_push": "push",
}


def agent_channel_for_gallery(ch: str) -> str:
    return _CHANNEL_MAP.get(ch, ch)


def idea_sort_order_has_image(sort_order: int) -> bool:
    return sort_order < GALLERY_EMAIL_HERO_IDEA_COUNT


def idea_qualifies_for_gallery_hero(sort_order: int) -> bool:
    return idea_sort_order_has_image(sort_order)


def active_gallery_channels(channels: list[str]) -> list[str]:
    if not GALLERY_EMAIL_ONLY_PHASE:
        return list(channels)
    allowed = set(GALLERY_PHASE_CHANNELS)
    return [ch for ch in channels if ch in allowed]


def template_specs_for_idea(
    idea_key: str,
    sort_order: int,
    channels: list[str],
) -> list[dict[str, Any]]:
    active = active_gallery_channels(channels)
    idea_has_image = idea_sort_order_has_image(sort_order)
    specs: list[dict[str, Any]] = []
    for ch in active:
        has_image = ch == "web_push" and idea_has_image
        specs.append(
            {
                "gallery_key": f"{idea_key}:{ch}:{'img' if has_image else 'txt'}:01",
                "channel": agent_channel_for_gallery(ch),
                "primary_channel": ch,
                "has_image": has_image,
                "variant_index": sort_order + 1,
            }
        )
    return specs


def expected_gallery_template_count(channels: list[str]) -> int:
    return len(active_gallery_channels(channels)) * GALLERY_TEMPLATES_PER_CHANNEL


def is_current_gallery_template_key(key: str) -> bool:
    import re

    return bool(
        re.match(
            r"^[^:]+:(email|whatsapp|web_push|app_push):(img|txt):01$",
            str(key or "").strip(),
        )
    )


def email_gallery_template_needs_regen(row: dict[str, Any]) -> bool:
    if str(row.get("primaryChannel") or row.get("primary_channel") or "") != "email":
        return False
    fields = row.get("fields")
    if not isinstance(fields, dict):
        return True
    meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    sections = fields.get("sections")
    if not isinstance(sections, list) or len(sections) == 0:
        return True
    if not fields.get("pattern_id"):
        return True
    if meta.get("galleryEmailDesignVersion") != GALLERY_EMAIL_DESIGN_VERSION:
        return True
    return False
