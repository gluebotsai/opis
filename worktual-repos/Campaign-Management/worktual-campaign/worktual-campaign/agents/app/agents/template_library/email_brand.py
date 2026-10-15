"""Email brand theme + footer/social link helpers (normalize / merge only).

LLM chooses theme overrides and which links to include; tools validate and persist.
Never invent social URLs — only keep http(s) links the model or org pack provided.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

_HEX = re.compile(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
_THEME_KEYS = (
    "background",
    "surface",
    "text",
    "muted",
    "accent",
    "button_text",
    "button_radius",
    "font_heading",
    "font_body",
    "alignment",
)
_SOCIAL_NETWORKS = frozenset(
    {
        "website",
        "web",
        "linkedin",
        "twitter",
        "x",
        "facebook",
        "instagram",
        "youtube",
        "tiktok",
        "whatsapp",
        "github",
        "other",
    }
)


def _clean(value: Any) -> str:
    return str(value or "").strip()


def is_hex_color(value: Any) -> bool:
    return bool(_HEX.match(_clean(value)))


def is_http_url(value: Any) -> bool:
    raw = _clean(value)
    if not raw.lower().startswith(("http://", "https://")):
        return False
    if "{{" in raw or "}}" in raw:
        return False
    try:
        parsed = urlparse(raw)
        return bool(parsed.scheme and parsed.netloc)
    except Exception:  # noqa: BLE001
        return False


def normalize_theme_dict(raw: Any, *, base: dict[str, Any] | None = None) -> dict[str, str]:
    out: dict[str, str] = {}
    if isinstance(base, dict):
        for key in _THEME_KEYS:
            val = _clean(base.get(key))
            if val:
                out[key] = val
    data = raw if isinstance(raw, dict) else {}
    for key, val in data.items():
        k = _clean(key).lower().replace("-", "_")
        if k not in _THEME_KEYS:
            continue
        v = _clean(val)
        if not v:
            continue
        if k in {
            "background",
            "surface",
            "text",
            "muted",
            "accent",
            "button_text",
        } and not is_hex_color(v):
            continue
        if k == "alignment" and v.lower() not in {"left", "center"}:
            continue
        if k == "button_radius":
            try:
                n = int(float(v))
                v = str(max(0, min(24, n)))
            except (TypeError, ValueError):
                continue
        out[k] = v
    return out


def normalize_footer_links(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for row in raw[:12]:
        if not isinstance(row, dict):
            continue
        label = _clean(row.get("label") or row.get("title") or row.get("name"))
        url = _clean(row.get("url") or row.get("href"))
        if not label or not is_http_url(url):
            continue
        out.append({"label": label[:80], "url": url[:2048]})
    return out


def normalize_social_links(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in raw[:12]:
        if not isinstance(row, dict):
            continue
        network = _clean(row.get("network") or row.get("type") or row.get("name")).lower()
        if network == "x":
            network = "twitter"
        if network == "web":
            network = "website"
        if network and network not in _SOCIAL_NETWORKS:
            network = "other"
        url = _clean(row.get("url") or row.get("href"))
        label = _clean(row.get("label") or row.get("title")) or (
            network.replace("_", " ").title() if network else ""
        )
        if not is_http_url(url):
            continue
        key = url.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "network": network or "other",
                "label": label[:80],
                "url": url[:2048],
            }
        )
    return out


def normalize_brand_dict(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    colors = data.get("colors") if isinstance(data.get("colors"), dict) else data
    brand_colors: dict[str, str] = {}
    for key in ("primary", "accent", "background", "surface", "text", "muted"):
        val = _clean(colors.get(key) if isinstance(colors, dict) else "")
        if is_hex_color(val):
            brand_colors[key] = val
    for src, dst in (
        ("primary_color", "primary"),
        ("accent_color", "accent"),
        ("background_color", "background"),
        ("brand_primary", "primary"),
        ("brand_accent", "accent"),
    ):
        val = _clean(data.get(src))
        if is_hex_color(val) and dst not in brand_colors:
            brand_colors[dst] = val
    logo = _clean(data.get("logo_url") or data.get("logo"))
    website = _clean(data.get("website") or data.get("website_url") or data.get("url"))
    out: dict[str, Any] = {}
    if brand_colors:
        out["colors"] = brand_colors
    if logo and is_http_url(logo):
        out["logo_url"] = logo[:2048]
    if website and is_http_url(website):
        out["website"] = website[:2048]
    name = _clean(data.get("name") or data.get("company_name") or data.get("brand_name"))
    if name:
        out["name"] = name[:120]
    socials = normalize_social_links(data.get("social_links") or data.get("socials"))
    if socials:
        out["social_links"] = socials
    footers = normalize_footer_links(data.get("footer_links"))
    if footers:
        out["footer_links"] = footers
    return out


def extract_brand_from_context(
    *,
    company_pack: dict[str, Any] | None = None,
    campaign: dict[str, Any] | None = None,
    design_plan: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Merge structured brand facts from pack / campaign / design plan (no invention)."""
    merged: dict[str, Any] = {}
    pack = company_pack if isinstance(company_pack, dict) else {}
    payload = pack.get("payload") if isinstance(pack.get("payload"), dict) else {}
    for source in (
        pack.get("brand"),
        payload.get("brand") if isinstance(payload, dict) else None,
        (campaign or {}).get("brand") if isinstance(campaign, dict) else None,
        (design_plan or {}).get("brand") if isinstance(design_plan, dict) else None,
    ):
        part = normalize_brand_dict(source)
        if not part:
            continue
        colors = dict(merged.get("colors") or {})
        colors.update(part.get("colors") or {})
        if colors:
            merged["colors"] = colors
        for key in ("logo_url", "website", "name"):
            if part.get(key):
                merged[key] = part[key]
        if part.get("social_links"):
            merged["social_links"] = normalize_social_links(
                list(merged.get("social_links") or []) + list(part["social_links"])
            )
        if part.get("footer_links"):
            merged["footer_links"] = normalize_footer_links(
                list(merged.get("footer_links") or []) + list(part["footer_links"])
            )
    camp = campaign if isinstance(campaign, dict) else {}
    flat_brand = normalize_brand_dict(
        {
            "website": camp.get("website")
            or camp.get("website_url")
            or camp.get("company_url"),
            "logo_url": camp.get("logo_url") or camp.get("logo"),
            "primary_color": camp.get("brand_primary") or camp.get("primary_color"),
            "accent_color": camp.get("brand_accent") or camp.get("accent_color"),
            "background_color": camp.get("brand_background")
            or camp.get("background_color"),
            "name": camp.get("company_name") or camp.get("brand_name"),
            "social_links": camp.get("social_links"),
            "footer_links": camp.get("footer_links"),
        }
    )
    if flat_brand:
        colors = dict(merged.get("colors") or {})
        colors.update(flat_brand.get("colors") or {})
        if colors:
            merged["colors"] = colors
        for key in ("logo_url", "website", "name"):
            if flat_brand.get(key) and not merged.get(key):
                merged[key] = flat_brand[key]
        if flat_brand.get("social_links"):
            merged["social_links"] = normalize_social_links(
                list(merged.get("social_links") or [])
                + list(flat_brand["social_links"])
            )
        if flat_brand.get("footer_links"):
            merged["footer_links"] = normalize_footer_links(
                list(merged.get("footer_links") or [])
                + list(flat_brand["footer_links"])
            )
    return merged


