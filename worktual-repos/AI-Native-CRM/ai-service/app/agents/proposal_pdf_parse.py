"""PyMuPDF parse for proposal PDFs: text, tables, measured layout, theme tokens.

Ideas from the standalone lab; implementation is local to this CRM.
"""

from __future__ import annotations

import base64
import logging
import re
from collections import Counter
from typing import Any

logger = logging.getLogger(__name__)


def int_to_hex(color: int | None) -> str:
    value = int(color or 0) & 0xFFFFFF
    return f"#{value:06x}"


def _hex_luminance(value: str) -> float:
    h = (value or "").strip().lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    if len(h) != 6:
        return 1.0
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return 1.0
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255.0


def contrast_text(bg: str, dark: str = "#111111", light: str = "#ffffff") -> str:
    return light if _hex_luminance(bg) < 0.55 else dark


# Stand-in brand colors used when a PDF did not measure a fill. Do not paint these.
_PLACEHOLDER_BRAND = {
    "#0b3d4a",
    "#0f2942",
    "#1d4ed8",
}


def _usable_table_hex(value: Any) -> str:
    """Table chrome only. #1f3864 is the design-agent stand-in, not a measured fill."""
    raw = _usable_brand_hex(value)
    if raw.lower() == "#1f3864":
        return ""
    return raw


def _usable_brand_hex(value: Any) -> str:
    raw = str(value or "").strip()
    if not re.fullmatch(r"#[0-9a-fA-F]{3,8}", raw):
        return ""
    if raw.lower() in _PLACEHOLDER_BRAND:
        return ""
    return raw


def _css_color(value: Any, fallback: str) -> str:
    return _usable_brand_hex(value) or fallback


_SECTION_CHROME_RE = re.compile(r"^\d+(\.\d+)*[.)]?\s+\S")
_BOILERPLATE_CHROME_RE = re.compile(
    r"\b(confidential|proprietary|copyright|page\s*\d+|internal use)\b"
    r"|proposal\s*\|",
    re.I,
)
_SENTENCE_CHROME_RE = re.compile(
    r"^(this|that|the|our|an?)\s+\S"
    r"|[.!?…]\s*$"
    r"|\benables\b"
    r"|\bintegrated approach\b"
    r"|\bconnect customer\b",
    re.I,
)


def _cover_chrome_align(aligns: list[str | None]) -> str:
    """One cover alignment from brand/title/prepared/date votes."""
    votes = [a for a in aligns if a in {"left", "center", "right"}]
    if not votes:
        return "center"
    center_n = votes.count("center")
    right_n = votes.count("right")
    left_n = votes.count("left")
    if center_n >= left_n and center_n >= right_n and center_n > 0:
        return "center"
    if right_n > left_n and right_n > center_n:
        return "right"
    return "left"


def usable_running_chrome(text: str | None) -> bool:
    """True for a short repeating header/footer — not gold body copy or a section title."""
    raw = str(text or "").strip()
    if not raw or len(raw) > 56:
        return False
    if len(raw.split()) > 8:
        return False
    if _SECTION_CHROME_RE.match(raw):
        return False
    if _SENTENCE_CHROME_RE.search(raw) and not _BOILERPLATE_CHROME_RE.search(raw):
        return False
    return True


def _rgb_tuple_hex(value: Any) -> str | None:
    if not value or not isinstance(value, (tuple, list)) or len(value) < 3:
        return None
    r, g, b = [int(max(0.0, min(1.0, float(c))) * 255) for c in value[:3]]
    return f"#{r:02x}{g:02x}{b:02x}"


def default_theme_tokens() -> dict[str, Any]:
    return {
        "fonts": {
            "brand": {
                "family": "Helvetica, sans-serif",
                "size": 24,
                "weight": 700,
                "color": "#1a1a1a",
            },
            "title": {
                "family": "Helvetica, sans-serif",
                "size": 18,
                "weight": 700,
                "color": "#1a1a1a",
            },
            "h1": {
                "family": "Helvetica, sans-serif",
                "size": 12,
                "weight": 700,
                "color": "#1a1a1a",
            },
            "h2": {
                "family": "Helvetica, sans-serif",
                "size": 11,
                "weight": 700,
                "color": "#1a1a1a",
            },
            "body": {
                "family": "Helvetica, sans-serif",
                "size": 11,
                "weight": 400,
                "color": "#1a1a1a",
            },
            "table_header": {
                "family": "Helvetica, sans-serif",
                "size": 10,
                "weight": 700,
                "color": "#ffffff",
            },
            "table_cell": {
                "family": "Helvetica, sans-serif",
                "size": 10,
                "weight": 400,
                "color": "#1a1a1a",
            },
        },
        "colors": {
            "primary": "#1a1a1a",
            "accent": "#1a1a1a",
            "text": "#1a1a1a",
            "muted": "#5c6b73",
            "table_header_bg": "",
            "table_border": "#d0d7db",
            "bg": "#ffffff",
        },
        "margins_pt": {"top": 48, "right": 48, "bottom": 48, "left": 48},
        "table": {"header_fill": False, "emphasize_last_col": False},
        "layout": {},
        "page": {"width_pt": 595, "height_pt": 842, "format": "A4"},
    }


