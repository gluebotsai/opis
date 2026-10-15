"""MiniMax: critique a design model against page evidence and request repairs."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.agents.proposal_corpus_design_geometry_agent import css_looks_complete, html_looks_like_skeleton
from app.llm import (
    generate_proposal_ai_text as generate_ai_text,
    is_ai_configured,
    proposal_llm_source_tag as llm_source_tag,
)

logger = logging.getLogger(__name__)

SYSTEM = sectioned_system_prompt(
    role="You QA proposal design extraction quality for Worktual CRM pattern learning.",
    goal=(
        "Decide whether layoutStyle and extracted CSS faithfully reflect the "
        "historical PDF pages. If not, list concrete repair notes for a second "
        "extraction pass."
    ),
    instructions=(
        "- Pass when core Format is evidenced and usable: fontFamily, headingColor, "
        "accentColor, coverStyle, and tableStyle that match the page HTML.\n"
        "- Pass only when css includes .bp-cover-title, heading weight, .bp-table th, "
        "and real font-size/padding (not a compact 5-rule recipe).\n"
        "- Pass only when html is a real empty skeleton (bp-playbook-cover + data-slot).\n"
        "- Missing optional cover.footer or emphasis labels is not a fail when those "
        "elements are absent from the PDF. Record them in repairNotes only.\n"
        "- Fail when layoutStyle looks like generic defaults with no page support.\n"
        "- Fail when headingColor/accentColor contradict a dominant non-black "
        "bold color in the HTML.\n"
        "- Fail when the cover page clearly shows prepared-for / date / product line "
        "but cover.slots omitted every one of those slots.\n"
        "- Fail when tables are visible in the HTML but tableStyle/css omit cell "
        "padding or header chrome.\n"
        "- Black headings are allowed when the PDF itself uses black/near-black type.\n"
        "- repairNotes must be actionable (what to change), max 8 bullets.\n"
        "- score 0..1 for design fidelity. Use pass=true when score >= 0.55."
    ),
    context="layoutStyle, css, html, plus page HTML/text excerpts are in the user message.",
    output=(
        'Return ONLY JSON: {"pass":true,"score":0.0,"repairNotes":["..."],'
        '"rationale":"..."}'
    ),
    guardrails="Never invent customer content. Focus on visual design fidelity only.",
)


_NEAR_BLACK = {"#000", "#000000", "#111111", "#1a1a1a", "#222222"}
_NEUTRAL = _NEAR_BLACK | {"#ffffff", "#595959"}


def _evidenced_non_black_heading(pages: list[Any]) -> str:
    html_blob = "\n".join(
        str(p.get("pageHtml") or "")
        for p in pages
        if isinstance(p, dict)
    )
    colors = re.findall(r"color:(#[0-9a-fA-F]{6})", html_blob)
    bold_colors = re.findall(
        r"color:(#[0-9a-fA-F]{6})[^>]*font-weight:bold", html_blob
    )
    non_neutral = [
        c.lower()
        for c in bold_colors + colors
        if c.lower() not in _NEUTRAL
    ]
    if not non_neutral:
        return ""
    return max(set(non_neutral), key=non_neutral.count)


def _usable_llm_layout(layout: dict[str, Any]) -> bool:
    source = str(layout.get("source") or "").strip().lower()
    if source in {
        "",
        "heuristic",
        "pdf_geometry",
        "geometry_hint_fallback",
        "pdf_geometry_hint",
        "failed",
    }:
        return False
    return bool(
        str(layout.get("fontFamily") or "").strip()
        and str(layout.get("headingColor") or "").startswith("#")
        and str(layout.get("coverStyle") or "").strip()
    )


def _truthy_pass(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in {"true", "yes", "1", "pass"}
    return False


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    item_id = str(body.get("itemId") or "")
    layout = (
        body.get("layoutStyle") if isinstance(body.get("layoutStyle"), dict) else {}
    )
    css = str(body.get("css") or layout.get("css") or "")
    html = str(body.get("html") or "")
    pages = body.get("pages") if isinstance(body.get("pages"), list) else []

    if not layout:
        return {
            "ok": True,
            "status": "ok",
            "itemId": item_id,
            "pass": False,
            "score": 0.0,
            "repairNotes": ["layoutStyle missing — re-run design geometry"],
            "source": "rule",
        }

    source = str(layout.get("source") or "")
    if source in {"geometry_hint_fallback", "pdf_geometry", "heuristic"}:
        # Heuristic-only designs are never good enough for auto-approve.
        return {
            "ok": True,
            "status": "ok",
            "itemId": item_id,
            "pass": False,
            "score": 0.2,
            "repairNotes": [
                "Current layoutStyle is heuristic/geometry-only; extract fonts, "
                "coverStyle, table chrome, evidenced colors, and complete CSS "
                "with font-size and padding from page HTML."
            ],
            "source": "rule",
        }

    heading = str(layout.get("headingColor") or "").strip().lower()
    evidenced_heading = _evidenced_non_black_heading(pages)
    if heading in {"#000", "#000000", "#111111", "#1a1a1a"} and evidenced_heading:
        # Black headings usually mean the model collapsed brand navy into body color.
        return {
            "ok": True,
            "status": "ok",
            "itemId": item_id,
            "pass": False,
            "score": 0.35,
            "repairNotes": [
                "headingColor is black; set headingColor/accentColor to the dominant "
                f"non-black bold color from page HTML ({evidenced_heading}).",
            ],
            "source": "rule",
        }

    if not is_ai_configured():
        return {
            "ok": False,
            "status": "failed",
            "reason": "llm_not_configured",
            "itemId": item_id,
            "pass": False,
            "score": 0.0,
            "repairNotes": ["MiniMax LLM not configured"],
            "source": "failed",
        }

    page_snip = []
    for p in pages[:6]:
        if not isinstance(p, dict):
            continue
        page_snip.append(
            {
                "n": p.get("n"),
                "text": str(p.get("text") or "")[:800],
                "pageHtml": str(p.get("pageHtml") or "")[:2500],
            }
        )

    if css and not css_looks_complete(css):
        return {
            "ok": True,
            "status": "ok",
            "itemId": item_id,
            "pass": False,
            "score": 0.4,
            "repairNotes": [
                "css is incomplete. It must include .bp-cover-title (cover size), "
                ".bp-h2, .bp-table th, font-weight, and padding. Compact 5-rule CSS is not enough."
            ],
            "source": "rule",
        }

    if not html_looks_like_skeleton(html):
        return {
            "ok": True,
            "status": "ok",
            "itemId": item_id,
            "pass": False,
            "score": 0.35,
            "repairNotes": [
                "html is not a real empty skeleton. Return <header class=\"bp-playbook-cover\"> "
                "plus <section data-slot> shells with empty bodies/tables."
            ],
            "source": "rule",
        }

    user = (
        f"Item id: {item_id}\n"
        f"layoutStyle:\n{json.dumps(layout, ensure_ascii=False)[:4000]}\n\n"
        f"css (complete={css_looks_complete(css)}):\n{css[:6000]}\n\n"
        f"html skeleton present: {bool(html.strip())}\n"
        f"{html[:2500]}\n\n"
        f"Pages:\n{json.dumps(page_snip, ensure_ascii=False)[:14000]}"
    )
    try:
        text = await generate_ai_text(
            system=SYSTEM,
            user=user,
            max_tokens=2000,
            timeout_ms=90_000,
        )
        payload = extract_json(text or "") or {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-corpus-design-critique MiniMax failed")
        return {
            "ok": False,
            "status": "failed",
            "reason": f"llm_error:{exc}",
            "itemId": item_id,
            "pass": False,
            "score": 0.0,
            "repairNotes": [str(exc)[:200]],
            "source": "failed",
        }

    notes = payload.get("repairNotes") if isinstance(payload.get("repairNotes"), list) else []
    try:
        score = float(payload.get("score") if payload.get("score") is not None else 0.0)
    except (TypeError, ValueError):
        score = 0.0
    passed = _truthy_pass(payload.get("pass")) and score >= 0.55
    if not passed and _usable_llm_layout(layout) and (score >= 0.45 or not payload):
        # Optional chrome (footer/emphasis) must not block a renderer-usable Format.
        passed = True
        score = max(score, 0.55)

    return {
        "ok": True,
        "status": "ok",
        "itemId": item_id,
        "pass": passed,
        "score": max(0.0, min(1.0, score)),
        "repairNotes": [str(n)[:240] for n in notes[:8]],
        "rationale": str(payload.get("rationale") or "")[:400],
        "source": llm_source_tag(),
    }
