"""Deep narrative requirement from chat + campaign (shared prep for all channels)."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from app.agents.template_generation_director.prompts import INFORMATION_ENHANCER_SYSTEM
from app.agents.template_library.shared import get_llm, parse_llm_run_result
from app.llm import GEN_MAX_TOKENS, GEN_REASONING_EFFORT

_ENHANCER_JSON_RETRY_SYSTEM = (
    "Return only one JSON object in the message content field (not reasoning). "
    "Required key: narrative (multi-sentence creative requirement for all channel writers)."
)


def is_default_enhancer_narrative(narrative: str) -> bool:
    text = str(narrative or "").strip()
    return text.startswith("Internal brief (INPUT ONLY")


def _text(value: Any, fallback: str = "") -> str:
    raw = str(value or "").strip()
    return raw or fallback


def normalize_enhancer_output(raw: Any, campaign: dict[str, Any]) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    narrative = _text(data.get("narrative") or data.get("creative_requirement_narrative"))
    if not narrative:
        goal = _text(campaign.get("goal"))
        objective = _text(campaign.get("objective"))
        narrative = (
            f"Internal brief (INPUT ONLY — never paste into recipient copy): "
            f"goal={goal or '—'}; outcome={objective or '—'}. "
            "Rewrite into clear, attractive customer-facing marketing language "
            "without inventing facts and without leaking campaign-setup wording."
        )
    verified = [
        _text(v)
        for v in (data.get("verified_facts") or [])
        if _text(v)
    ][:16]
    must_include = [
        _text(v)
        for v in (data.get("must_include") or [])
        if _text(v)
    ][:10]
    must_avoid = [
        _text(v)
        for v in (data.get("must_avoid") or [])
        if _text(v)
    ][:10] or ["unsupported claims", "invented prices or dates"]
    missing = [
        _text(v)
        for v in (data.get("missing_facts") or [])
        if _text(v)
    ][:8]
    from app.agents.template_generation_director.creative_context import (
        normalize_image_intent,
    )

    visual = _text(data.get("visual_design_intent") or data.get("design_intent"))
    image_intent = normalize_image_intent(data.get("image_intent"))
    return {
        "narrative": narrative,
        "verified_facts": verified,
        "must_include": must_include,
        "must_avoid": must_avoid,
        "missing_facts": missing,
        "visual_design_intent": visual,
        "user_design_preferences": [
            _text(v)
            for v in (data.get("user_design_preferences") or [])
            if _text(v)
        ][:8],
        "image_intent": image_intent,
    }


async def run_information_enhancer(
    *,
    campaign: dict[str, Any],
    audience: dict[str, Any],
    channels: list[str],
    knowledge: str = "",
    campaign_profile: dict[str, Any] | None = None,
    company_pack: dict[str, Any] | None = None,
    user_request: str = "",
    chat_summary: str = "",
) -> dict[str, Any]:
    """Produce a deep Creative Requirement Narrative + verified-facts ledger."""
    payload = {
        "campaign": campaign,
        "audience": audience,
        "channels": channels,
        "user_request": user_request,
        "chat_summary": chat_summary,
        "campaign_profile_from_login": campaign_profile or {},
        "company_pack": company_pack or {},
        "verified_knowledge": knowledge,
    }
    user_content = json.dumps(payload, ensure_ascii=False, default=str)
    raw: dict[str, Any] | None = None
    for attempt in range(3):
        system = INFORMATION_ENHANCER_SYSTEM if not attempt else _ENHANCER_JSON_RETRY_SYSTEM
        try:
            result = await asyncio.to_thread(
                get_llm().run,
                [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user_content},
                ],
                [],
                "low" if attempt else GEN_REASONING_EFFORT,
                GEN_MAX_TOKENS,
                0.2 if attempt else 0.35,
            )
            parsed = parse_llm_run_result(result)
            if isinstance(parsed, dict) and parsed:
                raw = parsed
                narrative = _text(
                    parsed.get("narrative") or parsed.get("creative_requirement_narrative")
                )
                if narrative and not is_default_enhancer_narrative(narrative):
                    return normalize_enhancer_output(parsed, campaign)
        except Exception:  # noqa: BLE001
            continue
    return normalize_enhancer_output(raw, campaign)


__all__ = [
    "is_default_enhancer_narrative",
    "normalize_enhancer_output",
    "run_information_enhancer",
]
