"""LLM: one-shot deal brief for V2 writers (replaces rolling recap)."""

from __future__ import annotations

import json
import logging
from typing import Any

from app.agents.llm_result import extract_json, label_ai, label_fallback, sectioned_system_prompt
from app.agents.proposal_schemas import DealBrief
from app.llm import generate_proposal_ai_text as generate_ai_text, is_ai_configured
from app.services.proposal_gemini import (
    format_gemini_error,
    generate_json,
    is_gemini_unavailable,
    proposal_gemini_configured,
)

logger = logging.getLogger(__name__)

SYSTEM = sectioned_system_prompt(
    role="You write a compact deal brief for proposal section writers.",
    goal="Capture closed facts, audience, and what must not be repeated.",
    instructions=(
        "- summary is 80–160 words, customer-specific, no prices.\n"
        "- closedFacts are short bullets already decided in the BRD.\n"
        "- audience is who will read the proposal.\n"
        "- Do not copy gold proposal prose."
    ),
    context="Requirement, plan, and outline keys.",
    output="Return JSON matching DealBrief.",
    guardrails="Never invent catalog prices. Never name another customer.",
)


async def run(body: dict[str, Any] | None = None) -> dict[str, Any]:
    body = body or {}
    req = str(body.get("requirementText") or "").strip()
    fallback_summary = " ".join(req.split())[:400]
    fallback = {
        "ok": True,
        "status": "ok",
        "summary": fallback_summary,
        "closedFacts": [],
        "audience": "buyer and technical evaluators",
    }
    extra = json.dumps(
        {
            "requirementText": req[:8000],
            "profile": body.get("profile") or {},
            "plan": body.get("plan") or {},
            "outline": body.get("outline") or [],
        },
        ensure_ascii=False,
        default=str,
    )[:12_000]
    payload: dict[str, Any] = {}
    if proposal_gemini_configured():
        try:
            model = await generate_json(
                SYSTEM + "\n\nWrite the deal brief.",
                DealBrief,
                extra_text=extra,
            )
            payload = model.model_dump()
        except Exception as exc:  # noqa: BLE001
            logger.warning("proposal-brief Gemini failed: %s", exc)
            if is_gemini_unavailable(exc):
                return label_fallback(fallback, "gemini_unavailable")
            return label_fallback(fallback, f"llm_error:{format_gemini_error(exc)}")
    elif is_ai_configured():
        try:
            text = await generate_ai_text(
                system=SYSTEM,
                user=f"Write the deal brief.\n{extra}",
                max_tokens=700,
                timeout_ms=60_000,
            )
            payload = extract_json(text or "") or {}
        except Exception as exc:  # noqa: BLE001
            logger.exception("proposal-brief LLM failed")
            return label_fallback(fallback, f"llm_error:{type(exc).__name__}")
    else:
        return label_fallback(fallback, "llm_unconfigured")

    return label_ai(
        {
            "ok": True,
            "status": "ok",
            "summary": str(payload.get("summary") or fallback_summary),
            "closedFacts": payload.get("closedFacts") or [],
            "audience": str(payload.get("audience") or fallback["audience"]),
        }
    )