def merge_brand_into_theme(
    theme: dict[str, Any] | None,
    brand: dict[str, Any] | None,
    *,
    overrides: dict[str, Any] | None = None,
) -> dict[str, str]:
    """Catalog theme + org brand colors + LLM theme overrides."""
    base = normalize_theme_dict(theme)
    colors = (brand or {}).get("colors") if isinstance(brand, dict) else {}
    if isinstance(colors, dict):
        mapping = {
            "primary": "accent",
            "accent": "accent",
            "background": "background",
            "surface": "surface",
            "text": "text",
            "muted": "muted",
        }
        patch: dict[str, str] = {}
        for src, dst in mapping.items():
            val = _clean(colors.get(src))
            if is_hex_color(val):
                patch[dst] = val
        base = normalize_theme_dict(patch, base=base)
    if overrides:
        base = normalize_theme_dict(overrides, base=base)
    return base


def apply_brand_to_email_fields(
    fields: dict[str, Any],
    brand: dict[str, Any] | None,
    *,
    theme_overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist brand/theme/links onto email fields; inject social section when links exist."""
    out = dict(fields or {})
    brand_n = normalize_brand_dict(brand) if brand else {}
    if brand_n:
        out["brand"] = brand_n
    theme = merge_brand_into_theme(
        out.get("theme") if isinstance(out.get("theme"), dict) else {},
        brand_n,
        overrides=theme_overrides,
    )
    if theme:
        out["theme"] = theme

    # Field links win when non-empty; brand fills when fields are empty.
    # Clearing requires empty field links AND empty brand links (edit tool updates both).
    field_socials = (
        normalize_social_links(out.get("social_links"))
        if isinstance(out.get("social_links"), list)
        else []
    )
    brand_socials = normalize_social_links((brand_n or {}).get("social_links"))
    socials = field_socials or brand_socials
    out["social_links"] = socials

    field_footers = (
        normalize_footer_links(out.get("footer_links"))
        if isinstance(out.get("footer_links"), list)
        else []
    )
    brand_footers = normalize_footer_links((brand_n or {}).get("footer_links"))
    footers = field_footers or brand_footers
    out["footer_links"] = footers

    sections = (
        list(out.get("sections") or [])
        if isinstance(out.get("sections"), list)
        else []
    )
    sections = [
        row
        for row in sections
        if not (
            isinstance(row, dict) and _clean(row.get("type")).lower() == "social_links"
        )
    ]
    if socials:
        row = {
            "type": "social_links",
            "purpose": "brand_links",
            "items": [f"{s['label']}|{s['url']}" for s in socials[:8]],
            "links": socials[:8],
        }
        insert_at = len(sections)
        for i, row_s in enumerate(sections):
            if (
                isinstance(row_s, dict)
                and _clean(row_s.get("type")).lower() == "compliance_footer"
            ):
                insert_at = i
                break
        sections.insert(insert_at, row)
    if isinstance(out.get("sections"), list) or socials:
        out["sections"] = sections
    return out


__all__ = [
    "apply_brand_to_email_fields",
    "extract_brand_from_context",
    "is_hex_color",
    "is_http_url",
    "merge_brand_into_theme",
    "normalize_brand_dict",
    "normalize_footer_links",
    "normalize_social_links",
    "normalize_theme_dict",
]
