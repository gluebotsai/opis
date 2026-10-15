"""Gallery hero / preview URL helpers — treat localhost as missing."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

from app.gallery.specs import (
    idea_qualifies_for_gallery_hero,
    template_specs_for_idea,
)


def is_local_only_media_url(url: str) -> bool:
    raw = str(url or "").strip()
    if not raw:
        return False
    try:
        if raw.lower().startswith("http://") or raw.lower().startswith("https://"):
            host = (urlparse(raw).hostname or "").lower()
            return host in {"127.0.0.1", "localhost", "0.0.0.0"}
    except Exception:  # noqa: BLE001
        pass
    return "127.0.0.1" in raw or "localhost" in raw.lower()


def is_reachable_media_url(url: str) -> bool:
    raw = str(url or "").strip()
    return (
        raw.lower().startswith("http://") or raw.lower().startswith("https://")
    ) and not is_local_only_media_url(raw)


def _as_fields(raw: Any) -> dict[str, Any] | None:
    if isinstance(raw, dict):
        return raw
    return None


def hero_url_from_fields(fields: dict[str, Any]) -> str:
    for key in ("header_image", "image_url", "header_media_url"):
        url = str(fields.get(key) or "").strip()
        if is_reachable_media_url(url):
            return url
    sections = fields.get("sections")
    if isinstance(sections, list):
        for row in sections:
            if not isinstance(row, dict):
                continue
            kind = str(row.get("type") or "").lower()
            if kind != "image":
                continue
            url = str(row.get("url") or row.get("content") or "").strip()
            if is_reachable_media_url(url):
                return url
    return ""


def email_gallery_template_has_hero(row: dict[str, Any]) -> bool:
    fields = _as_fields(row.get("fields"))
    field_url = hero_url_from_fields(fields) if fields else ""
    preview = str(row.get("previewImage") or row.get("preview_image") or "").strip()
    return is_reachable_media_url(field_url) or is_reachable_media_url(preview)


def email_gallery_template_needs_hero_attach(row: dict[str, Any]) -> bool:
    channel = str(row.get("primaryChannel") or row.get("primary_channel") or "")
    if channel != "email":
        return False
    fields = _as_fields(row.get("fields"))
    if not fields:
        return False
    sections = fields.get("sections")
    if not isinstance(sections, list) or len(sections) == 0:
        return False
    if email_gallery_template_has_hero(row):
        return False
    return True


def web_push_gallery_template_has_image(row: dict[str, Any]) -> bool:
    fields = _as_fields(row.get("fields"))
    field_url = hero_url_from_fields(fields) if fields else ""
    preview = str(row.get("previewImage") or row.get("preview_image") or "").strip()
    if is_reachable_media_url(field_url) or is_reachable_media_url(preview):
        return True
    meta = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    if meta.get("galleryHeroAttached") is True:
        return False
    prev = row.get("preview") if isinstance(row.get("preview"), dict) else None
    return bool(prev and prev.get("kind") == "web_visual")


def web_push_gallery_template_needs_image_sync(row: dict[str, Any]) -> bool:
    channel = str(row.get("primaryChannel") or row.get("primary_channel") or "")
    if channel != "web_push":
        return False
    fields = _as_fields(row.get("fields"))
    if not fields:
        return False
    if not str(fields.get("title") or fields.get("body") or "").strip():
        return False
    if web_push_gallery_template_has_image(row):
        return False
    return True


def hero_attach_targets_for_org(
    ideas: list[dict[str, Any]],
    channels: list[str],
    rows_by_key: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    targets: list[dict[str, Any]] = []
    for idea in ideas:
        sort_order = int(idea.get("sortOrder") or idea.get("sort_order") or 0)
        if not idea_qualifies_for_gallery_hero(sort_order):
            continue
        idea_key = str(idea.get("ideaKey") or idea.get("idea_key") or "").strip()
        if not idea_key:
            continue
        specs = template_specs_for_idea(idea_key, sort_order, channels)
        email_spec = next((s for s in specs if s["primary_channel"] == "email"), None)
        if not email_spec:
            continue
        row = rows_by_key.get(email_spec["gallery_key"])
        if not row:
            continue
        check = {
            **row,
            "primaryChannel": "email",
            "seedSlug": email_spec["gallery_key"],
            "galleryKey": email_spec["gallery_key"],
        }
        if not email_gallery_template_needs_hero_attach(check):
            continue
        targets.append(
            {
                "kind": "email_attach",
                "galleryKey": email_spec["gallery_key"],
                "ideaKey": idea_key,
                "sortOrder": sort_order,
                "variantIndex": email_spec["variant_index"],
            }
        )
    return targets


def web_push_image_sync_targets_for_org(
    ideas: list[dict[str, Any]],
    channels: list[str],
    rows_by_key: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    targets: list[dict[str, Any]] = []
    for idea in ideas:
        sort_order = int(idea.get("sortOrder") or idea.get("sort_order") or 0)
        if not idea_qualifies_for_gallery_hero(sort_order):
            continue
        idea_key = str(idea.get("ideaKey") or idea.get("idea_key") or "").strip()
        if not idea_key:
            continue
        specs = template_specs_for_idea(idea_key, sort_order, channels)
        email_spec = next((s for s in specs if s["primary_channel"] == "email"), None)
        web_spec = next((s for s in specs if s["primary_channel"] == "web_push"), None)
        if not email_spec or not web_spec:
            continue
        email_row = rows_by_key.get(email_spec["gallery_key"])
        web_row = rows_by_key.get(web_spec["gallery_key"])
        if not email_row or not web_row:
            continue
        if not email_gallery_template_has_hero(email_row):
            continue
        if not web_push_gallery_template_needs_image_sync(
            {**web_row, "primaryChannel": "web_push"}
        ):
            continue
        email_fields = _as_fields(email_row.get("fields"))
        email_image_url = str(
            email_row.get("previewImage") or email_row.get("preview_image") or ""
        ).strip() or (hero_url_from_fields(email_fields) if email_fields else "")
        if not is_reachable_media_url(email_image_url):
            continue
        targets.append(
            {
                "kind": "web_push_sync",
                "galleryKey": web_spec["gallery_key"],
                "emailGalleryKey": email_spec["gallery_key"],
                "ideaKey": idea_key,
                "sortOrder": sort_order,
                "variantIndex": web_spec["variant_index"],
                "emailImageUrl": email_image_url,
            }
        )
    return targets


def gallery_image_work_targets_for_org(
    ideas: list[dict[str, Any]],
    channels: list[str],
    rows_by_key: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    return [
        *hero_attach_targets_for_org(ideas, channels, rows_by_key),
        *web_push_image_sync_targets_for_org(ideas, channels, rows_by_key),
    ]
