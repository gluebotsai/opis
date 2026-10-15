"""Detect and place hero images in section-based email templates."""

from __future__ import annotations

from typing import Any


def _norm_type(value: Any) -> str:
    return str(value or "").strip().lower()


def is_http_image_url(value: Any) -> bool:
    """True for real media https URLs — never landing/campaign_url/merge tags."""
    v = str(value or "").strip()
    # Relative Campaign media paths are valid once absolutized by callers.
    if v.startswith("/api/media/") or v.startswith("/media/"):
        from app.agents.image.media_upload import stamp_template_media_url

        v = stamp_template_media_url(v)
    if not v.lower().startswith(("http://", "https://")):
        return False
    if "{{" in v or "}}" in v:
        return False
    if any(ch.isspace() for ch in v):
        return False
    lower = v.lower()
    if "campaign_url" in lower:
        return False
    try:
        from urllib.parse import parse_qs, urlparse

        parsed = urlparse(v)
        host = (parsed.hostname or "").lower()
        # urllib.ParseResult uses .path (JS URL uses .pathname — do not confuse).
        path = parsed.path or "/"
        qs = parse_qs(parsed.query or "")
        # Tracking query params mean a marketing/page URL, not a hero <img>.
        if "wt" in qs or "utm_source" in qs or "utm_campaign" in qs:
            return False
        landing_hosts = {
            "worktual.co.uk",
            "www.worktual.co.uk",
            "rebuild-campaign.worktual.com",
        }
        # Tracking landings must never be hero <img src>.
        if host in landing_hosts:
            if path in {"/", ""}:
                return False
            if "wt" in qs or "utm_source" in qs or "utm_campaign" in qs:
                return False
        # Explicit media / image asset paths are always ok.
        if "/media/" in path or "/api/media/" in path:
            return True
        if any(
            path.lower().endswith(ext)
            for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg")
        ):
            return True
        # Unknown hosts without image path/ext — allow (CDN signed URLs often omit ext).
        if host not in landing_hosts:
            return True
        return False
    except Exception:  # noqa: BLE001
        return False


def section_image_url(row: dict[str, Any]) -> str:
    if _norm_type(row.get("type")) != "image":
        return ""
    for key in ("url", "content"):
        raw = str(row.get(key) or "").strip()
        if is_http_image_url(raw):
            return raw
    return ""


def _row_is_image_placeholder(row: dict[str, Any]) -> bool:
    """Image slot or banner placeholder text — not a real uploaded URL."""
    if not isinstance(row, dict):
        return False
    kind = _norm_type(row.get("type"))
    content = str(row.get("content") or row.get("url") or "").strip()
    if not content or is_http_image_url(content):
        return False
    if kind == "image":
        return True
    lower = content.lower()
    return "placeholder" in lower and "image" in lower


def fields_have_hero_image(fields: dict[str, Any] | None) -> bool:
    """True when flat header, a section image, or compose HTML has a real media URL."""
    if not isinstance(fields, dict):
        return False
    for key in ("header_image", "image_url", "image", "header_media_url"):
        if is_http_image_url(fields.get(key)):
            return True
    for row in fields.get("sections") or []:
        if isinstance(row, dict) and section_image_url(row):
            return True
    for row in fields.get("image_assets") or []:
        if isinstance(row, dict) and is_http_image_url(row.get("url")):
            return True
    html = str(fields.get("compiled_html") or fields.get("html") or "")
    if "/api/media/" in html.lower():
        return True
    return False


def html_has_image_placeholder(html: str) -> bool:
    text = str(html or "")
    if not text.strip():
        return False
    if "[image:" in text.lower():
        return True
    if "placeholder" in text.lower() and "image" in text.lower():
        return True
    return False


def fields_need_hero_image(fields: dict[str, Any] | None) -> bool:
    """True when template expects images but has no real media URL yet."""
    if fields_have_hero_image(fields):
        return False
    if not isinstance(fields, dict):
        return False
    html = str(fields.get("compiled_html") or fields.get("html") or "")
    if html_has_image_placeholder(html):
        return True
    plan = fields.get("plan") if isinstance(fields.get("plan"), dict) else {}
    slots = plan.get("image_slots") if isinstance(plan.get("image_slots"), list) else []
    if slots and any(isinstance(s, dict) and s.get("needed") for s in slots):
        return True
    for row in fields.get("sections") or []:
        if isinstance(row, dict) and _row_is_image_placeholder(row):
            return True
    return False


def templates_channels_needing_hero(templates: list[dict[str, Any]]) -> list[str]:
    """Channels whose persisted template fields still lack a real hero URL."""
    out: list[str] = []
    for row in templates or []:
        if not isinstance(row, dict):
            continue
        ch = str(row.get("channel") or "").strip().lower()
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        if ch and fields_need_hero_image(fields):
            out.append(ch)
    return out


def find_image_section_index(sections: list[Any]) -> int | None:
    for i, row in enumerate(sections):
        if isinstance(row, dict) and _norm_type(row.get("type")) == "image":
            return i
    return None


def default_image_insert_index(sections: list[Any]) -> int:
    """Insert hero after headline when no image section exists yet."""
    for i, row in enumerate(sections):
        if isinstance(row, dict) and _norm_type(row.get("type")) == "headline":
            return i + 1
    return 0


