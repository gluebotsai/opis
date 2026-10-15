"""Compact live-template snapshot for the edit specialist prompt (not full HTML)."""

from __future__ import annotations

from typing import Any

from app.text_cleanup import strip_html_tags


def _http(value: Any) -> str:
    url = str(value or "").strip()
    return url if url.lower().startswith(("http://", "https://")) else ""


def _outline(html: str, *, limit: int = 1600) -> str:
    plain = strip_html_tags(html or "").strip()
    if len(plain) <= limit:
        return plain
    return plain[: limit - 1] + "…"


def image_urls_on_fields(fields: dict[str, Any] | None) -> list[str]:
    data = fields if isinstance(fields, dict) else {}
    out: list[str] = []
    seen: set[str] = set()
    for key in ("header_image", "image_url", "header_media_url"):
        url = _http(data.get(key))
        if url and url.lower() not in seen:
            seen.add(url.lower())
            out.append(url)
    for row in data.get("image_assets") or []:
        if not isinstance(row, dict):
            continue
        url = _http(row.get("url"))
        if url and url.lower() not in seen:
            seen.add(url.lower())
            out.append(url)
    html = str(data.get("compiled_html") or data.get("html") or "")
    needle = 'src="'
    lower = html
    start = 0
    while True:
        i = lower.find(needle, start)
        if i < 0:
            break
        j = html.find('"', i + len(needle))
        if j < 0:
            break
        url = _http(html[i + len(needle) : j])
        if url and url.lower() not in seen:
            seen.add(url.lower())
            out.append(url)
        start = j + 1
        if len(out) >= 12:
            break
    return out


def compact_live_snapshot(
    *,
    channel: str,
    fields: dict[str, Any] | None,
) -> dict[str, Any]:
    data = fields if isinstance(fields, dict) else {}
    ch = str(channel or "").strip().lower()
    images = image_urls_on_fields(data)
    ctas: list[dict[str, str]] = []
    html = str(data.get("compiled_html") or "")
    # Extract existing hrefs for awareness (HTML scan, not chat intent).
    href_key = "href="
    pos = 0
    while html and len(ctas) < 8:
        i = html.lower().find(href_key, pos)
        if i < 0:
            break
        quote = html[i + 5 : i + 6]
        if quote not in {'"', "'"}:
            pos = i + 5
            continue
        j = html.find(quote, i + 6)
        if j < 0:
            break
        href = _http(html[i + 6 : j]) or str(html[i + 6 : j]).strip()
        if href:
            ctas.append({"href": href[:240]})
        pos = j + 1

    from app.agents.image.hero_image import html_has_image_placeholder

    if ch == "email":
        return {
            "channel": "email",
            "subject": str(data.get("subject") or "")[:160],
            "preheader": str(data.get("preheader") or "")[:160],
            "hero_url": _http(data.get("header_image") or data.get("image_url")),
            "hero_placeholder": html_has_image_placeholder(html),
            "images_on_canvas": images[:8],
            "ctas": ctas,
            "outline": _outline(html or str(data.get("body") or "")),
        }
    if ch == "whatsapp":
        return {
            "channel": "whatsapp",
            "body": str(data.get("body") or "")[:500],
            "header_format": str(data.get("header_format") or ""),
            "header_media_url": _http(data.get("header_media_url")),
            "buttons": data.get("buttons") if isinstance(data.get("buttons"), list) else [],
            "footer": str(data.get("footer") or "")[:200],
            "images_on_canvas": images[:8],
        }
    return {
        "channel": ch or "push",
        "title": str(data.get("title") or "")[:160],
        "body": str(data.get("body") or "")[:400],
        "image_url": _http(data.get("image_url") or data.get("header_image")),
        "click_url": _http(data.get("click_url") or data.get("url") or data.get("deep_link")),
        "images_on_canvas": images[:8],
    }


def catalog_for_prompt(library: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in library[:16]:
        if not isinstance(item, dict):
            continue
        url = str(item.get("image_url") or "").strip()
        status = str(item.get("status") or "")
        if status == "pending":
            status = "in_session"
        rows.append(
            {
                "id": str(item.get("id") or "")[:80],
                "filename": str(item.get("filename") or "")[:80],
                "status": status,
                "source": str(item.get("source") or ""),
                "already_on_template": bool(item.get("already_on_template")),
                "url_preview": url[:96],
            }
        )
    return rows
