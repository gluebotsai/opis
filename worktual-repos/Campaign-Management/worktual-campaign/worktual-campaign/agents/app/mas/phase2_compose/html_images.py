"""Map compose image_assets onto compiled_html (HTML structure only, not chat intent)."""

from __future__ import annotations

import re
from typing import Any

_IMG_TAG_RE = re.compile(r"<img\b[^>]*>", re.I | re.DOTALL)
_SRC_ATTR_RE = re.compile(r"""\bsrc\s*=\s*(['"])(.*?)\1""", re.I | re.DOTALL)
_BODY_OPEN_RE = re.compile(r"<body\b[^>]*>", re.I)
# Compose often writes a caption instead of <img> — attach must replace it.
_BRACKET_IMAGE_PLACEHOLDER_RE = re.compile(r"\[Image:[^\]]*\]", re.I)
# LLM-invented stock/placeholder hosts — never keep these in generated or edited HTML.
_STOCK_IMAGE_HOST_RE = re.compile(
    r"(gstatic\.com|googleusercontent\.com|ggpht\.com|"
    r"unsplash\.com|picsum\.photos|loremflickr\.com|"
    r"placeholder\.com|placehold\.co|placehold\.it|"
    r"dummyimage\.com|via\.placeholder\.com|placekitten\.com)",
    re.I,
)


def _http_url(value: Any) -> str:
    url = str(value or "").strip()
    if url.lower().startswith(("http://", "https://")):
        return url
    return ""


def is_stock_or_static_image_url(url: str) -> bool:
    raw = str(url or "").strip()
    if not raw:
        return False
    return bool(_STOCK_IMAGE_HOST_RE.search(raw))


def is_campaign_media_url(url: str) -> bool:
    raw = str(url or "").strip().lower()
    return "/api/media/" in raw


def collect_allowed_image_urls(
    fields: dict[str, Any] | None = None,
    *,
    assets: list[Any] | None = None,
    brand: dict[str, Any] | None = None,
) -> set[str]:
    """Gemini/upload + brand URLs that may stay on the email."""
    data = fields if isinstance(fields, dict) else {}
    allowed = skip_urls_from_brand(
        brand
        if isinstance(brand, dict)
        else (data.get("brand_guidelines") if isinstance(data.get("brand_guidelines"), dict) else {})
    )
    rows = assets if assets is not None else data.get("image_assets")
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        url = _http_url(row.get("url"))
        if url and not is_stock_or_static_image_url(url):
            allowed.add(url.lower())
    for key in ("header_image", "image_url"):
        url = _http_url(data.get(key))
        if url and not is_stock_or_static_image_url(url):
            allowed.add(url.lower())
    return allowed


def strip_untrusted_content_images(
    html: str,
    *,
    allowed_urls: set[str] | None = None,
) -> str:
    """Drop stock/static and other invented <img> tags; keep brand, Gemini, uploads."""
    text = str(html or "")
    if not text.strip():
        return text
    allowed = {str(u).strip().lower() for u in (allowed_urls or set()) if str(u).strip()}

    def _keep(tag: str) -> str:
        src = _img_src(tag)
        if not src:
            return ""
        lower = src.lower()
        if is_stock_or_static_image_url(src):
            return ""
        if lower in allowed or is_campaign_media_url(src):
            return tag
        return ""

    return _IMG_TAG_RE.sub(lambda m: _keep(m.group(0)), text)


def drop_stock_image_assets(assets: list[Any] | None) -> list[dict[str, Any]]:
    """Keep only real http(s) heroes — never gstatic/stock placeholders."""
    out: list[dict[str, Any]] = []
    for row in assets or []:
        if not isinstance(row, dict):
            continue
        url = _http_url(row.get("url"))
        if not url or is_stock_or_static_image_url(url):
            continue
        item = dict(row)
        item["url"] = url
        out.append(item)
    return out


