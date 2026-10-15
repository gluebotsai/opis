"""Extract page text + positioned pageHtml from corpus PDFs — no LLM.

Design tokens are NOT decided here. A lightweight geometry hint may be attached
for the design agent; MiniMax design-geometry owns the real layoutStyle.
"""

from __future__ import annotations

import base64
import html
import logging
import re
from collections import Counter
from typing import Any

logger = logging.getLogger(__name__)

# Cover + one commercials page must survive truncation for scoped design calls.
_MAX_PAGE_HTML = 24_000
_MAX_PAGE_TEXT = 8_000
_MAX_FULL_TEXT = 40_000
_MAX_PAGES = 40
_HEADING_RE = re.compile(
    r"^(?:#{1,3}\s+|[0-9]{1,2}[.)]\s+|[A-Z][A-Z0-9 /&,'-]{8,80})$"
)


def _word_count(text: str) -> int:
    return len(re.findall(r"\b[\w']+\b", text or ""))


def heading_sections_from_text(text: str) -> list[dict[str, Any]]:
    """Deterministic heading split for measured lengthSpec (no LLM)."""
    lines = [ln.strip() for ln in str(text or "").splitlines()]
    buckets: list[dict[str, Any]] = []
    current = {"heading": "document", "body": []}
    for line in lines:
        if line and _HEADING_RE.match(line) and not line.endswith("."):
            if current["body"] or current["heading"] != "document":
                body = "\n".join(current["body"])
                buckets.append(
                    {
                        "heading": current["heading"],
                        "wordCount": _word_count(body),
                    }
                )
            current = {"heading": line.lstrip("# ").strip(), "body": []}
            continue
        if line:
            current["body"].append(line)
    body = "\n".join(current["body"])
    buckets.append(
        {
            "heading": current["heading"],
            "wordCount": _word_count(body),
        }
    )
    return [row for row in buckets if row["wordCount"] > 0][:40]


def length_spec_from_pages(
    pages: list[dict[str, Any]], full_text: str
) -> dict[str, Any]:
    headings = heading_sections_from_text(full_text)
    slug_words: dict[str, int] = {}
    for row in headings:
        slug = re.sub(r"[^a-z0-9]+", "_", str(row["heading"]).lower()).strip("_")
        if not slug:
            continue
        slug_words[slug] = int(row["wordCount"])
    page_words = [
        {"n": page.get("n"), "wordCount": _word_count(str(page.get("text") or ""))}
        for page in pages
        if isinstance(page, dict)
    ]
    doc_words = _word_count(full_text)
    page_sum = sum(int(p["wordCount"]) for p in page_words)
    confidence = "high"
    if page_sum and doc_words and abs(page_sum - doc_words) / max(doc_words, 1) > 0.15:
        confidence = "low"
    heading_sum = sum(int(r["wordCount"]) for r in headings)
    if heading_sum and doc_words and abs(heading_sum - doc_words) / max(doc_words, 1) > 0.15:
        confidence = "low"
    return {
        "schemaVersion": 1,
        "documentWordCount": doc_words,
        "documentPageCount": len(pages),
        "pageWords": page_words,
        "headingSections": headings,
        "sectionWords": slug_words,
        "lengthConfidence": confidence,
    }

_NEUTRAL_COLORS = {"#000000", "#000", "#ffffff", "#fff", "#595959", "#1a1a1a"}


def _top_counts(values: list[str], n: int = 6) -> list[dict[str, Any]]:
    if not values:
        return []
    return [
        {"value": key, "count": count}
        for key, count in Counter(values).most_common(n)
    ]


def _first_page_html(assets: list[dict[str, Any]]) -> str:
    numbered: list[tuple[int, str]] = []
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        asset_id = str(asset.get("id") or "")
        page_html = str(asset.get("pageHtml") or "")
        if not asset_id.startswith("page-") or not page_html:
            continue
        try:
            page_number = int(asset_id.split("-", 1)[1])
        except (IndexError, ValueError):
            page_number = len(numbered) + 1
        numbered.append((page_number, page_html))
    if not numbered:
        return ""
    numbered.sort(key=lambda row: row[0])
    return numbered[0][1]


def _cover_text_order(page_html: str, limit: int = 12) -> list[str]:
    fragments = re.findall(
        r'<span class="pdf-text"[^>]*>([\s\S]*?)</span>', page_html
    )
    ordered: list[str] = []
    for fragment in fragments:
        text = html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()
        if not text:
            continue
        ordered.append(text[:160])
        if len(ordered) >= limit:
            break
    return ordered


