"""Rule-gate a synthesized playbook before auto-approval."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.proposal_corpus_design_geometry_agent import (
    css_looks_complete,
    html_looks_like_skeleton,
)

logger = logging.getLogger(__name__)


def _rule_gate(playbook: dict[str, Any]) -> tuple[bool, float, list[str]]:
    reasons: list[str] = []
    sections = playbook.get("sections") if isinstance(playbook.get("sections"), list) else []
    if len(sections) < 3:
        reasons.append("Fewer than 3 sections")
    patterned = 0
    generic = 0
    for s in sections:
        if not isinstance(s, dict):
            continue
        title = str(s.get("title") or "")
        key = str(s.get("key") or "")
        pattern = str(s.get("contentPattern") or "").strip()
        if title.lower().startswith("page ") or key.startswith("section_"):
            generic += 1
        if len(pattern) >= 40:
            patterned += 1
    needed = max(2, (len(sections) + 1) // 2) if sections else 2
    if sections and patterned < needed:
        reasons.append("Fewer than half of sections have actionable contentPattern")
    if sections and generic >= max(2, (len(sections) + 1) // 2):
        reasons.append("Too many generic section titles")

    layout = playbook.get("format") if isinstance(playbook.get("format"), dict) else {}
    if not layout:
        layout = playbook.get("layoutStyle") if isinstance(playbook.get("layoutStyle"), dict) else {}
    source = str(layout.get("source") or "")
    if not layout:
        reasons.append("Missing layoutStyle")
    elif source in {"", "heuristic", "pdf_geometry", "geometry_hint_fallback", "pdf_geometry_hint"}:
        reasons.append(f"layoutStyle source not LLM-quality ({source or 'empty'})")
    if not str(layout.get("headingColor") or "").startswith("#"):
        reasons.append("layoutStyle.headingColor missing")

    blueprint = playbook.get("blueprint") if isinstance(playbook.get("blueprint"), dict) else {}
    html = str(blueprint.get("html") or "")
    css = str(blueprint.get("css") or "")
    if not html_looks_like_skeleton(html):
        reasons.append("Missing HTML skeleton (bp-playbook-cover + data-slot)")
    if not css_looks_complete(css):
        reasons.append(
            "CSS incomplete (need .bp-cover-title, heading weight, .bp-table th)"
        )

    score = 1.0 - min(0.85, 0.12 * len(reasons))
    return (len(reasons) == 0, score, reasons)


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    playbook = body.get("playbook") if isinstance(body.get("playbook"), dict) else {}
    if not playbook:
        return {
            "ok": True,
            "status": "ok",
            "pass": False,
            "score": 0.0,
            "reasons": ["playbook missing"],
            "source": "rule",
        }

    rule_pass, rule_score, rule_reasons = _rule_gate(playbook)
    if not rule_pass:
        return {
            "ok": True,
            "status": "ok",
            "pass": False,
            "score": rule_score,
            "reasons": rule_reasons[:12],
            "source": "rule",
        }

    return {
        "ok": True,
        "status": "ok",
        "pass": True,
        "score": max(rule_score, 0.7),
        "reasons": ["rule_gate"],
        "source": "rule",
    }
