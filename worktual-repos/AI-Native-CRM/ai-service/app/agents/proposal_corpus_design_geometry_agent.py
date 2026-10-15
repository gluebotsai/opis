"""Gemini: extract complete reusable CSS + HTML skeleton from proposal pageHtml."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.llm import (
    generate_proposal_ai_text as generate_ai_text,
    is_ai_configured,
    llm_design_source_tag,
    proposal_llm_source_tag as llm_source_tag,
)

logger = logging.getLogger(__name__)

SYSTEM = sectioned_system_prompt(
    role=(
        "You are a document design analyst for B2B sales proposals. "
        "You read positioned PDF page HTML and page text to reconstruct a "
        "reusable empty HTML+CSS template of the winning proposal."
    ),
    goal=(
        "Return layoutStyle plus COMPLETE CSS and a real empty HTML skeleton. "
        "CRM later fills slots and tables for a new deal. Compact 5-rule CSS "
        "or empty html is a failure. Do not copy customer names, prices, or logos."
    ),
    instructions=(
        "- Reconstruct CSS from actual span styles — not generic navy defaults. "
        "Every rule must include evidenced font-size, font-weight, and padding.\n"
        "- CSS MUST include .bp-cover-title (cover title size), .bp-h2 or h2 "
        "(heading weight), and .bp-table th (header chrome), plus padding.\n"
        "- CSS must target .proposal-blueprint and "
        "(.bp-playbook-cover, .bp-cover-brand, .bp-cover-title, .bp-h2, "
        ".bp-body, .bp-table, .bp-table th, .bp-table td, .bp-section, "
        ".bp-footer).\n"
        "- HTML MUST be an empty skeleton: <header class=\"bp-playbook-cover\"> "
        "with {{vendorName}}, .bp-cover-title, prepared-for/date tokens; "
        "<section data-slot=\"...\"> with empty .bp-body; empty <table> shells "
        "with thead + empty tbody for comparison/commercial pages.\n"
        "- Infer coverStyle from the cover page only (banner|centered|left).\n"
        "- Record cover.slots in visual order as evidenced "
        "(vendorName, documentTitle, preparedFor, date, productScope).\n"
        "- cover.title is the literal document title on the cover. Do not invent one.\n"
        "- cover.preparedForLabel is the literal lead-in before the customer name "
        "if present (otherwise omit).\n"
        "- cover.footer may include {{vendorName}} as a placeholder.\n"
        "- Infer table chrome only from colors visible on the PDF: header background, "
        "borders, cell padding, column width %. Do not invent #1f3864, #0f2942, "
        "#0b3d4a, or #1d4ed8. Leave the header unfilled when the PDF header is not a solid color.\n"
        "- Use geometryHint facts (fonts, colors, cover textOrder, tables) when "
        "HTML evidence is thin, but prefer HTML spans.\n"
        "- Redact customer names and price cells from the skeleton."
    ),
    context="Page HTML, page text, and structured geometryHint facts are provided.",
    output=(
        'Return ONLY JSON: {"layoutStyle":{'
        '"fontFamily":"Arial, Helvetica, sans-serif",'
        '"headingFontFamily":"Arial, Helvetica, sans-serif",'
        '"baseFontSizePx":11,"headingFontSizePx":14,"coverTitleSizePx":24,'
        '"bodyLineHeight":1.45,"headingLineHeight":1.25,"letterSpacing":"0",'
        '"headingColor":"#1a1a1a","accentColor":"#1a1a1a","textColor":"#1a1a1a",'
        '"backgroundColor":"#ffffff","headerBandColor":"transparent",'
        '"textAlign":"left","headingAlign":"left",'
        '"coverStyle":"banner|centered|left","headingRule":"none|underline",'
        '"sectionSpacing":"compact|comfortable|airy",'
        '"margins":{"top":"16mm","right":"18mm","bottom":"16mm","left":"18mm"},'
        '"tableStyle":{"headerBackground":"#ffffff","headerColor":"#000000",'
        '"borderColor":"#808080","stripedRows":false,"cellAlign":"left",'
        '"cellPadding":"6px 8px","borderCollapse":"collapse",'
        '"colWidths":["28%","36%","36%"],"firstColIsLabel":true,'
        '"headerRowHeight":"28px"},'
        '"cover":{"archetype":"centered","title":"","preparedForLabel":"",'
        '"slots":["vendorName","documentTitle","preparedFor","date","productScope"],'
        '"productScopeStyle":"line","footer":""},'
        '"emphasis":{"requestedLabel":"","recommendedLabel":"",'
        '"requestedColor":"","recommendedColor":""},'
        '"pageArchetypes":{"cover":"...","body":"...","commercials":"..."},'
        '"source":"gemini_design","confidence":0.0},'
        '"css":".proposal-blueprint .bp-cover-title{font-size:24px;font-weight:700} ...",'
        '"html":"<div class=\\"bp-playbook-root\\"><header class=\\"bp-playbook-cover\\">...</header>'
        '<section data-slot=\\"scope\\">...</section></div>"}'
    ),
    guardrails=(
        "Do not copy long customer paragraphs. Do not invent prices. "
        "html must be empty skeleton with tokens, never filled prose. "
        "Never copy source=geometry_hint_fallback from a prior payload."
    ),
)

BODY_SYSTEM = sectioned_system_prompt(
    role="You reconstruct empty proposal section shells from remaining PDF pages.",
    goal=(
        "Return additional empty <section data-slot> HTML (and table shells) "
        "that match these pages. Do not duplicate the cover."
    ),
    instructions=(
        "- Emit only new <section data-slot=\"snake_key\"> blocks with empty bodies.\n"
        "- Comparison / commercials / charges pages MUST include "
        "<table class=\"bp-table\" data-slot-table=\"key\"><thead>...</thead>"
        "<tbody></tbody></table>.\n"
        "- No customer names, prices, or <script>.\n"
        "- Optional css string if these pages reveal extra table chrome."
    ),
    context="Remaining page HTML/text and geometryHint tables facts.",
    output='Return ONLY JSON: {"html":"<section data-slot=\\"...\">...</section>","css":""}',
    guardrails="Empty skeleton only. Never copy historical prices or customer names.",
)

_DESIGN_MAX_TOKENS = 4000
_DESIGN_CALL_TIMEOUT_MS = 90_000
_MAX_BODY_PAGES = 4


_BLOCKED_SOURCES = {
    "",
    "heuristic",
    "pdf_geometry",
    "geometry_hint_fallback",
    "pdf_geometry_hint",
    "failed",
}


_TABLE_STANDIN = {"#1f3864", "#0b3d4a", "#0f2942", "#1d4ed8"}


def _css_color_or(value: Any, fallback: str) -> str:
    raw = str(value or "").strip()
    if not raw or raw.lower() in _TABLE_STANDIN:
        return fallback
    return raw


def _css_from_layout(layout: dict[str, Any]) -> str:
    font = str(layout.get("fontFamily") or "Arial, Helvetica, sans-serif")
    heading_font = str(layout.get("headingFontFamily") or font)
    size = layout.get("baseFontSizePx") or 11
    heading_size = layout.get("headingFontSizePx") or 14
    heading = _css_color_or(layout.get("headingColor"), "#1a1a1a")
    accent = _css_color_or(layout.get("accentColor"), heading)
    text = _css_color_or(layout.get("textColor"), "#1a1a1a")
    table = layout.get("tableStyle") if isinstance(layout.get("tableStyle"), dict) else {}
    cell_pad = str(table.get("cellPadding") or "6px 8px")
    header_bg = _css_color_or(table.get("headerBackground"), "transparent")
    header_fg = _css_color_or(table.get("headerColor"), "#1a1a1a")
    border = str(table.get("borderColor") or "#808080")
    margins = layout.get("margins") if isinstance(layout.get("margins"), dict) else {}
    pad = str(margins.get("top") or "16mm")
    return (
        f".proposal-blueprint{{font-family:{font};font-size:{size}px;"
        f"color:{text};padding:{pad};margin:0 auto;line-height:1.45}}"
        f".proposal-blueprint .bp-h2{{font-family:{heading_font};font-size:{heading_size}px;"
        f"color:{heading};margin:12px 0 8px;padding:0}}"
        f".proposal-blueprint .bp-table th{{background:{header_bg};color:{header_fg};"
        f"padding:{cell_pad};border:1px solid {border}}}"
        f".proposal-blueprint .bp-table td{{padding:{cell_pad};border:1px solid {border};"
        f"color:{text}}}"
        f".proposal-blueprint .bp-section{{margin:12px 0;padding:0}}"
        f".proposal-blueprint .bp-playbook-cover{{color:{accent};padding:12px 0}}"
    )


def _balanced_object(text: str, start: int) -> str | None:
    if start < 0 or start >= len(text) or text[start] != "{":
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if escape:
            escape = False
            continue
        if ch == "\\" and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def extract_design_payload(text: str) -> dict[str, Any]:
    """Parse design JSON, recovering layoutStyle if css/html truncated."""
    payload = extract_json(text) or {}
    if _layout_from_payload(payload):
        return payload

    raw = str(text or "")
    marker = raw.find('"layoutStyle"')
    if marker >= 0:
        brace = raw.find("{", marker)
        blob = _balanced_object(raw, brace)
        if blob:
            try:
                layout = json.loads(blob)
                if isinstance(layout, dict) and layout:
                    return {"layoutStyle": layout}
            except json.JSONDecodeError:
                pass

    start = raw.find("{")
    if start >= 0:
        repaired = raw[start:]
        if repaired.count('"') % 2 == 1:
            repaired += '"'
        repaired += "}" * max(0, repaired.count("{") - repaired.count("}"))
        try:
            data = json.loads(repaired)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
    return payload


def css_looks_complete(css: str | None) -> bool:
    s = str(css or "").lower()
    if len(s) < 200:
        return False
    if "font-size" not in s:
        return False
    if "padding" not in s:
        return False
    if "font-weight" not in s:
        return False
    has_cover_title = ".bp-cover-title" in s or "bp-cover-title" in s
    has_h2 = ".bp-h2" in s or "h2{" in s or " h2 " in s
    has_th = ".bp-table th" in s or "th{" in s
    return has_cover_title and has_h2 and has_th


def html_looks_like_skeleton(html: str | None) -> bool:
    s = str(html or "")
    if len(s) < 40:
        return False
    if "<script" in s.lower():
        return False
    has_cover = "bp-playbook-cover" in s
    has_slot = "data-slot=" in s
    return has_cover and has_slot


def _default_layout(geometry_hint: dict[str, Any] | None) -> dict[str, Any]:
    hint = geometry_hint if isinstance(geometry_hint, dict) else {}
    heading = str(hint.get("observedHeadingColor") or "#1a1a1a")
    accent = str(hint.get("observedAccentColor") or heading)
    left = hint.get("observedLeftPct")
    side_mm = "18mm"
    try:
        if left is not None:
            side_mm = f"{max(12, min(28, round(float(left) * 2.1)))}mm"
    except (TypeError, ValueError):
        pass
    return {
        "fontFamily": "Arial, 'Helvetica Neue', Helvetica, sans-serif",
        "headingFontFamily": "Arial, 'Helvetica Neue', Helvetica, sans-serif",
        "baseFontSizePx": 11,
        "headingFontSizePx": 14,
        "coverTitleSizePx": 18,
        "bodyLineHeight": 1.45,
        "headingLineHeight": 1.25,
        "letterSpacing": "0",
        "headingColor": heading,
        "accentColor": accent,
        "textColor": "#000000",
        "backgroundColor": "#ffffff",
        "headerBandColor": heading,
        "textAlign": "left",
        "headingAlign": "left",
        "coverStyle": "left",
        "headingRule": "none",
        "sectionSpacing": "compact",
        "margins": {
            "top": "16mm",
            "right": side_mm,
            "bottom": "16mm",
            "left": side_mm,
        },
        "tableStyle": {
            "headerBackground": "#ffffff",
            "headerColor": "#000000",
            "borderColor": "#808080",
            "stripedRows": False,
            "cellAlign": "left",
            "cellPadding": "6px 8px",
            "borderCollapse": "collapse",
            "firstColIsLabel": False,
        },
        "pageArchetypes": {
            "cover": "left-aligned title block",
            "body": "single column body text",
            "commercials": "bordered tables",
        },
        "source": "geometry_hint_fallback",
        "confidence": 0.25,
    }


def _page_blob_all(pages: list[dict[str, Any]], *, html_limit: int = 12_000) -> str:
    chunks: list[str] = []
    for p in pages:
        if not isinstance(p, dict):
            continue
        n = p.get("n")
        text = str(p.get("text") or "")[:1_200]
        html = str(p.get("pageHtml") or "")[:html_limit]
        chunks.append(f"--- Page {n} TEXT ---\n{text}\n--- Page {n} HTML ---\n{html}")
    return "\n\n".join(chunks)


def _is_near_black(color: str | None) -> bool:
    s = str(color or "").strip().lower()
    return s in {"", "#000", "#000000", "#111111", "#1a1a1a", "#222222"}


def _reconcile_layout_with_hint(
    layout: dict[str, Any],
    geometry_hint: dict[str, Any] | None,
) -> dict[str, Any]:
    """Keep LLM structure, but restore PDF-observed brand colors when the model collapses to black."""
    out = dict(layout)
    hint = geometry_hint if isinstance(geometry_hint, dict) else {}
    observed_heading = str(hint.get("observedHeadingColor") or "").strip()
    observed_accent = str(hint.get("observedAccentColor") or "").strip()

    if observed_heading and _is_near_black(str(out.get("headingColor") or "")):
        out["headingColor"] = observed_heading
    if observed_accent and (
        _is_near_black(str(out.get("accentColor") or ""))
        or str(out.get("accentColor") or "").lower()
        == str(out.get("headingColor") or "").lower()
    ):
        out["accentColor"] = observed_accent
    if observed_heading and _is_near_black(str(out.get("headerBandColor") or "")):
        out["headerBandColor"] = observed_heading

    if not str(out.get("coverStyle") or "").strip():
        out["coverStyle"] = "left"

    source = str(out.get("source") or "").strip().lower()
    if source in _BLOCKED_SOURCES or source.startswith("geometry_hint_fallback"):
        out["source"] = llm_design_source_tag()
    else:
        out["source"] = str(out.get("source") or llm_design_source_tag())
    if "hint" not in out["source"]:
        out["source"] = f"{out['source']}+hint"
    return out


def _layout_from_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
    nested = payload.get("layoutStyle")
    if isinstance(nested, dict) and nested:
        return nested
    if isinstance(payload.get("fontFamily"), str) and payload.get("headingColor"):
        return payload
    return None


def _sanitize_template_html(html: str) -> str:
    raw = str(html or "").strip()
    if not raw:
        return ""
    lowered = raw.lower()
    if "<script" in lowered or "javascript:" in lowered:
        return ""
    # Drop obvious price-looking table cells from the empty skeleton.
    raw = re.sub(r"(?i)<td[^>]*>\s*[$€£]\s*[\d,.]+\s*</td>", "<td></td>", raw)
    return raw[:80_000]


def _css_from_payload(payload: dict[str, Any], layout: dict[str, Any]) -> str:
    css = payload.get("css")
    if not isinstance(css, str) or not css.strip():
        css = layout.get("css") if isinstance(layout.get("css"), str) else ""
    return str(css or "").strip()[:80_000]


def _html_from_payload(payload: dict[str, Any], layout: dict[str, Any]) -> str:
    html = payload.get("html")
    if not isinstance(html, str) or not html.strip():
        html = layout.get("html") if isinstance(layout.get("html"), str) else ""
    return _sanitize_template_html(str(html or ""))


def _ensure_root(html: str) -> str:
    raw = str(html or "").strip()
    if not raw:
        return ""
    if "bp-playbook-root" in raw:
        return raw
    return f'<div class="bp-playbook-root">{raw}</div>'


def _merge_skeleton_html(base: str, fragment: str) -> str:
    frag = _sanitize_template_html(fragment)
    if not frag:
        return _ensure_root(base)
    if not base:
        return _ensure_root(frag)
    out = _ensure_root(base)
    for match in re.finditer(
        r'<section\b[^>]*data-slot="([^"]+)"[^>]*>[\s\S]*?</section>',
        frag,
        flags=re.I,
    ):
        key = match.group(1)
        if re.search(rf'data-slot="{re.escape(key)}"', out, flags=re.I):
            continue
        block = match.group(0)
        close = out.rfind("</div>")
        if close >= 0:
            out = out[:close] + block + "\n" + out[close:]
        else:
            out += "\n" + block
    return out


def _merge_css(base: str, extra: str) -> str:
    a = str(base or "").strip()
    b = str(extra or "").strip()
    if not b:
        return a
    if not a:
        return b
    if b in a:
        return a
    if css_looks_complete(b) and not css_looks_complete(a):
        return b
    return f"{a}\n{b}"[:80_000]


async def _design_call(
    *,
    system: str,
    user: str,
    max_tokens: int = _DESIGN_MAX_TOKENS,
) -> dict[str, Any]:
    text = await generate_ai_text(
        system=system,
        user=user,
        max_tokens=max_tokens,
        timeout_ms=_DESIGN_CALL_TIMEOUT_MS,
    )
    return extract_design_payload(text or "")


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    item_id = str(body.get("itemId") or "")
    pages = body.get("pages") if isinstance(body.get("pages"), list) else []
    geometry_hint = (
        body.get("geometryHint")
        if isinstance(body.get("geometryHint"), dict)
        else (
            body.get("geometry")
            if isinstance(body.get("geometry"), dict)
            else (
                body.get("layoutStyle")
                if isinstance(body.get("layoutStyle"), dict)
                else None
            )
        )
    )
    prior = (
        body.get("priorLayoutStyle")
        if isinstance(body.get("priorLayoutStyle"), dict)
        else None
    )
    critique = str(body.get("critiqueNotes") or "").strip()
    prior_css = str(body.get("priorCss") or "").strip()
    prior_html = str(body.get("priorHtml") or "").strip()

    fallback = prior or _default_layout(geometry_hint)

    if not pages:
        return {
            "ok": False,
            "status": "failed",
            "reason": "empty_pages",
            "itemId": item_id,
            "layoutStyle": fallback,
            "css": prior_css,
            "html": prior_html,
            "source": "failed",
        }

    if not is_ai_configured():
        return {
            "ok": False,
            "status": "failed",
            "reason": "llm_not_configured",
            "itemId": item_id,
            "layoutStyle": fallback,
            "css": prior_css,
            "html": prior_html,
            "source": "failed",
        }

    valid_pages = [p for p in pages if isinstance(p, dict)]
    cover_pages = valid_pages[:1]
    body_pages = valid_pages[1 : 1 + _MAX_BODY_PAGES]
    geometry_blob = json.dumps(geometry_hint or {}, ensure_ascii=False)[:6_000]

    cover_user = (
        f"Item id: {item_id}\n"
        f"Geometry facts (deterministic, not a style recipe):\n{geometry_blob}\n"
        f"Prior layoutStyle (if repairing): {json.dumps(prior or {}, ensure_ascii=False)[:3000]}\n"
        f"Prior css complete: {css_looks_complete(prior_css)}; "
        f"prior html skeleton: {html_looks_like_skeleton(prior_html)}\n"
        f"Critique notes: {critique or '(none)'}\n\n"
        "Reconstruct the COVER as JSON {layoutStyle, css, html}. html must include "
        "bp-playbook-cover and at least one data-slot section shell. css must include "
        ".bp-cover-title, .bp-h2, .bp-table th, font-weight, and padding.\n\n"
        f"{_page_blob_all(cover_pages, html_limit=8_000)}"
    )

    payload: dict[str, Any] = {}
    layout: dict[str, Any] | None = None
    css = prior_css
    html = prior_html
    try:
        payload = await _design_call(system=SYSTEM, user=cover_user)
        layout = _layout_from_payload(payload)
        css = _merge_css(css, _css_from_payload(payload, layout or {}))
        html = _merge_skeleton_html(html, _html_from_payload(payload, layout or {}))
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-corpus-design-geometry cover call failed")
        return {
            "ok": False,
            "status": "failed",
            "reason": f"llm_error:{exc}",
            "itemId": item_id,
            "layoutStyle": fallback,
            "css": prior_css,
            "html": prior_html,
            "source": "failed",
        }

    if not layout:
        try:
            retry_payload = await _design_call(
                system=SYSTEM,
                user=(
                    f"Item id: {item_id}\n"
                    f"Geometry facts:\n{geometry_blob[:4000]}\n"
                    f"{_page_blob_all(cover_pages, html_limit=6_000)}\n\n"
                    "Return ONLY JSON {\"layoutStyle\":{...},\"css\":\"...\",\"html\":\"...\"} "
                    "with bp-playbook-cover, data-slot, .bp-cover-title, .bp-table th."
                ),
                max_tokens=_DESIGN_MAX_TOKENS,
            )
            layout = _layout_from_payload(retry_payload)
            if retry_payload:
                payload = retry_payload
                css = _merge_css(css, _css_from_payload(retry_payload, layout or {}))
                html = _merge_skeleton_html(
                    html, _html_from_payload(retry_payload, layout or {})
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-corpus-design-geometry cover retry failed: %s", exc)
        if not layout:
            return {
                "ok": False,
                "status": "failed",
                "reason": "bad_json_after_retry",
                "itemId": item_id,
                "layoutStyle": fallback,
                "css": prior_css,
                "html": prior_html,
                "source": "failed",
            }

    if body_pages:
        existing_slots = re.findall(r'data-slot="([^"]+)"', html)[:20]
        body_user = (
            f"Item id: {item_id}\n"
            f"Existing skeleton slots: {existing_slots}\n"
            f"Geometry tables: {json.dumps((geometry_hint or {}).get('tables') or {}, ensure_ascii=False)[:1500]}\n"
            f"{_page_blob_all(body_pages, html_limit=5_000)}\n\n"
            "Return additional empty <section data-slot> HTML for these pages in one JSON. "
            "Do not repeat existing slots. Empty tbody for tables."
        )
        try:
            body_payload = await _design_call(
                system=BODY_SYSTEM,
                user=body_user,
                max_tokens=_DESIGN_MAX_TOKENS,
            )
            html = _merge_skeleton_html(
                html, _html_from_payload(body_payload, {})
            )
            css = _merge_css(css, _css_from_payload(body_payload, {}))
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-corpus-design-geometry body call failed: %s", exc)

    if not layout:
        return {
            "ok": False,
            "status": "failed",
            "reason": "bad_json_after_retry",
            "itemId": item_id,
            "layoutStyle": fallback,
            "css": prior_css,
            "html": prior_html,
            "source": "failed",
        }

    layout = dict(layout)
    layout = _reconcile_layout_with_hint(layout, geometry_hint)
    layout["source"] = str(layout.get("source") or llm_design_source_tag())
    if str(layout.get("source") or "").strip().lower() in _BLOCKED_SOURCES:
        layout["source"] = f"{llm_design_source_tag()}+hint"
    try:
        confidence = float(
            layout.get("confidence") if layout.get("confidence") is not None else 0.7
        )
    except (TypeError, ValueError):
        confidence = 0.7
    layout["confidence"] = max(0.0, min(1.0, confidence))
    html = _ensure_root(_sanitize_template_html(html))

    if not html_looks_like_skeleton(html) or not css_looks_complete(css):
        return {
            "ok": False,
            "status": "failed",
            "reason": "skeleton_or_css_incomplete",
            "itemId": item_id,
            "layoutStyle": layout,
            "css": css,
            "html": html,
            "source": "failed",
        }

    layout["cssComplete"] = True
    return {
        "ok": True,
        "status": "ok",
        "itemId": item_id,
        "layoutStyle": layout,
        "css": css,
        "html": html,
        "rationale": str(payload.get("rationale") or "")[:500],
        "source": llm_source_tag(),
    }