def tables_as_text(tables: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for table in tables[:12]:
        headers = " | ".join(str(h) for h in (table.get("headers") or [])[:12])
        parts.append(f"TABLE p{table.get('page')}: {headers}")
        for row in (table.get("rows") or [])[:8]:
            parts.append(" | ".join(str(c) for c in row[:12]))
    return "\n".join(parts)


def _clean_font(name: str) -> str:
    return re.sub(r"[-,]?(Bold|Italic|Regular|MT)$", "", name or "Helvetica")


def _font_css(name: str) -> str:
    lower = (name or "").lower()
    if "times" in lower:
        return '"Times New Roman", Times, serif'
    if "georgia" in lower:
        return "Georgia, serif"
    if "courier" in lower:
        return '"Courier New", monospace'
    return f'"{_clean_font(name)}", Helvetica, Arial, sans-serif'


def _is_saturated(hex_color: str) -> bool:
    h = (hex_color or "").lstrip("#")
    if len(h) != 6:
        return False
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return (max(r, g, b) - min(r, g, b)) > 25 or max(r, g, b) < 80


def _line_bottom(ln: dict[str, Any]) -> float:
    bbox = ln.get("bbox") or [0, 0, 0, 0]
    y0, y1 = float(bbox[1]), float(bbox[3])
    size = float(ln.get("size") or 11)
    if (y1 - y0) > max(size * 2.4, 18):
        return y0 + size * 1.15
    return y1


def _clamp(val: float, lo: float, hi: float) -> float:
    return round(max(lo, min(hi, float(val))), 1)


def _looks_like_running_title(text: str) -> bool:
    t = re.sub(r"\s+", " ", (text or "").strip())
    low = t.lower()
    if "|" in t and "proposal" in low:
        return True
    if re.search(r"proposal\s*\|?\s*\d+\s*$", low):
        return True
    return False


def _align_of(bbox: list[float], page_width: float) -> str:
    x0, _, x1, _ = bbox
    mid = (x0 + x1) / 2
    if mid < page_width * 0.38:
        return "left"
    if mid > page_width * 0.62:
        return "right"
    return "center"


def _space_between(a: dict[str, Any] | None, b: dict[str, Any] | None) -> float:
    if not a or not b:
        return 0.0
    gap = b["bbox"][1] - _line_bottom(a)
    return round(max(0.0, gap), 1)


_META_LABELS = (
    "client",
    "document",
    "validity",
    "prepared for",
    "prepared by",
    "prepared by",
    "date",
    "quotation validity",
)


def measure_layout(
    lines: list[dict[str, Any]],
    page_width: float,
    page_height: float,
    body_size: float,
) -> dict[str, Any]:
    page1 = [ln for ln in lines if ln.get("page") == 0 and (ln.get("text") or "").strip()]
    if not page1:
        return {}

    def is_chrome(ln: dict[str, Any]) -> bool:
        y0 = ln["bbox"][1]
        y1 = ln["bbox"][3]
        size = float(ln.get("size") or 0)
        if size >= body_size + 3:
            return False
        return y0 < page_height * 0.08 or y1 > page_height * 0.92

    content = [ln for ln in page1 if not is_chrome(ln)] or page1

    def align_of(ln: dict[str, Any] | None) -> str:
        if not ln:
            return "left"
        x0, _, x1, _ = ln["bbox"]
        margin = min(item["bbox"][0] for item in content)
        cx = (x0 + x1) / 2
        band = max(36.0, page_width * 0.18)
        if abs(cx - page_width / 2) <= band:
            return "center"
        if x0 <= margin + 14:
            return "left"
        if x0 > page_width * 0.45:
            return "right"
        return "left"

    def find_line(pred) -> dict[str, Any] | None:
        for ln in content:
            if pred(ln.get("text") or ""):
                return ln
        return None

    proposal_lines = [
        ln
        for ln in content
        if "proposal" in ln["text"].lower()
        and "quotation" not in ln["text"].lower()
        and "document" not in ln["text"].lower()
        and not _looks_like_running_title(ln["text"])
        and len(ln["text"]) < 90
    ]
    title = None
    if proposal_lines:
        best_size = max(float(ln.get("size") or 0) for ln in proposal_lines)
        top = [ln for ln in proposal_lines if abs(float(ln.get("size") or 0) - best_size) < 0.6]
        title = min(top, key=lambda s: ln_y(s))
    title_block_end = title
    if title:
        cluster = [title]
        for ln in content:
            if ln["bbox"][1] <= title["bbox"][1] + 0.5:
                continue
            if ln["text"].lower().startswith("prepared"):
                break
            if ln["bbox"][1] > _line_bottom(cluster[-1]) + 10:
                break
            if abs(float(ln.get("size") or 0) - float(title.get("size") or 0)) < 0.6 and align_of(ln) == align_of(title):
                cluster.append(ln)
            else:
                break
        title_block_end = cluster[-1]

    prepared_labeled = find_line(lambda t: t.lower().startswith("prepared for"))
    prepared = prepared_labeled
    date_ln = find_line(lambda t: bool(re.search(r"\d{1,2}\s+\w+\s+\d{4}", t)))
    overview = find_line(
        lambda t: t.strip().lower() == "overview"
        or ("overview" in t.strip().lower() and len(t) < 80)
    )
    if not prepared and title_block_end and overview:
        prepared = next(
            (
                ln
                for ln in content
                if title_block_end["bbox"][3] < ln["bbox"][1] < overview["bbox"][1]
                and len(ln["text"]) < 80
                and float(ln.get("size") or 0) < (float(title.get("size") or 99) if title else 99)
                and not ln["text"].strip()[:1].isdigit()
            ),
            None,
        )

    brand_pool = [ln for ln in content if title is None or ln["text"] != title["text"]]
    brand = max(brand_pool, key=lambda s: float(s.get("size") or 0)) if brand_pool else None
    if brand and title and float(brand.get("size") or 0) <= float(title.get("size") or 0) + 0.5:
        brand = None
    elif brand and len((brand.get("text") or "").split()) > 6:
        brand = None

    tag_lines = [
        ln
        for ln in content
        if ("•" in ln["text"] or "●" in ln["text"])
        and ln["bbox"][1] < (overview["bbox"][1] if overview else 400)
    ]

    def following_line(ln: dict[str, Any] | None, pool: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not ln:
            return None
        y = ln["bbox"][1]
        cands = [x for x in pool if x["bbox"][1] > y + 1]
        return min(cands, key=lambda x: x["bbox"][1]) if cands else None

    def preceding_line(ln: dict[str, Any] | None, pool: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not ln:
            return None
        y = ln["bbox"][1]
        cands = [x for x in pool if x["bbox"][1] < y - 1]
        return max(cands, key=lambda x: x["bbox"][1]) if cands else None

    body_gaps = []
    for i in range(1, len(page1)):
        if page1[i]["size"] == body_size and page1[i - 1]["size"] == body_size:
            g = page1[i]["bbox"][1] - page1[i - 1]["bbox"][1]
            if 10 < g < 22:
                body_gaps.append(g)
    body_line_gap = (
        round(sorted(body_gaps)[len(body_gaps) // 2], 1)
        if body_gaps
        else round(body_size * 1.32, 1)
    )

    heading_gaps = []
    for i, ln in enumerate(page1):
        if ln.get("bold") and len(ln["text"]) < 80 and align_of(ln) == "left" and i:
            g = ln["bbox"][1] - page1[i - 1]["bbox"][1]
            if 18 < g < 50:
                heading_gaps.append(g)
    space_before_heading = (
        round(sorted(heading_gaps)[len(heading_gaps) // 2], 1) if heading_gaps else 26.0
    )

    after_heading = 8.0
    if overview:
        nxt = following_line(overview, content)
        if nxt:
            after_heading = _space_between(overview, nxt)
        prev = preceding_line(overview, content)
        if prev:
            space_before_heading = _space_between(prev, overview)
    after_heading = _clamp(after_heading, 2.0, max(body_size * 1.8, 14.0))
    space_before_heading = _clamp(space_before_heading, 4.0, 36.0)

    list_indents = [ln["bbox"][0] for ln in content if ln["text"].strip()[:1] in {"●", "•"}]
    margin_left = min(ln["bbox"][0] for ln in content)
    list_indent = round((min(list_indents) - margin_left) if list_indents else 18.0, 1)

    tags_align = align_of(tag_lines[0]) if tag_lines else "center"
    tags_layout = "centered_wrap"
    if tag_lines:
        if all(align_of(t) == "left" for t in tag_lines) and len(tag_lines) >= 3:
            tags_layout = "vertical"
        elif len(tag_lines) == 1 and align_of(tag_lines[0]) == "left":
            tags_layout = "horizontal"
        else:
            tags_layout = "centered_wrap"
    if tags_layout == "centered_wrap":
        tags_align = "center"

    para_gaps = [g for g in body_gaps if g > body_line_gap + 3]
    paragraph_gap = (
        round(sorted(para_gaps)[len(para_gaps) // 2], 1)
        if para_gaps
        else round(body_line_gap + 5, 1)
    )

    meta_rows: list[dict[str, str]] = []
    seen_meta: set[str] = set()
    for lab in (
        "Client",
        "Document",
        "Validity",
        "Prepared For",
        "Prepared By",
        "Date",
    ):
        ln = find_line(lambda t, label=lab: t.strip().lower() == label.lower())
        if not ln:
            ln = find_line(
                lambda t, label=lab: t.strip().lower().startswith(label.lower())
                and ":" in t
            )
        if not ln:
            continue
        key = lab.strip().lower()
        if key in seen_meta:
            continue
        val = ""
        if ":" in ln["text"]:
            val = ln["text"].split(":", 1)[1].strip()
        else:
            val_ln = next(
                (
                    x
                    for x in page1
                    if abs(x["bbox"][1] - ln["bbox"][1]) < 6
                    and x["bbox"][0] > ln["bbox"][2] + 6
                    and x["text"].strip().lower() not in _META_LABELS
                ),
                None,
            )
            val = val_ln["text"].strip() if val_ln else ""
        seen_meta.add(key)
        meta_rows.append({"label": lab, "value": val})

    meta_labels = [
        ln
        for ln in content
        if ln["text"].strip().lower() in _META_LABELS
    ]
    next_after_tags = meta_labels[0] if meta_labels else overview
    space_after_tags = _space_between(tag_lines[-1] if tag_lines else None, next_after_tags)

    brand_align = align_of(brand) if brand else None
    title_align = align_of(title) if title else None
    prepared_align = align_of(prepared) if prepared else None
    date_align = align_of(date_ln) if date_ln else None
    cover_align = _cover_chrome_align(
        [brand_align, title_align, prepared_align, date_align]
    )
    if cover_align == "center":
        brand_align = brand_align or "center"
        title_align = "center"
        prepared_align = "center"
        date_align = "center"
    else:
        brand_align = brand_align or "center"
        title_align = title_align or cover_align
        prepared_align = prepared_align or cover_align
        date_align = date_align or cover_align

    return {
        "cover_align": cover_align,
        "brand_align": brand_align,
        "title_align": title_align,
        "prepared_align": prepared_align,
        "date_align": date_align,
        "tags_layout": tags_layout,
        "tags_align": tags_align,
        "heading_align": align_of(overview) if overview else "left",
        "body_align": "left",
        "has_cover_meta_table": bool(meta_rows) or len(meta_labels) >= 2,
        "meta_rows": meta_rows,
        "brand_font_pt": float((brand or {}).get("size") or 0),
        "title_font_pt": float((title or {}).get("size") or body_size),
        "prepared_font_pt": float((prepared or {}).get("size") or body_size),
        "date_font_pt": float((date_ln or {}).get("size") or body_size),
        "prepared_bold": bool((prepared or {}).get("bold", True)),
        "heading_font_pt": float((overview or {}).get("size") or body_size),
        "body_font_pt": float(body_size),
        "table_font_pt": float(body_size),
        "space_after_brand_pt": _clamp(_space_between(brand, title or prepared), 0.0, 80.0) if brand else 0.0,
        "space_after_title_pt": _clamp(_space_between(title_block_end or title, prepared or date_ln), 0.0, 24.0),
        "space_after_prepared_pt": _clamp(_space_between(prepared, date_ln), 0.0, 12.0) if prepared and date_ln else 4.0,
        "space_after_date_pt": _clamp(_space_between(date_ln or prepared, tag_lines[0] if tag_lines else None), 0.0, 28.0),
        "space_after_tags_pt": _clamp(space_after_tags, 0.0, 40.0),
        "space_before_heading_pt": space_before_heading,
        "space_after_heading_pt": round(after_heading, 1),
        "prepared_has_label": bool(prepared_labeled),
        "body_line_gap_pt": body_line_gap,
        "list_indent_pt": max(list_indent, 12),
        "paragraph_gap_pt": _clamp(paragraph_gap, 4.0, 22.0),
        "tag_color": (tag_lines[0].get("color") if tag_lines else "") or "",
        "title_color": (title or {}).get("color") or "",
        "heading_color": (overview or {}).get("color") or "",
        "cover_rule": False,
    }


def infer_chrome(
    drawings_pages: list[Any],
    page_width: float,
    page_height: float = 842,
) -> dict[str, Any]:
    """Grid lines, cover divider, header fills, and last-column fill from PDF drawings."""
    cover_meta: dict[str, Any] = {}
    cover_rule = False
    cover_rule_color = ""
    cover_hlines: list[tuple[float, str]] = []
    if drawings_pages:
        vlines: list[float] = []
        border = "#bfbfbf"
        for d in drawings_pages[0] or []:
            r = d.get("rect") if isinstance(d, dict) else None
            if not r:
                continue
            col = _rgb_tuple_hex(d.get("color") if isinstance(d, dict) else None)
            if col:
                border = col
            width = float(getattr(r, "width", 0) or 0)
            height = float(getattr(r, "height", 0) or 0)
            x0 = float(getattr(r, "x0", 0) or 0)
            y0 = float(getattr(r, "y0", 0) or 0)
            if width < 2.5 and height > 16:
                vlines.append(x0)
            if height < 2.5 and width > page_width * 0.45 and 80 < y0 < page_height * 0.45:
                cover_hlines.append((y0, col or ""))
        xs = sorted({round(x, 0) for x in vlines})
        if len(xs) >= 3:
            cover_meta = {
                "border_color": border,
                "label_width_pt": round(xs[1] - xs[0], 1),
                "width_pt": round(xs[-1] - xs[0], 1),
            }
        elif len(xs) >= 2:
            cover_meta = {
                "border_color": border,
                "label_width_pt": round(xs[1] - xs[0], 1),
            }
        isolated = [
            (y, col)
            for y, col in cover_hlines
            if sum(1 for y2, _ in cover_hlines if abs(y2 - y) < 50) == 1
        ]
        if isolated:
            cover_rule = True
            cover_rule_color = isolated[0][1]

    table: dict[str, Any] = {
        "header_fill": False,
        "borders": "grid",
        "emphasize_last_col": False,
    }
    best: tuple[int, dict[str, Any]] | None = None
    for drawings in drawings_pages:
        header_fills: list[str] = []
        zebra_fills: list[str] = []
        last_col_fills: list[str] = []
        vlines = []
        border = "#bfbfbf"
        for d in drawings or []:
            if not isinstance(d, dict):
                continue
            r = d.get("rect")
            if not r:
                continue
            fill = _rgb_tuple_hex(d.get("fill"))
            width = float(getattr(r, "width", 0) or 0)
            height = float(getattr(r, "height", 0) or 0)
            x0 = float(getattr(r, "x0", 0) or 0)
            if width < 2.5 and height > 40:
                vlines.append(x0)
                border = _rgb_tuple_hex(d.get("color")) or border
            if not fill or fill.lower() in {"#ffffff", "#fff"}:
                continue
            if width > page_width * 0.5 and 8 < height < 40:
                if _hex_luminance(fill) < 0.55:
                    header_fills.append(fill)
                else:
                    zebra_fills.append(fill)
            elif x0 > page_width * 0.45 and width < page_width * 0.55 and height > 16:
                last_col_fills.append(fill)
        xs = sorted({round(x, 0) for x in vlines})
        widths = [xs[i + 1] - xs[i] for i in range(len(xs) - 1)] if len(xs) >= 3 else []
        total = sum(widths) or 1
        col_widths = (
            [f"{max(1, round(w / total * 100))}%" for w in widths] if widths else []
        )
        if col_widths and min(int(w.strip("%") or 0) for w in col_widths) < 8:
            col_widths = []
        last_bg = (
            last_col_fills[-1]
            if last_col_fills and _hex_luminance(last_col_fills[-1]) < 0.45
            else None
        )
        header_bg = Counter(header_fills).most_common(1)[0][0] if header_fills else None
        zebra = Counter(zebra_fills).most_common(1)[0][0] if zebra_fills else None
        score = len(header_fills) + len(last_col_fills) + len(zebra_fills)
        if score == 0:
            continue
        cand = {
            "header_fill": bool(header_bg),
            "header_bg": header_bg,
            "zebra_fill": zebra,
            "borders": "grid",
            "border_color": border,
            "last_col_bg": last_bg,
            "last_col_color": contrast_text(last_bg) if last_bg else "#111111",
            "col_widths": col_widths,
            "emphasize_last_col": bool(last_bg),
        }
        if best is None or score > best[0]:
            best = (score, cand)
    if best:
        table.update({k: v for k, v in best[1].items() if v not in (None, [], "")})
        table["header_fill"] = bool(best[1].get("header_fill"))
        table["emphasize_last_col"] = bool(best[1].get("emphasize_last_col"))
    return {
        "cover_meta": cover_meta,
        "table": table,
        "cover_rule": cover_rule,
        "cover_rule_color": cover_rule_color,
    }


def apply_chrome_to_tokens(
    tokens: dict[str, Any],
    chrome: dict[str, Any],
) -> dict[str, Any]:
    tokens = dict(tokens or {})
    prior_table = dict(tokens.get("table") or {})
    incoming = dict(chrome.get("table") or {})
    # Drawing pass with no header band must not clobber clustered header_fill.
    if not incoming.get("header_bg") and not incoming.get("header_fill"):
        incoming.pop("header_fill", None)
        incoming.pop("header_bg", None)
    tokens["table"] = {**prior_table, **incoming}
    if chrome.get("cover_meta"):
        tokens["cover_meta"] = chrome["cover_meta"]
    layout = dict(tokens.get("layout") or {})
    if chrome.get("cover_rule"):
        layout["cover_rule"] = True
        if chrome.get("cover_rule_color"):
            layout["cover_rule_color"] = chrome["cover_rule_color"]
    tokens["layout"] = layout
    header_bg = (tokens.get("table") or {}).get("header_bg")
    if header_bg:
        colors = dict(tokens.get("colors") or {})
        colors["table_header_bg"] = header_bg
        if (tokens.get("table") or {}).get("header_fill"):
            colors["primary"] = header_bg
        tokens["colors"] = colors
        fonts = dict(tokens.get("fonts") or {})
        th = dict(fonts.get("table_header") or {})
        th["color"] = contrast_text(header_bg)
        fonts["table_header"] = th
        tokens["fonts"] = fonts
    return tokens


def ln_y(ln: dict[str, Any]) -> float:
    return float((ln.get("bbox") or [0, 0, 0, 0])[1])


def cluster_theme_tokens(
    spans: list[dict[str, Any]],
    page_width: float,
    page_height: float,
    header_candidates: list[str],
    footer_candidates: list[str],
    lines: list[dict[str, Any]],
) -> dict[str, Any]:
    if not spans:
        return default_theme_tokens()

    def in_chrome(span: dict[str, Any]) -> bool:
        y0 = (span.get("bbox") or [0, 0, 0, 0])[1]
        return y0 < page_height * 0.08 or y0 > page_height * 0.92

    content_spans = [s for s in spans if not in_chrome(s)] or spans
    body_candidates = [s["size"] for s in content_spans if 8.0 <= float(s["size"]) <= 13.0]
    body_size = (
        Counter(body_candidates).most_common(1)[0][0]
        if body_candidates
        else Counter(s["size"] for s in content_spans).most_common(1)[0][0]
    )
    page1 = [s for s in spans if s["page"] == 0]
    brand_span = max(page1, key=lambda s: s["size"]) if page1 else spans[0]
    layout = measure_layout(lines, page_width, page_height, body_size)
    title_size = layout.get("title_font_pt") or body_size
    heading_size = layout.get("heading_font_pt") or body_size
    if heading_size >= brand_span["size"] - 0.5:
        heading_size = body_size
    body_fonts = Counter(s["font"] for s in spans if s["size"] == body_size)
    body_font = body_fonts.most_common(1)[0][0] if body_fonts else "Helvetica"
    heading_fonts = Counter(
        s["font"] for s in spans if s.get("bold") and abs(s["size"] - heading_size) <= 0.6
    )
    heading_font = heading_fonts.most_common(1)[0][0] if heading_fonts else body_font
    colorful = [
        s["color"]
        for s in spans
        if s["color"].lower() not in {"#000000", "#111111", "#ffffff", "#1a1a1a"}
        and _is_saturated(s["color"])
    ]
    text_color = Counter(s["color"] for s in spans if s["size"] == body_size).most_common(1)[0][0]
    primary = Counter(colorful).most_common(1)[0][0] if colorful else text_color
    raw_title_color = str(layout.get("title_color") or "")
    title_color = raw_title_color if _is_saturated(raw_title_color) else (raw_title_color or text_color)
    heading_color = str(layout.get("heading_color") or "") or title_color or text_color
    if _is_saturated(primary):
        if not _is_saturated(str(title_color or "")):
            title_color = primary
        if not _is_saturated(str(heading_color or "")):
            heading_color = primary
    xs = [s["bbox"][0] for s in spans if s.get("bbox")]
    ys = [s["bbox"][1] for s in spans if s.get("bbox")]
    x2s = [s["bbox"][2] for s in spans if s.get("bbox")]
    y2s = [s["bbox"][3] for s in spans if s.get("bbox")]
    return {
        "fonts": {
            "brand": {
                "family": _font_css(brand_span["font"]),
                "size": layout.get("brand_font_pt") or brand_span["size"],
                "weight": 700,
                "color": (
                    primary
                    if _is_saturated(primary)
                    and not _is_saturated(str(brand_span.get("color") or ""))
                    else brand_span["color"]
                ),
            },
            "title": {
                "family": _font_css(heading_font),
                "size": title_size,
                "weight": 700,
                "color": title_color,
            },
            "h1": {
                "family": _font_css(heading_font),
                "size": heading_size,
                "weight": 700,
                "color": heading_color,
            },
            "h2": {
                "family": _font_css(heading_font),
                "size": max(body_size, heading_size - 1),
                "weight": 700,
                "color": heading_color,
            },
            "body": {
                "family": _font_css(body_font),
                "size": layout.get("body_font_pt") or body_size,
                "weight": 400,
                "color": text_color,
            },
            "table_header": {
                "family": _font_css(heading_font),
                "size": layout.get("table_font_pt") or max(body_size - 0.5, 8),
                "weight": 700,
                "color": "#ffffff",
            },
            "table_cell": {
                "family": _font_css(body_font),
                "size": layout.get("table_font_pt") or max(body_size - 0.5, 8),
                "weight": 400,
                "color": text_color,
            },
        },
        "colors": {
            "primary": primary,
            "accent": primary,
            "text": text_color,
            "muted": "#5c6b73",
            "table_header_bg": "",
            "table_border": "#d0d7db",
            "bg": "#ffffff",
        },
        "margins_pt": {
            "top": round(max(12, min(ys) if ys else 48), 1),
            "right": round(max(12, page_width - (max(x2s) if x2s else page_width - 48)), 1),
            "bottom": round(max(12, page_height - (max(y2s) if y2s else page_height - 48)), 1),
            "left": round(max(12, min(xs) if xs else 48), 1),
        },
        "table": {"header_fill": False, "emphasize_last_col": False},
        "header_text": next(
            (
                t
                for t, n in Counter(header_candidates).most_common()
                if n >= 2 and usable_running_chrome(t)
            ),
            "",
        ),
        "footer_text": next(
            (
                t
                for t, n in Counter(footer_candidates).most_common()
                if n >= 2 and usable_running_chrome(t)
            ),
            "",
        ),
        "layout": layout,
        "page": {
            "width_pt": round(page_width, 1),
            "height_pt": round(page_height, 1),
            "format": "A4" if abs(page_height - 842) < 20 else "custom",
        },
    }


def compile_theme_css(tokens: dict[str, Any] | None, has_logo: bool = False) -> str:
    tokens = tokens or default_theme_tokens()
    f = tokens.get("fonts") or default_theme_tokens()["fonts"]
    c = tokens.get("colors") or default_theme_tokens()["colors"]
    m = tokens.get("margins_pt") or {"top": 48, "right": 48, "bottom": 48, "left": 48}
    page = tokens.get("page") or {"width_pt": 595, "height_pt": 842}
    layout = tokens.get("layout") or {}
    tbl = tokens.get("table") or {}

    def sz(role: str, fallback: float) -> str:
        return f"{f.get(role, {}).get('size', fallback)}pt"

    caps = {
        "space_after_heading_pt": 16,
        "space_before_heading_pt": 36,
        "paragraph_gap_pt": 22,
        "space_after_brand_pt": 80,
        "space_after_title_pt": 24,
        "space_after_tags_pt": 40,
        "space_after_prepared_pt": 12,
        "space_after_date_pt": 28,
    }

    def pt(key: str, fallback: float) -> str:
        val = layout.get(key)
        if val is None or val == "":
            val = fallback
        val = float(val)
        if key in caps:
            val = min(val, caps[key])
        return f"{val}pt"

    cover_align = str(layout.get("cover_align") or "").strip().lower()
    if cover_align not in {"left", "center", "right"}:
        cover_align = _cover_chrome_align(
            [
                layout.get("brand_align"),
                layout.get("title_align"),
                layout.get("prepared_align"),
                layout.get("date_align"),
            ]
        )
    if cover_align == "center":
        brand_align = layout.get("brand_align") or "center"
        title_align = "center"
        prepared_align = "center"
        date_align = "center"
    else:
        brand_align = layout.get("brand_align") or cover_align or "center"
        title_align = layout.get("title_align") or cover_align
        prepared_align = layout.get("prepared_align") or cover_align
        date_align = layout.get("date_align") or cover_align
    heading_align = layout.get("heading_align") or "left"
    body_align = layout.get("body_align") or "left"
    tags_layout = layout.get("tags_layout") or "centered_wrap"
    tags_align = layout.get("tags_align") or "center"
    title_size = f.get("title", {}).get("size") or 11
    prepared_size = layout.get("prepared_font_pt") or title_size
    date_size = layout.get("date_font_pt") or f.get("body", {}).get("size") or 11
    prepared_weight = 700 if layout.get("prepared_bold", True) else 400
    h1_color = f.get("h1", {}).get("color") or c.get("text", "#1a1a1a")
    line_gap = float(layout.get("body_line_gap_pt") or 14.5)
    body_size = float(f.get("body", {}).get("size") or 11)
    line_height = round(line_gap / body_size, 2) if body_size else 1.32
    tag_li_display = "block" if tags_layout == "vertical" else "inline"
    tags_ul_align = "left" if tags_layout in {"vertical", "horizontal"} else tags_align
    tag_color = layout.get("tag_color") or _css_color(c.get("primary"), "#1a1a1a")
    cm = tokens.get("cover_meta") or {}
    grid_border = (
        tbl.get("border_color")
        or cm.get("border_color")
        or c.get("table_border")
        or "#bfbfbf"
    )
    last_bg = _usable_brand_hex(tbl.get("last_col_bg"))
    last_fg = tbl.get("last_col_color") or (contrast_text(last_bg) if last_bg else "#111111")
    if last_bg and _hex_luminance(last_bg) >= 0.55:
        last_fg = c.get("text") or "#111111"
    emphasize = bool(last_bg) and bool(tbl.get("emphasize_last_col")) and _hex_luminance(last_bg) < 0.55
    header_bg = _usable_table_hex(tbl.get("header_bg")) or _usable_table_hex(
        c.get("table_header_bg")
    )
    header_fill = bool(header_bg) and _hex_luminance(str(header_bg)) < 0.55
    th_color = f.get("table_header", {}).get("color") or contrast_text(header_bg)
    zebra = tbl.get("zebra_fill") or ""
    logo_display = "block" if has_logo else "none"
    brand_color = f.get("brand", {}).get("color", c.get("primary"))
    rule_color = layout.get("cover_rule_color") or _css_color(c.get("primary"), "#1a1a1a")
    rule_display = "block" if layout.get("cover_rule") else "none"
    meta_border = cm.get("border_color") or grid_border
    label_w = cm.get("label_width_pt") or 85.5
    page_w = float(page.get("width_pt") or 595)
    pad_x = float(m.get("left") or 48) + float(m.get("right") or 48)
    content_w = max(page_w - pad_x, 1.0)
    measured_meta_w = float(cm.get("width_pt") or 0)
    # Two vertical lines (label edge + divider) are not the full table.
    # A collapsed width_pt makes the cover table a centered island.
    if measured_meta_w >= content_w * 0.55:
        meta_width_css = f"{measured_meta_w}pt"
    else:
        meta_width_css = "100%"
    col_widths = tbl.get("col_widths") or []
    col_sels = (
        ["table.bp-table.emphasize", "table.grid.emphasize"]
        if emphasize
        else ["table.bp-table", "table.grid"]
    )
    col_css = (
        "\n".join(
            f".proposal-doc {sel} th:nth-child({i}), "
            f".proposal-doc {sel} td:nth-child({i}) {{ width: {w}; }}"
            for sel in col_sels
            for i, w in enumerate(col_widths[:6], start=1)
        )
        if col_widths and 2 <= len(col_widths) <= 5
        else ""
    )
    last_col_css = ""
    if emphasize:
        last_col_css = f"""
.proposal-doc table.grid.emphasize th:last-child,
.proposal-doc table.grid.emphasize td:last-child,
.proposal-doc .bp-table.emphasize th:last-child,
.proposal-doc .bp-table.emphasize td:last-child {{
  background: {last_bg};
  color: {last_fg};
  font-weight: 400;
}}
.proposal-doc table.grid.emphasize th:last-child,
.proposal-doc .bp-table.emphasize th:last-child {{
  font-weight: 700;
}}
""".strip()
    header_css = ""
    if header_fill:
        header_css = f"""
.proposal-doc table.grid th, .proposal-doc .bp-table th {{
  background: {header_bg};
  color: {th_color};
}}
""".strip()
    zebra_css = ""
    if zebra:
        zebra_css = f"""
.proposal-doc table.grid tbody tr:nth-child(even) td,
.proposal-doc .bp-table tbody tr:nth-child(even) td {{
  background: {zebra};
  color: var(--c-text);
}}
""".strip()
    return f"""
.proposal-doc {{
  --c-primary: {_css_color(c.get("primary"), "#1a1a1a")};
  --c-accent: {_css_color(c.get("accent"), "#1a1a1a")};
  --c-text: {_css_color(c.get("text"), "#1a1a1a")};
  --c-muted: {_css_color(c.get("muted"), "#5c6b73")};
  --c-th: {_usable_table_hex(c.get("table_header_bg")) or "transparent"};
  --c-border: {c.get("table_border", "#d0d7db")};
  --c-bg: {c.get("bg", "#ffffff")};
  --font-brand: {f.get("brand", {}).get("family", "Helvetica, sans-serif")};
  --font-h: {f.get("h1", {}).get("family", "Helvetica, sans-serif")};
  --font-body: {f.get("body", {}).get("family", "Helvetica, sans-serif")};
  --size-brand: {sz("brand", 24)};
  --size-title: {title_size}pt;
  --size-prepared: {prepared_size}pt;
  --size-date: {date_size}pt;
  --size-h1: {sz("h1", 11)};
  --size-h2: {sz("h2", 11)};
  --size-body: {sz("body", 11)};
  --size-th: {f.get("table_header", {}).get("size", 11)}pt;
  --size-td: {f.get("table_cell", {}).get("size", 11)}pt;
  --gap-brand: {pt("space_after_brand_pt", 55)};
  --gap-title: {pt("space_after_title_pt", 16)};
  --gap-prepared: {pt("space_after_prepared_pt", 4)};
  --gap-date: {pt("space_after_date_pt", 25)};
  --gap-tags: {pt("space_after_tags_pt", 35)};
  --gap-heading-before: {pt("space_before_heading_pt", 26)};
  --gap-heading-after: {pt("space_after_heading_pt", 10)};
  --gap-para: {pt("paragraph_gap_pt", 12)};
  --list-indent: {pt("list_indent_pt", 18)};
  box-sizing: border-box;
  width: {page.get("width_pt", 595)}pt;
  max-width: 100%;
  margin: 0 auto;
  background: var(--c-bg);
  color: var(--c-text);
  font-family: var(--font-body);
  font-size: var(--size-body);
  line-height: {line_height};
  padding: {m.get("top", 48)}pt {m.get("right", 48)}pt {m.get("bottom", 48)}pt {m.get("left", 48)}pt;
}}
.proposal-doc * {{ box-sizing: border-box; }}
.proposal-doc .cover-rule {{
  display: {rule_display};
  border: none;
  border-top: 0.8pt solid {rule_color};
  margin: 8pt 0 14pt;
}}
.proposal-doc .cover-logo {{
  max-height: 48pt;
  max-width: 160pt;
  display: {logo_display};
  margin-bottom: 10pt;
}}
.proposal-doc .cover-brand {{
  font-family: var(--font-brand);
  font-size: var(--size-brand);
  font-weight: 700;
  color: {brand_color};
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-align: {brand_align};
  margin: 0 0 var(--gap-brand);
}}
.proposal-doc .cover-title, .proposal-doc .bp-cover-title {{
  font-family: var(--font-h);
  font-size: var(--size-title);
  font-weight: 700;
  line-height: 1.2;
  color: {f.get("title", {}).get("color") or c.get("primary") or "#1a1a1a"};
  text-align: {title_align};
  margin: 0 0 var(--gap-title);
}}
.proposal-doc .cover-prepared {{
  font-size: var(--size-prepared);
  font-weight: {prepared_weight};
  text-align: {prepared_align};
  margin: 0 0 var(--gap-prepared);
}}
.proposal-doc .cover-date {{
  font-size: var(--size-date);
  text-align: {date_align};
  margin: 0 0 var(--gap-date);
}}
.proposal-doc .cover-block.cover-align-center,
.proposal-doc .cover-block.cover-align-center .cover-brand,
.proposal-doc .cover-block.cover-align-center .cover-title,
.proposal-doc .cover-block.cover-align-center .bp-cover-title,
.proposal-doc .cover-block.cover-align-center .cover-prepared,
.proposal-doc .cover-block.cover-align-center .cover-date {{
  text-align: center;
}}
.proposal-doc .cover-block.cover-align-center .cover-logo,
.proposal-doc .cover-block.cover-align-center img.cover-logo {{
  display: {logo_display};
  margin-left: auto;
  margin-right: auto;
}}
.proposal-doc .cover-block.cover-align-left,
.proposal-doc .cover-block.cover-align-left .cover-brand,
.proposal-doc .cover-block.cover-align-left .cover-title,
.proposal-doc .cover-block.cover-align-left .bp-cover-title,
.proposal-doc .cover-block.cover-align-left .cover-prepared,
.proposal-doc .cover-block.cover-align-left .cover-date {{
  text-align: left;
}}
.proposal-doc .product-tags {{
  list-style: none;
  padding: 0;
  margin: 0 0 var(--gap-tags);
  text-align: {tags_ul_align};
}}
.proposal-doc .product-tags.layout-centered_wrap {{
  text-align: center;
  padding: 0 40pt;
}}
.proposal-doc .product-tags.layout-vertical {{
  text-align: left;
  padding: 0;
}}
.proposal-doc .product-tags.layout-horizontal {{
  text-align: left;
}}
.proposal-doc .product-tags li {{
  display: {tag_li_display};
  margin: 0 4pt 2pt 0;
  color: {tag_color};
  font-size: var(--size-body);
  font-weight: 700;
}}
.proposal-doc .product-tags.layout-vertical li {{
  display: block;
}}
.proposal-doc .product-tags li::before {{
  content: "• ";
  color: {tag_color};
}}
.proposal-doc .cover-block {{
  width: 100%;
  text-align: {cover_align};
  page-break-after: always;
  break-after: page;
}}
.proposal-doc .chrome-header {{
  font-size: 8pt;
  color: var(--c-muted);
  margin: 0 0 12pt;
}}
.proposal-doc .cover-meta {{
  display: table;
  width: {meta_width_css};
  max-width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  margin: 0 0 var(--gap-heading-before) 0;
  font-size: var(--size-body);
}}
.proposal-doc .cover-meta td {{
  border: 1px solid {meta_border};
  padding: 6pt 8pt;
  vertical-align: top;
  text-align: left;
}}
.proposal-doc .cover-meta td:first-child {{
  font-weight: 700;
  width: {float(label_w)}pt;
  white-space: nowrap;
}}
.proposal-doc .cover-meta td:last-child {{
  width: auto;
}}
.proposal-doc h1.sec-h, .proposal-doc .bp-h2 {{
  font-family: var(--font-h);
  font-size: var(--size-h1);
  font-weight: 700;
  line-height: 1.2;
  color: {h1_color};
  text-align: {heading_align};
  margin: var(--gap-heading-before) 0 var(--gap-heading-after);
}}
.proposal-doc .cover-meta + h1.sec-h,
.proposal-doc .product-tags + h1.sec-h {{
  margin-top: 0;
}}
.proposal-doc h2.sec-h2 {{
  font-family: var(--font-h);
  font-size: var(--size-h2);
  font-weight: 700;
  color: {h1_color};
  text-align: {heading_align};
  margin: 12pt 0 6pt;
}}
.proposal-doc p.prose {{
  margin: 0 0 var(--gap-para);
  font-family: var(--font-body);
  text-align: {body_align};
}}
.proposal-doc ul.bullets {{
  margin: 0 0 10pt;
  padding-left: var(--list-indent);
}}
.proposal-doc ul.bullets li {{
  margin: 0 0 4pt;
}}
.proposal-doc table.grid, .proposal-doc .bp-table {{
  display: table;
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  margin: 8pt 0 14pt;
  font-size: var(--size-td);
}}
.proposal-doc table.grid thead, .proposal-doc .bp-table thead {{
  display: table-header-group;
}}
.proposal-doc table.grid tbody, .proposal-doc .bp-table tbody {{
  display: table-row-group;
}}
.proposal-doc table.grid tr, .proposal-doc .bp-table tr {{
  display: table-row;
}}
.proposal-doc table.grid th, .proposal-doc table.grid td,
.proposal-doc .bp-table th, .proposal-doc .bp-table td {{
  display: table-cell;
  border: 1px solid {grid_border};
  padding: 6pt 7pt;
  vertical-align: top;
  text-align: left;
  color: var(--c-text);
}}
.proposal-doc table.grid td, .proposal-doc .bp-table td {{
  background: #ffffff;
}}
.proposal-doc table.grid th, .proposal-doc .bp-table th {{
  font-weight: 700;
  font-size: var(--size-th);
  background: #ffffff;
}}
{header_css}
{zebra_css}
{last_col_css}
{col_css}
.proposal-doc .note {{
  margin: 14pt 0;
}}
.proposal-doc .chrome-footer {{
  margin-top: 22pt;
  padding-top: 8pt;
  border-top: 1px solid var(--c-border);
  color: var(--c-muted);
  font-size: 8pt;
  display: flex;
  justify-content: space-between;
  gap: 12pt;
}}
""".strip()


def parse_pdf_bytes(
    data: bytes,
    *,
    max_screenshots: int = 2,
    max_pages: int = 40,
) -> dict[str, Any]:
    try:
        import fitz
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("pymupdf_missing") from exc

    doc = fitz.open(stream=data, filetype="pdf")
    pages_text: list[str] = []
    spans_all: list[dict[str, Any]] = []
    lines_all: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    screenshots: list[tuple[bytes, str]] = []
    header_candidates: list[str] = []
    footer_candidates: list[str] = []
    images: list[dict[str, Any]] = []
    drawings_pages: list[list[Any]] = []
    page0 = doc[0]
    page_width = page0.rect.width
    page_height = page0.rect.height

    for i, page in enumerate(doc):
        if i >= max_pages:
            break
        pages_text.append(page.get_text("text") or "")
        data_dict = page.get_text("dict")
        top_lines: list[str] = []
        bottom_lines: list[str] = []
        for block in data_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                line_text = "".join(s.get("text", "") for s in line.get("spans", [])).strip()
                bbox = line.get("bbox", [0, 0, 0, 0])
                first = (line.get("spans") or [{}])[0]
                rec = {
                    "page": i,
                    "text": line_text,
                    "bbox": [round(float(x), 1) for x in bbox],
                    "size": round(float(first.get("size", 0)), 1),
                    "font": first.get("font", ""),
                    "bold": "Bold" in str(first.get("font", ""))
                    or bool(first.get("flags", 0) & 16),
                    "color": int_to_hex(first.get("color", 0)),
                }
                lines_all.append(rec)
                if bbox[1] < page.rect.height * 0.08 and line_text:
                    top_lines.append(line_text)
                if bbox[3] > page.rect.height * 0.92 and line_text:
                    bottom_lines.append(line_text)
                for span in line.get("spans", []):
                    text = span.get("text", "").strip()
                    if not text:
                        continue
                    spans_all.append(
                        {
                            "page": i,
                            "text": text,
                            "font": span.get("font", ""),
                            "size": round(float(span.get("size", 0)), 1),
                            "flags": span.get("flags", 0),
                            "color": int_to_hex(span.get("color", 0)),
                            "bbox": [round(float(x), 1) for x in span.get("bbox", [0, 0, 0, 0])],
                            "bold": bool(span.get("flags", 0) & 16)
                            or "Bold" in str(span.get("font", "")),
                        }
                    )
        if top_lines:
            joined = " | ".join(top_lines[:2])
            if usable_running_chrome(joined):
                header_candidates.append(joined)
        if bottom_lines:
            joined = " | ".join(bottom_lines[:2])
            if usable_running_chrome(joined):
                footer_candidates.append(joined)
        try:
            found = page.find_tables()
            for table in found.tables:
                raw = table.extract()
                if not raw:
                    continue
                headers = [str(c or "").strip() for c in raw[0]]
                rows = [[str(c or "").strip() for c in row] for row in raw[1:]]
                tables.append({"page": i + 1, "headers": headers, "rows": rows})
        except Exception:  # noqa: BLE001
            pass
        try:
            drawings_pages.append(page.get_drawings())
        except Exception:  # noqa: BLE001
            drawings_pages.append([])
        if i < max_screenshots:
            try:
                pix = page.get_pixmap(matrix=fitz.Matrix(1.2, 1.2), alpha=False)
                screenshots.append((pix.tobytes("png"), "image/png"))
            except Exception:  # noqa: BLE001
                logger.debug("screenshot failed page %s", i)
        for img_i, img in enumerate(page.get_images(full=True)):
            xref = img[0]
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.n > 4:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                images.append(
                    {
                        "page": i,
                        "xref": xref,
                        "width": pix.width,
                        "height": pix.height,
                        "area": pix.width * pix.height,
                    }
                )
            except Exception:  # noqa: BLE001
                continue

    logo_b64 = ""
    if images:
        page0_imgs = [x for x in images if x["page"] == 0] or images
        best = max(page0_imgs, key=lambda x: x["area"])
        try:
            pix = fitz.Pixmap(doc, best["xref"])
            if pix.n > 4:
                pix = fitz.Pixmap(fitz.csRGB, pix)
            logo_b64 = base64.b64encode(pix.tobytes("png")).decode("ascii")
        except Exception:  # noqa: BLE001
            logo_b64 = ""

    tokens = cluster_theme_tokens(
        spans=spans_all,
        page_width=page_width,
        page_height=page_height,
        header_candidates=header_candidates,
        footer_candidates=footer_candidates,
        lines=lines_all,
    )
    chrome = infer_chrome(drawings_pages, page_width, page_height)
    tokens = apply_chrome_to_tokens(tokens, chrome)
    doc.close()
    full_text = "\n\n".join(
        f"--- page {i + 1} ---\n{t}" for i, t in enumerate(pages_text)
    )
    return {
        "full_text": full_text,
        "page_count": len(pages_text),
        "tables": tables,
        "theme_tokens": tokens,
        "screenshots": screenshots,
        "logo_b64": logo_b64,
        "header_text": tokens.get("header_text") or "",
        "footer_text": tokens.get("footer_text") or "",
        "layout_measured": tokens.get("layout") or {},
    }