def _geometry_hint(assets: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Deterministic PDF facts for the design agent — not a style summary."""
    page_html = "\n".join(
        str(a.get("pageHtml") or "")
        for a in assets
        if isinstance(a, dict) and str(a.get("pageHtml") or "").strip()
    )
    if not page_html:
        return None

    colors = re.findall(r"color:(#[0-9a-fA-F]{6})", page_html)
    bold_colors = re.findall(
        r"color:(#[0-9a-fA-F]{6})[^>]*font-weight:bold", page_html
    )
    lowered = [c.lower() for c in colors]
    bold_lowered = [c.lower() for c in bold_colors]
    non_neutral = [
        c for c in bold_lowered + lowered if c not in _NEUTRAL_COLORS
    ]
    heading_color = max(set(non_neutral), key=non_neutral.count) if non_neutral else None
    accents = [c for c in non_neutral if c != heading_color] if heading_color else []
    accent_color = max(set(accents), key=accents.count) if accents else heading_color

    body_colors = [
        c for c in lowered if c in _NEUTRAL_COLORS or c == (heading_color or "")
    ]
    body_color = (
        max(set(body_colors), key=body_colors.count) if body_colors else "#000000"
    )

    left_values = [
        float(v)
        for v in re.findall(r'class="pdf-text"[^>]*left:([0-9.]+)%', page_html)
    ]
    left = min((v for v in left_values if 2 <= v <= 30), default=None)
    font_sizes = [
        float(v)
        for v in re.findall(r"font-size:([0-9.]+)cqw", page_html)
    ]
    median_size = None
    if font_sizes:
        ordered = sorted(font_sizes)
        median_size = ordered[len(ordered) // 2]

    families = [
        f.strip().strip("'\"")
        for f in re.findall(r"font-family:([^;]+)", page_html, flags=re.I)
        if f.strip()
    ]
    weights = [
        w.lower()
        for w in re.findall(r"font-weight:([a-zA-Z0-9]+)", page_html)
        if w.strip()
    ]
    size_bins = [str(round(v, 2)) for v in font_sizes]

    fills = [
        c.lower()
        for c in re.findall(
            r"background-color:(#[0-9a-fA-F]{6})", page_html, flags=re.I
        )
    ]
    header_fills = [c for c in fills if c not in {"#ffffff", "#fff"}]
    table_header_fill = (
        max(set(header_fills), key=header_fills.count) if header_fills else None
    )
    borders = [
        c.lower()
        for c in re.findall(r"border:[^;]*solid\s+(#[0-9a-fA-F]{6})", page_html)
    ]
    border_color = max(set(borders), key=borders.count) if borders else None

    rect_widths = [
        float(w)
        for w in re.findall(
            r'class="pdf-shape pdf-rect"[^>]*width:([0-9.]+)%', page_html
        )
    ]
    col_widths = sorted({round(w) for w in rect_widths if 12 <= w <= 48})[:6]
    col_count = len(col_widths) if len(col_widths) >= 2 else (
        3 if "pdf-shape" in page_html and page_html.count("pdf-shape") > 12 else 0
    )

    table_like = "pdf-shape" in page_html and page_html.count("pdf-shape") > 12
    cover_html = _first_page_html(assets)
    cover_order = _cover_text_order(cover_html or page_html)

    return {
        "observedHeadingColor": heading_color,
        "observedAccentColor": accent_color,
        "observedLeftPct": left,
        "observedMedianFontCqw": median_size,
        "tableGeometryDetected": table_like,
        "hasPositionedPages": True,
        "source": "pdf_geometry_hint",
        "fonts": {
            "families": _top_counts(families),
            "sizesCqw": _top_counts(size_bins),
            "weights": _top_counts(weights),
            "medianSizeCqw": median_size,
        },
        "colors": {
            "heading": heading_color,
            "accent": accent_color,
            "body": body_color,
            "tableHeader": table_header_fill or heading_color,
        },
        "cover": {"textOrder": cover_order},
        "tables": {
            "detected": table_like,
            "shapeCount": page_html.count("pdf-shape"),
            "headerFill": table_header_fill,
            "borderColor": border_color,
            "columnCount": col_count or None,
            "approxColWidths": [f"{w}%" for w in col_widths] if col_widths else [],
        },
        "margins": {"leftPct": left},
    }


def _pages_from_assets(assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pages: list[dict[str, Any]] = []
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        asset_id = str(asset.get("id") or "")
        page_html = str(asset.get("pageHtml") or "")
        if not asset_id.startswith("page-") or not page_html:
            continue
        fragments = re.findall(
            r'<span class="pdf-text"[^>]*>([\s\S]*?)</span>', page_html
        )
        text = "\n".join(
            html.unescape(re.sub(r"<[^>]+>", "", fragment)).strip()
            for fragment in fragments
            if fragment.strip()
        ).strip()
        try:
            page_number = int(asset_id.split("-", 1)[1])
        except (IndexError, ValueError):
            page_number = len(pages) + 1
        # Cover + first body/commercials page keep the large budget; later
        # pages stay small so structure/outline POSTs do not time out.
        html_limit = _MAX_PAGE_HTML if page_number <= 2 else 8_000
        pages.append(
            {
                "n": page_number,
                "text": text[:_MAX_PAGE_TEXT],
                "pageHtml": page_html[:html_limit],
                "role": "unknown",
            }
        )
    return sorted(pages, key=lambda page: int(page["n"]))


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    item_id = str(body.get("itemId") or "")
    filename = str(body.get("filename") or "document.pdf")
    kind = str(body.get("kind") or "requirement").strip().lower()
    content_b64 = body.get("contentBase64")
    if not isinstance(content_b64, str) or not content_b64.strip():
        return {
            "ok": False,
            "status": "failed",
            "reason": "missing_content",
            "itemId": item_id,
            "pages": [],
            "pageCount": 0,
            "fullText": "",
        }

    from app.agents.document_template_agent import (
        extract_sample_bundle,
        extract_sample_text_from_file,
    )

    assets: list[dict[str, Any]] = []
    try:
        if filename.lower().endswith((".pdf", ".docx")):
            text, assets, warnings = extract_sample_bundle(
                filename, content_b64.strip()
            )
            geometry_hint = (
                _geometry_hint(assets) if kind == "proposal" else None
            )
        else:
            text, warnings = extract_sample_text_from_file(
                filename, content_b64.strip()
            )
            geometry_hint = None
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-corpus-ingest extract failed")
        return {
            "ok": False,
            "status": "failed",
            "reason": str(exc),
            "itemId": item_id,
            "pages": [],
            "pageCount": 0,
            "fullText": "",
            "warnings": [str(exc)],
        }

    parsed_extras: dict[str, Any] = {}
    if filename.lower().endswith(".pdf"):
        try:
            from app.agents.proposal_pdf_parse import parse_pdf_bytes

            raw_pdf = base64.b64decode(content_b64.strip())
            parsed = parse_pdf_bytes(raw_pdf, max_screenshots=0)
            parsed_extras = {
                "tables": parsed.get("tables") or [],
                "themeTokens": parsed.get("theme_tokens") or {},
                "layoutMeasured": parsed.get("layout_measured") or {},
                "headerText": parsed.get("header_text") or "",
                "footerText": parsed.get("footer_text") or "",
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-corpus-ingest pdf extras failed: %s", exc)

    cleaned = re.sub(r"[ \t]+", " ", (text or "").replace("\u00a0", " ")).strip()
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    pages = _pages_from_assets(assets)
    if not pages:
        # Text-only formats cannot expose physical page boundaries.
        raw_pages = [p.strip() for p in cleaned.split("\f") if p.strip()]
        if len(raw_pages) <= 1 and cleaned:
            chunk_size = 2500
            raw_pages = [
                cleaned[i : i + chunk_size].strip()
                for i in range(0, len(cleaned), chunk_size)
                if cleaned[i : i + chunk_size].strip()
            ][:_MAX_PAGES]
        pages = [
            {
                "n": i + 1,
                "text": page[:_MAX_PAGE_TEXT],
                "pageHtml": "",
                "role": "unknown",
            }
            for i, page in enumerate(raw_pages[:_MAX_PAGES])
        ]
    length_spec = length_spec_from_pages(pages[:_MAX_PAGES], cleaned)
    return {
        "ok": True,
        "status": "ok",
        "itemId": item_id,
        "pageCount": len(pages),
        "pages": pages[:_MAX_PAGES],
        "fullText": cleaned[:_MAX_FULL_TEXT],
        "lengthSpec": length_spec,
        "warnings": warnings if isinstance(warnings, list) else [],
        # Deprecated alias — design agent owns layoutStyle. Kept for back-compat
        # as a geometry hint only.
        "layoutStyle": None,
        "geometryHint": geometry_hint,
        "geometry": geometry_hint,
        "source": "extract",
        **parsed_extras,
    }
