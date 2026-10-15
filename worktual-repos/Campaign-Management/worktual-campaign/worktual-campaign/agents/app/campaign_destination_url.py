"""Resolve marketing destination URLs from session, KB, or campaign — no static hosts."""

from __future__ import annotations

import re
from typing import Any

_HTTP_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.I)
_IMAGE_PATH_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico")


def is_likely_page_url(url: str) -> bool:
    """True for https marketing/page links — not media or merge tags."""
    raw = str(url or "").strip()
    if not raw or "{{" in raw or "campaign_url" in raw.lower():
        return False
    if not raw.lower().startswith(("http://", "https://")):
        return False
    lower = raw.lower()
    if "/api/media/" in lower:
        return False
    path = lower.split("?", 1)[0]
    if any(path.endswith(ext) for ext in _IMAGE_PATH_EXTS):
        return False
    return True


def extract_page_urls_from_text(*parts: Any) -> list[str]:
    """First-seen order unique page URLs from text blobs."""
    blob = "\n".join(
        p if isinstance(p, str) else str(p) for p in parts if p
    )
    seen: set[str] = set()
    out: list[str] = []
    for match in _HTTP_URL_RE.finditer(blob):
        url = match.group(0).rstrip(").,;]")
        key = url.rstrip("/").lower()
        if not is_likely_page_url(url) or key in seen:
            continue
        seen.add(key)
        out.append(url)
    return out


def form_url_from_session(session: dict[str, Any] | None) -> str:
    blob = session if isinstance(session, dict) else {}
    fl = blob.get("form_launch") if isinstance(blob.get("form_launch"), dict) else {}
    url = str(blob.get("form_url") or fl.get("public_url") or "").strip()
    return url if is_likely_page_url(url) else ""


def destination_from_campaign(campaign: dict[str, Any] | None) -> str:
    data = campaign if isinstance(campaign, dict) else {}
    for key in ("destination_url", "form_url", "cta_url", "landing_url", "product_url"):
        url = str(data.get(key) or "").strip()
        if is_likely_page_url(url):
            return url
    return ""


def destination_from_fields(fields: dict[str, Any] | None) -> str:
    data = fields if isinstance(fields, dict) else {}
    for key in ("destination_url", "cta_url", "landing_url", "product_url"):
        url = str(data.get(key) or "").strip()
        if is_likely_page_url(url):
            return url
    sections = data.get("sections")
    if isinstance(sections, list):
        for row in sections:
            if not isinstance(row, dict):
                continue
            kind = str(row.get("type") or "").strip().lower()
            if kind in {"cta", "secondary_link"}:
                url = str(row.get("url") or row.get("href") or "").strip()
                if is_likely_page_url(url):
                    return url
    html = str(data.get("compiled_html") or data.get("html") or "")
    if html:
        from app.mas.phase2_compose.plugin import first_marketing_href_from_html

        found = first_marketing_href_from_html(html)
        if found:
            return found
    return ""


def resolve_campaign_destination_url(
    *,
    session: dict[str, Any] | None = None,
    campaign: dict[str, Any] | None = None,
    fields: dict[str, Any] | None = None,
    knowledge: str = "",
    extra_text: str = "",
) -> str:
    """Priority: form launch → campaign → template fields → KB/extra text."""
    for candidate in (
        form_url_from_session(session),
        destination_from_campaign(campaign),
        destination_from_fields(fields),
    ):
        if candidate:
            return candidate
    urls = extract_page_urls_from_text(knowledge, extra_text)
    return urls[0] if urls else ""


def knowledge_has_landing_url(*parts: Any) -> bool:
    return bool(extract_page_urls_from_text(*parts))


__all__ = [
    "destination_from_fields",
    "extract_page_urls_from_text",
    "form_url_from_session",
    "is_likely_page_url",
    "knowledge_has_landing_url",
    "resolve_campaign_destination_url",
]
