"""Build merged template field patches for image attach — never wipe copy."""

from __future__ import annotations

from typing import Any

from app.agents.image.hero_image import (
    default_image_insert_index,
    find_image_section_index,
    list_unfilled_image_section_indices,
    primary_header_url_from_sections,
)


def _text_blob(fields: dict[str, Any]) -> str:
    parts: list[str] = []
    subj = str(fields.get("subject") or "").strip()
    if subj:
        parts.append(subj)
    for p in fields.get("paragraphs") or []:
        text = str(p or "").strip()
        if text:
            parts.append(text)
    for row in fields.get("sections") or []:
        if not isinstance(row, dict):
            continue
        for key in ("content", "label"):
            text = str(row.get(key) or "").strip()
            if text:
                parts.append(text)
    return " ".join(parts)


def _scrub_url_only_text_sections(sections: list[Any], url: str) -> list[Any]:
    """Drop text rows that only carry a raw media URL (rendered as link in Gmail)."""
    target = str(url or "").strip()
    if not target:
        return sections
    cleaned: list[Any] = []
    for row in sections:
        if not isinstance(row, dict):
            cleaned.append(row)
            continue
        kind = str(row.get("type") or "").strip().lower()
        content = str(row.get("content") or "").strip()
        has_items = isinstance(row.get("items"), list) and bool(row.get("items"))
        has_label = bool(str(row.get("label") or "").strip())
        if (
            kind in {"text", ""}
            and content == target
            and not has_items
            and not has_label
        ):
            continue
        cleaned.append(row)
    return cleaned


def build_attach_fields(
    existing_fields: dict[str, Any],
    *,
    image_url: str,
    field_key: str = "header_image",
    section_index: int | None = None,
    only_section_index: int | None = None,
) -> dict[str, Any]:
    """Return a PATCH payload that merges image into existing template fields."""
    from app.agents.image.hero_image import is_http_image_url

    prior: dict[str, Any] = dict(existing_fields or {})
    from app.agents.image.media_upload import absolutize_media_url, stamp_template_media_url

    raw_url = str(image_url or "").strip()
    url = stamp_template_media_url(raw_url) or raw_url
    if url == raw_url:
        url = absolutize_media_url(raw_url)
    if not is_http_image_url(url):
        # Refuse landing / merge-tag URLs — no hero patch.
        return {}
    key = str(field_key or "header_image").strip() or "header_image"
    patch: dict[str, Any] = {
        key: url,
        "image_url": url,
    }
    if key == "header_image":
        patch["header_image"] = url
    elif key == "header_media_url":
        patch["header_media_url"] = url
        patch["header_format"] = "IMAGE"

    sections = prior.get("sections")
    if isinstance(sections, list):
        if only_section_index is None:
            unfilled = list_unfilled_image_section_indices(prior)
            if len(unfilled) > 1:
                only_section_index = unfilled[0]
        updated: list[Any] = []
        found_image = False
        for i, row in enumerate(sections):
            if not isinstance(row, dict):
                updated.append(row)
                continue
            kind = str(row.get("type") or "").strip().lower()
            content = str(row.get("content") or row.get("url") or "").strip()
            is_placeholder = (
                kind == "image"
                and content
                and not str(content).lower().startswith("http")
            ) or (
                "placeholder" in content.lower() and "image" in content.lower()
            )
            is_target = kind == "image" or is_placeholder
            if only_section_index is not None and i != only_section_index:
                updated.append(dict(row))
                continue
            if is_target:
                found_image = True
                updated.append(
                    {
                        **row,
                        "type": "image",
                        "url": url,
                        "content": url,
                    }
                )
            else:
                updated.append(dict(row))
        if not found_image:
            idx = section_index
            if idx is None:
                idx = find_image_section_index(sections)
            if idx is None:
                idx = default_image_insert_index(updated)
            insert_at = max(0, min(len(updated), int(idx)))
            updated.insert(
                insert_at,
                {"type": "image", "url": url, "content": url, "purpose": "hero"},
            )
        patch["sections"] = _scrub_url_only_text_sections(updated, url)
        patch.pop("blocks", None)
        primary = primary_header_url_from_sections(updated)
        if primary:
            patch["header_image"] = primary
            patch["image_url"] = primary
    elif section_index is not None:
        patch["sections_patch"] = {
            "index": section_index,
            "type": "image",
            "url": url,
            "content": url,
        }
    else:
        # Flat templates with no sections list — still seed a hero image section.
        patch["sections"] = [
            {"type": "image", "url": url, "content": url, "purpose": "hero"}
        ]
    html = str(prior.get("compiled_html") or prior.get("html") or "").strip()
    if html:
        try:
            from app.mas.phase2_compose.html_images import map_hero_fields

            mapped = map_hero_fields({**prior, **patch}, url)
            if str(mapped.get("compiled_html") or "").strip():
                patch["compiled_html"] = mapped["compiled_html"]
            if mapped.get("image_assets"):
                patch["image_assets"] = mapped["image_assets"]
        except Exception:  # noqa: BLE001
            pass
    return patch


def attach_preserves_content(
    prior: dict[str, Any],
    after: dict[str, Any],
) -> bool:
    """True when attach did not wipe subject/body from the template."""
    prior_text = _text_blob(prior)
    after_text = _text_blob(after)
    if not prior_text:
        return True
    if after_text and len(after_text) >= max(20, int(len(prior_text) * 0.5)):
        return True
    prior_subj = str(prior.get("subject") or "").strip()
    after_subj = str(after.get("subject") or "").strip()
    if prior_subj and not after_subj:
        return False
    prior_paras = prior.get("paragraphs") or []
    after_paras = after.get("paragraphs") or []
    if isinstance(prior_paras, list) and prior_paras and not after_paras:
        prior_sections = prior.get("sections") or []
        after_sections = after.get("sections") or []
        if isinstance(prior_sections, list) and prior_sections and not after_sections:
            return False
    return True


HERO_CLEAR_KEYS = (
    "header_image",
    "headerImage",
    "hero_image",
    "heroImage",
    "image_url",
    "image",
    "header_media_url",
    "media_url",
)


def clear_hero_image_fields(existing_fields: dict[str, Any]) -> dict[str, Any]:
    """Remove hero/header image URLs and image sections from template fields."""
    patch: dict[str, Any] = dict(existing_fields or {})
    # Empty string (not omit) so PATCH merge can delete prior URLs.
    for key in HERO_CLEAR_KEYS:
        patch[key] = ""
    patch["header_media_handle"] = ""
    fmt = str(patch.get("header_format") or "").strip().upper()
    if fmt == "IMAGE":
        patch["header_format"] = "TEXT"
    sections = patch.get("sections")
    if isinstance(sections, list):
        kept: list[Any] = []
        for row in sections:
            if not isinstance(row, dict):
                kept.append(row)
                continue
            kind = str(row.get("type") or "").strip().lower()
            if kind == "image":
                continue
            kept.append(dict(row))
        patch["sections"] = kept
    return patch


__all__ = ["attach_preserves_content", "build_attach_fields", "clear_hero_image_fields"]