def sanitize_compose_images(
    html: str,
    assets: list[Any] | None,
    *,
    brand: dict[str, Any] | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Apply Gemini/upload assets, then drop leftover stock <img> tags."""
    cleaned = drop_stock_image_assets(assets)
    html_out = apply_image_assets_to_html(
        html,
        cleaned,
        skip_urls=skip_urls_from_brand(brand),
    )
    html_out = strip_untrusted_content_images(
        html_out,
        allowed_urls=collect_allowed_image_urls(assets=cleaned, brand=brand),
    )
    return html_out, cleaned


def skip_urls_from_brand(brand: dict[str, Any] | None) -> set[str]:
    """Logo/banner from brand guidelines must not be overwritten by the hero."""
    skip: set[str] = set()
    data = brand if isinstance(brand, dict) else {}
    for key in ("logo_url", "logo", "top_banner_url", "banner_url"):
        url = _http_url(data.get(key))
        if url and not is_stock_or_static_image_url(url):
            skip.add(url.lower())
    return skip


def hero_url_from_assets(assets: list[Any] | None) -> str:
    hero = ""
    for row in assets or []:
        if not isinstance(row, dict):
            continue
        url = _http_url(row.get("url"))
        if not url or is_stock_or_static_image_url(url):
            continue
        hero = url
        if str(row.get("role") or "").strip().lower() in {"hero", "banner", "header"}:
            return url
    return hero


def _img_src(tag: str) -> str:
    match = _SRC_ATTR_RE.search(tag or "")
    return str(match.group(2) or "").strip() if match else ""


def _set_img_src(tag: str, url: str) -> str:
    text = str(tag or "")
    if not url:
        return text
    if _SRC_ATTR_RE.search(text):
        return _SRC_ATTR_RE.sub(lambda m: f"src={m.group(1)}{url}{m.group(1)}", text, count=1)
    if text.endswith("/>"):
        return f'{text[:-2].rstrip()} src="{url}" />'
    if text.endswith(">"):
        return f'{text[:-1].rstrip()} src="{url}">'
    return text


def _content_img_matches(html: str, skip_urls: set[str]) -> list[re.Match[str]]:
    out: list[re.Match[str]] = []
    for match in _IMG_TAG_RE.finditer(html or ""):
        src = _img_src(match.group(0)).lower()
        if src and src in skip_urls:
            continue
        out.append(match)
    return out


def apply_image_assets_to_html(
    html: str,
    assets: list[Any] | None,
    *,
    skip_urls: set[str] | None = None,
) -> str:
    """Put asset URLs on content <img> tags (hero first). Insert a hero if none exist."""
    text = str(html or "")
    urls: list[str] = []
    seen: set[str] = set()
    first_asset: dict[str, Any] = {}
    for row in assets or []:
        if not isinstance(row, dict):
            continue
        url = _http_url(row.get("url"))
        if not url or is_stock_or_static_image_url(url) or url.lower() in seen:
            continue
        seen.add(url.lower())
        urls.append(url)
        if not first_asset:
            first_asset = row
    if not urls or not text.strip():
        return text

    width = int(first_asset.get("width_px") or 600)
    hero_img = (
        f'<img src="{urls[0]}" alt="" width="{width}" '
        'style="max-width:100%;height:auto;display:block;margin:0 auto"/>'
    )
    if _BRACKET_IMAGE_PLACEHOLDER_RE.search(text):
        text = _BRACKET_IMAGE_PLACEHOLDER_RE.sub(hero_img, text, count=1)

    skip = {str(u).strip().lower() for u in (skip_urls or set()) if str(u).strip()}
    matches = _content_img_matches(text, skip)
    if matches:
        pieces: list[str] = []
        cursor = 0
        for idx, match in enumerate(matches):
            pieces.append(text[cursor : match.start()])
            url = urls[idx] if idx < len(urls) else ""
            if url:
                pieces.append(_set_img_src(match.group(0), url))
            else:
                pieces.append(match.group(0))
            cursor = match.end()
        pieces.append(text[cursor:])
        return "".join(pieces)

    img = hero_img
    body = _BODY_OPEN_RE.search(text)
    if body:
        at = body.end()
        return text[:at] + img + text[at:]
    close = text.lower().rfind("</body>")
    if close >= 0:
        return text[:close] + img + text[close:]
    return img + text


def set_hero_src(
    html: str,
    url: str,
    *,
    skip_urls: set[str] | None = None,
    width_px: int = 600,
) -> str:
    """Replace or insert the first non-logo image with this URL."""
    target = _http_url(url)
    if not target:
        return str(html or "")
    return apply_image_assets_to_html(
        html,
        [{"role": "hero", "url": target, "width_px": width_px, "height_px": 338}],
        skip_urls=skip_urls,
    )


def map_hero_fields(
    fields: dict[str, Any],
    url: str,
    *,
    role: str = "hero",
    width_px: int = 600,
    height_px: int = 338,
) -> dict[str, Any]:
    """Point compiled_html, header_image, image_url, and image_assets at the same hero."""
    out = dict(fields or {})
    target = _http_url(url)
    if not target:
        return out
    skip = skip_urls_from_brand(
        out.get("brand_guidelines") if isinstance(out.get("brand_guidelines"), dict) else {}
    )
    html = str(out.get("compiled_html") or out.get("html") or "")
    if html.strip():
        out["compiled_html"] = set_hero_src(
            html, target, skip_urls=skip, width_px=width_px
        )
    out["header_image"] = target
    out["image_url"] = target
    assets: list[dict[str, Any]] = []
    replaced = False
    for row in out.get("image_assets") or []:
        if not isinstance(row, dict):
            continue
        item = dict(row)
        if not replaced and str(item.get("role") or "hero").lower() in {
            "hero",
            "banner",
            "header",
            "",
        }:
            item["url"] = target
            item["role"] = str(item.get("role") or role or "hero")
            replaced = True
        assets.append(item)
    if not replaced:
        assets.insert(
            0,
            {
                "role": role or "hero",
                "url": target,
                "width_px": int(width_px or 600),
                "height_px": int(height_px or 338),
            },
        )
    out["image_assets"] = assets
    out["pipeline"] = str(out.get("pipeline") or "compose")
    return out


def map_image_assets_onto_fields(
    fields: dict[str, Any],
    assets: list[Any] | None,
) -> dict[str, Any]:
    """Place every generated/uploaded asset onto compiled_html + image_assets."""
    out = dict(fields or {})
    brand = (
        out.get("brand_guidelines")
        if isinstance(out.get("brand_guidelines"), dict)
        else {}
    )
    html, cleaned = sanitize_compose_images(
        str(out.get("compiled_html") or out.get("html") or ""),
        assets,
        brand=brand,
    )
    if html.strip():
        out["compiled_html"] = html
    out["image_assets"] = cleaned
    hero = hero_url_from_assets(cleaned)
    if hero:
        out["header_image"] = hero
        out["image_url"] = hero
    out["pipeline"] = str(out.get("pipeline") or "compose")
    return out


def insert_image_before_body_close(
    html: str,
    url: str,
    *,
    width_px: int = 600,
) -> str:
    """Insert an <img> before </body> (footer/bottom placement). HTML mutation only."""
    target = _http_url(url)
    text = str(html or "")
    if not target:
        return text
    img = (
        f'<img src="{target}" alt="" width="{int(width_px or 600)}" '
        'style="max-width:100%;height:auto;display:block;margin:16px auto"/>'
    )
    lower = text.lower()
    close = lower.rfind("</body>")
    if close >= 0:
        return text[:close] + img + text[close:]
    unsub = lower.rfind("unsubscribe")
    if unsub >= 0:
        # Place just before a late unsubscribe mention without parsing chat.
        return text[:unsub] + img + text[unsub:]
    return text + img


def map_uploaded_image_fields(
    fields: dict[str, Any],
    url: str,
    *,
    placement: str = "hero",
) -> dict[str, Any]:
    """Place an upload on hero or before body close. Does not parse user chat."""
    place = str(placement or "hero").strip().lower()
    if place in {"bottom", "before_footer", "footer", "end"}:
        out = dict(fields or {})
        target = _http_url(url)
        if not target:
            return out
        html = str(out.get("compiled_html") or out.get("html") or "")
        if html.strip():
            out["compiled_html"] = insert_image_before_body_close(html, target)
        assets = [
            dict(r) for r in (out.get("image_assets") or []) if isinstance(r, dict)
        ]
        assets.append(
            {
                "role": "footer",
                "url": target,
                "width_px": 600,
                "height_px": 338,
            }
        )
        out["image_assets"] = assets
        out["pipeline"] = str(out.get("pipeline") or "compose")
        out["compiled_html"] = strip_untrusted_content_images(
            str(out.get("compiled_html") or ""),
            allowed_urls=collect_allowed_image_urls(out),
        )
        return out
    return map_uploaded_hero_fields(fields, url)


def map_uploaded_hero_fields(fields: dict[str, Any], url: str) -> dict[str, Any]:
    """Place a campaign-media upload on the hero slot (same mapping as generate)."""
    mapped = map_hero_fields(fields, url, role="hero", width_px=600, height_px=338)
    mapped["compiled_html"] = strip_untrusted_content_images(
        str(mapped.get("compiled_html") or ""),
        allowed_urls=collect_allowed_image_urls(mapped),
    )
    return mapped