def ensure_image_section_in_plan(
    sections: list[str],
    *,
    wants_images: bool,
    image_slot_count: int = 0,
) -> list[str]:
    """Director normalization: align section ids with planned image slot count."""
    out = [str(s).strip().lower() for s in sections if str(s).strip()]
    out = [s for s in out if s != "image"]
    if not wants_images:
        return out[:12]
    count = max(1, int(image_slot_count or 1))
    count = min(count, 6)
    existing = sum(1 for s in sections if str(s).strip().lower() == "image")
    if existing >= count:
        return [str(s).strip().lower() for s in sections if str(s).strip()][:12]
    insert_at = out.index("headline") + 1 if "headline" in out else 0
    for _ in range(count - existing):
        out.insert(min(insert_at, len(out)), "image")
        insert_at += 1
    return out[:12]


def normalize_image_slot_specs(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    specs: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        specs.append(
            {
                "role": str(row.get("role") or "visual").strip().lower() or "visual",
                "aspect_ratio": str(row.get("aspect_ratio") or "16:9").strip() or "16:9",
                "display": str(row.get("display") or "full_width").strip() or "full_width",
                "subject_hint": str(row.get("subject_hint") or "").strip(),
            }
        )
    return specs[:8]


def list_filled_image_section_indices(fields: dict[str, Any]) -> list[int]:
    if not isinstance(fields, dict):
        return []
    sections = fields.get("sections")
    if not isinstance(sections, list):
        return []
    return [
        i
        for i, row in enumerate(sections)
        if isinstance(row, dict)
        and _norm_type(row.get("type")) == "image"
        and section_image_url(row)
    ]


def primary_header_url_from_sections(sections: list[Any]) -> str:
    for row in sections:
        if isinstance(row, dict) and _norm_type(row.get("type")) == "image":
            url = section_image_url(row)
            if url:
                return url
    return ""


def select_primary_hero_url(fields: dict[str, Any] | None) -> str:
    """Best-effort hero URL from flat fields, sections, assets, or compose HTML."""
    if not isinstance(fields, dict):
        return ""
    for key in ("header_image", "image_url", "image", "header_media_url"):
        if is_http_image_url(fields.get(key)):
            return str(fields.get(key) or "").strip()
    sections = fields.get("sections")
    if isinstance(sections, list):
        url = primary_header_url_from_sections(sections)
        if url:
            return url
    for row in fields.get("image_assets") or []:
        if isinstance(row, dict) and is_http_image_url(row.get("url")):
            return str(row.get("url") or "").strip()
    html = str(fields.get("compiled_html") or fields.get("html") or "")
    if "/api/media/" in html.lower():
        import re

        match = re.search(
            r"""src\s*=\s*['"]([^'"]+/api/media/[^'"]+)['"]""",
            html,
            flags=re.IGNORECASE,
        )
        if match:
            return match.group(1).strip()
    return ""


def resolve_image_attach_section_index(
    fields: dict[str, Any],
    *,
    mode: str = "fill",
    attach_target: str = "",
) -> int | None:
    """
    Pick which sections[] index to attach/replace.
    mode: fill | replace
    attach_target (LLM): hero | product | last_filled_image | next_empty_slot
    """
    if not isinstance(fields, dict):
        return None
    sections = fields.get("sections")
    if not isinstance(sections, list) or not sections:
        return None
    target = str(attach_target or "").strip().lower().replace("-", "_")
    unfilled = list_unfilled_image_section_indices(fields)
    filled = list_filled_image_section_indices(fields)

    if target == "next_empty_slot" and unfilled:
        return unfilled[0]
    if target == "product":
        for i, row in enumerate(sections):
            if not isinstance(row, dict) or _norm_type(row.get("type")) != "image":
                continue
            purpose = str(row.get("purpose") or "").strip().lower()
            if purpose in {"product", "lifestyle"}:
                return i
        if len(filled) > 1:
            return filled[1]
    if target in {"hero", "header", "banner"}:
        for i, row in enumerate(sections):
            if isinstance(row, dict) and _norm_type(row.get("type")) == "image":
                return i
    if target == "last_filled_image" and filled:
        return filled[-1]

    mode_norm = str(mode or "fill").strip().lower()
    if mode_norm == "replace":
        if filled:
            return filled[0]
        for i, row in enumerate(sections):
            if isinstance(row, dict) and _norm_type(row.get("type")) == "image":
                return i
    if unfilled:
        return unfilled[0]
    return find_image_section_index(sections)


def list_unfilled_image_section_indices(fields: dict[str, Any]) -> list[int]:
    """Section indices that are image slots without a real URL yet."""
    if not isinstance(fields, dict):
        return []
    sections = fields.get("sections")
    if not isinstance(sections, list):
        return []
    out: list[int] = []
    for i, row in enumerate(sections):
        if not isinstance(row, dict):
            continue
        if _norm_type(row.get("type")) != "image":
            continue
        if section_image_url(row):
            continue
        out.append(i)
    return out


__all__ = [
    "default_image_insert_index",
    "ensure_image_section_in_plan",
    "fields_have_hero_image",
    "fields_need_hero_image",
    "find_image_section_index",
    "is_http_image_url",
    "list_filled_image_section_indices",
    "list_unfilled_image_section_indices",
    "normalize_image_slot_specs",
    "primary_header_url_from_sections",
    "resolve_image_attach_section_index",
    "section_image_url",
    "select_primary_hero_url",
    "templates_channels_needing_hero",
]
