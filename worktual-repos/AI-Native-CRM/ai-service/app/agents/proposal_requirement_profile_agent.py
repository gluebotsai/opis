"""LLM: normalize a new deal requirement into a matchable profile."""

from __future__ import annotations

import logging
from typing import Any

from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

SYSTEM = sectioned_system_prompt(
    role="You normalize a customer requirement for proposal playbook matching.",
    goal=(
        "Extract themes, implied products, industry, constraints, and deal-size band "
        "from requirement text."
    ),
    instructions=(
        "- themes: 3–8 short keywords.\n"
        "- products: product/solution names explicitly discussed in the requirement "
        "(meeting transcript, BRD, or brief) — not every SKU from an uploaded template.\n"
        "- requestedFeatures: capability phrases the customer asked for "
        "(short labels, not paragraphs).\n"
        "- customerName: explicit client/customer company named in the requirement, "
        "or null when absent.\n"
        "- industry: best guess or null.\n"
        "- constraints: must-haves / compliance / timeline notes.\n"
        "- dealSizeBand: small|medium|large|unknown."
    ),
    context="Requirement text and optional deal context are in the user message.",
    output=(
        'Return ONLY JSON: {"themes":["..."],"products":["..."],"requestedFeatures":["..."],'
        '"customerName":null|'
        '"...","industry":null|'
        '"...","constraints":["..."],"dealSizeBand":"unknown","summary":"..."}'
    ),
    guardrails=(
        "Do not invent hard requirements not present in the text. "
        "List only products/solutions the customer or rep actually discussed — "
        "never infer the full vendor catalog from template examples."
    ),
)


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    requirement = str(body.get("requirementText") or body.get("text") or "").strip()
    deal_title = str(body.get("dealTitle") or "")
    company_name = str(body.get("companyName") or "")
    industry = str(body.get("companyIndustry") or "")

    fallback = {
        "themes": [t for t in requirement.lower().split() if len(t) > 4][:6],
        "products": [],
        "requestedFeatures": [],
        "customerName": None,
        "industry": industry or None,
        "constraints": [],
        "dealSizeBand": "unknown",
        "summary": requirement[:400] or deal_title[:200],
        "source": "heuristic",
    }

    if len(requirement) < 8 and not deal_title:
        return {
            "ok": False,
            "status": "failed",
            "reason": "requirement_too_short",
            "profile": fallback,
        }

    if not is_ai_configured():
        return {
            "ok": True,
            "status": "ok",
            "profile": fallback,
            "source": "heuristic",
            "reason": "llm_not_configured",
        }

    user = (
        f"Deal title: {deal_title or '(none)'}\n"
        f"Company: {company_name or '(none)'}\n"
        f"Industry hint: {industry or '(none)'}\n\n"
        f"Requirement:\n{requirement[:12_000]}"
    )
    try:
        text = await generate_ai_text(
            system=SYSTEM,
            user=user,
            max_tokens=1500,
            timeout_ms=60_000,
        )
        payload = extract_json(text or "") or {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("proposal-requirement-profile LLM failed")
        return {
            "ok": True,
            "status": "ok",
            "profile": fallback,
            "source": "heuristic",
            "reason": f"llm_error:{exc}",
        }

    themes = payload.get("themes") if isinstance(payload.get("themes"), list) else []
    products = payload.get("products") if isinstance(payload.get("products"), list) else []
    requested = (
        payload.get("requestedFeatures")
        if isinstance(payload.get("requestedFeatures"), list)
        else []
    )
    constraints = (
        payload.get("constraints") if isinstance(payload.get("constraints"), list) else []
    )
    profile = {
        "themes": [str(t)[:80] for t in themes[:12]],
        "products": [str(p)[:80] for p in products[:8]],
        "requestedFeatures": [str(f)[:120] for f in requested[:24]],
        "customerName": (
            str(payload.get("customerName")).strip()[:160]
            if payload.get("customerName")
            else None
        ),
        "industry": (
            str(payload.get("industry")).strip()
            if payload.get("industry")
            else (industry or None)
        ),
        "constraints": [str(c)[:200] for c in constraints[:10]],
        "dealSizeBand": str(payload.get("dealSizeBand") or "unknown")[:20],
        "summary": str(payload.get("summary") or requirement[:400])[:600],
        "source": "ai",
    }
    return {"ok": True, "status": "ok", "profile": profile, "source": "ai"}
