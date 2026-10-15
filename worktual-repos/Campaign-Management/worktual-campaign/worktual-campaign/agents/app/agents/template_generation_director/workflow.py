"""Layered planning and review for template generation.

The existing channel agents remain specialist writers. This module owns the
creative brief, style decision, anti-repetition, and final creative review.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Awaitable, Callable

from app.agents.template_generation_director.creative_fingerprints import (
    load_recent_fingerprints,
    prior_pattern_ids_from_fingerprints,
)
from app.agents.template_generation_director.information_enhancer import (
    run_information_enhancer,
)
from app.agents.template_generation_director.patterns import pattern_catalog_for_prompt
from app.agents.template_generation_director.prompts import (
    CREATIVE_BRIEF_SYSTEM,
    STYLE_CRITIC_SYSTEM,
    STYLE_DIRECTOR_SYSTEM,
)
from app.agents.template_generation_director.schemas import (
    normalize_creative_brief,
    normalize_design_plan,
)
from app.agents.template_library.shared import get_llm, parse_llm_run_result
from app.llm import GEN_MAX_TOKENS, GEN_REASONING_EFFORT

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]] | None


async def _emit(
    callback: ProgressCallback,
    stage: str,
    label: str,
    *,
    percent: int,
    channels: list[str] | None = None,
) -> None:
    if not callback:
        return
    try:
        await callback(
            {
                "type": "template_progress",
                "payload": {
                    "status": "generating",
                    "stage": stage,
                    "label": label,
                    "percent": percent,
                    "channels": channels or [],
                    "completed_channels": [],
                },
            }
        )
    except Exception:  # noqa: BLE001
        pass


async def _json_call(
    system: str,
    payload: dict[str, Any],
    *,
    temperature: float,
) -> dict[str, Any] | None:
    user_content = json.dumps(payload, ensure_ascii=False, default=str)
    for attempt in range(2):
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
                min(temperature, 0.15) if attempt else temperature,
            )
            parsed = parse_llm_run_result(result)
            if isinstance(parsed, dict) and parsed:
                return parsed
        except Exception:  # noqa: BLE001
            continue
    return None


def _prior_pattern_ids(prior_templates: list[dict[str, Any]] | None) -> set[str]:
    ids: set[str] = set()
    for row in prior_templates or []:
        if not isinstance(row, dict):
            continue
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        for key in ("pattern_id", "pattern", "style_preset", "preset_id"):
            value = str(fields.get(key) or row.get(key) or "").strip().lower()
            if value:
                ids.add(value)
    return ids


async def plan_generation(
    *,
    campaign: dict[str, Any],
    audience: dict[str, Any],
    channels: list[str],
    channel_plans: list[dict[str, Any]],
    knowledge: str,
    campaign_profile: dict[str, Any] | None = None,
    company_pack: dict[str, Any] | None = None,
    user_request: str = "",
    chat_summary: str = "",
    prior_templates: list[dict[str, Any]] | None = None,
    event_callback: ProgressCallback = None,
    wants_images: bool = False,
    image_plan: dict[str, Any] | None = None,
    confirmed_chat_images: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    """Run enhancer → brief → style plan layers with deterministic fallbacks."""
    await _emit(
        event_callback,
        "enhance",
        "Understanding campaign requirements…",
        percent=4,
        channels=channels,
    )
    enhancer = await run_information_enhancer(
        campaign=campaign,
        audience=audience,
        channels=channels,
        knowledge=knowledge,
        campaign_profile=campaign_profile,
        company_pack=company_pack,
        user_request=user_request,
        chat_summary=chat_summary,
    )
    from app.agents.template_generation_director.creative_context import (
        effective_wants_images,
    )

    wants_images = effective_wants_images(
        tool_wants_images=wants_images,
        enhancer=enhancer,
        image_plan=image_plan,
        confirmed_chat_images=confirmed_chat_images,
    )
    await _emit(
        event_callback,
        "brief",
        "Planning creative direction…",
        percent=8,
        channels=channels,
    )
    context = {
        "campaign": campaign,
        "audience": audience,
        "channels": channels,
        "channel_plans": channel_plans,
        "user_request": user_request,
        "chat_summary": chat_summary,
        "creative_requirement_narrative": enhancer.get("narrative"),
        "campaign_profile_from_login": campaign_profile or {},
        "company_pack": company_pack or {},
        "verified_knowledge": knowledge,
        "enhancer_verified_facts": enhancer.get("verified_facts") or [],
        "enhancer_must_include": enhancer.get("must_include") or [],
        "enhancer_must_avoid": enhancer.get("must_avoid") or [],
        "enhancer_missing_facts": enhancer.get("missing_facts") or [],
        "visual_design_intent": enhancer.get("visual_design_intent") or "",
        "user_design_preferences": enhancer.get("user_design_preferences") or [],
        "image_intent": enhancer.get("image_intent") or {},
    }
    raw_brief = await _json_call(CREATIVE_BRIEF_SYSTEM, context, temperature=0.35)
    brief = normalize_creative_brief(raw_brief, campaign)
    brief["narrative"] = str(enhancer.get("narrative") or brief.get("narrative") or "")
    brief["visual_design_intent"] = str(
        enhancer.get("visual_design_intent") or brief.get("visual_design_intent") or ""
    )
    brief["verified_facts"] = list(
        dict.fromkeys(
            list(brief.get("verified_facts") or [])
            + list(enhancer.get("verified_facts") or [])
        )
    )[:16]
    brief["must_include"] = list(
        dict.fromkeys(
            list(brief.get("must_include") or [])
            + list(enhancer.get("must_include") or [])
        )
    )[:10]
    brief["must_avoid"] = list(
        dict.fromkeys(
            list(brief.get("must_avoid") or [])
            + list(enhancer.get("must_avoid") or [])
        )
    )[:10]
    brief["missing_facts"] = list(
        dict.fromkeys(
            list(brief.get("missing_facts") or [])
            + list(enhancer.get("missing_facts") or [])
        )
    )[:8]
    profile = campaign_profile or {}
    policy_profile = {
        "mode": str(profile.get("mode") or "b2b"),
        "industry_type": str(profile.get("industry_type") or "generic"),
        "company_rules": (company_pack or {}).get("rules", []),
        "requirements": [
            "Use only verified facts for prices, dates, statistics, capabilities, and claims.",
            "Keep recipient content native to its channel.",
            "WhatsApp output must pass deterministic Meta template validation.",
        ],
    }

    await _emit(
        event_callback,
        "style",
        "Choosing distinct channel styles…",
        percent=18,
        channels=channels,
    )
    recent_fps = load_recent_fingerprints(prior_templates)
    prior_ids = _prior_pattern_ids(prior_templates) | prior_pattern_ids_from_fingerprints(
        recent_fps
    )
    verified_media_urls = [
        str(campaign.get(key) or "").strip()
        for key in ("product_image", "image_url", "header_media_url")
        if str(campaign.get(key) or "").strip().lower().startswith("https://")
    ]
    verified_media_handles = [
        str(campaign.get(key) or "").strip()
        for key in ("header_media_handle", "meta_media_handle")
        if str(campaign.get(key) or "").strip()
    ]
    from app.agents.template_library.email_brand import extract_brand_from_context

    brand_assets = extract_brand_from_context(
        company_pack=company_pack if isinstance(company_pack, dict) else {},
        campaign=campaign if isinstance(campaign, dict) else {},
    )
    style_payload = {
        "creative_brief": brief,
        "creative_requirement_narrative": brief.get("narrative"),
        "channels": channels,
        "campaign_profile_from_login": campaign_profile or {},
        "company_rules": (company_pack or {}).get("rules", []),
        "brand_assets": brand_assets,
        "catalog": pattern_catalog_for_prompt(),
        "prior_pattern_ids_to_avoid": sorted(prior_ids),
        "recent_creative_fingerprints": recent_fps[:8],
        "verified_media_urls": verified_media_urls,
        "verified_media_handles": verified_media_handles,
        "wants_hero_image": bool(wants_images),
        "image_intent": enhancer.get("image_intent") or {},
        "visual_design_intent": enhancer.get("visual_design_intent") or "",
        "user_design_preferences": enhancer.get("user_design_preferences") or [],
        "instructions": (
            "Choose one plan per selected channel. Distinguish structure from copy. "
            "For email: use image_intent + campaign type to decide how many image sections "
            "and image_slot_specs rows are needed (0–6). URLs are filled later by the image pipeline. "
            "When brand_assets has colors, set theme_overrides with those #hex values. "
            "When brand_assets has social_links/website, include social_links section and pass "
            "only verified URLs — never invent domains."
        ),
    }
    raw_style = await _json_call(STYLE_DIRECTOR_SYSTEM, style_payload, temperature=0.65)
    raw_plans = raw_style.get("plans", []) if isinstance(raw_style, dict) else []
    by_channel: dict[str, Any] = {}
    if isinstance(raw_plans, list):
        for row in raw_plans:
            if isinstance(row, dict):
                channel = str(row.get("channel") or "").strip().lower()
                if channel:
                    by_channel[channel] = row

    source_by_channel = {
        str(row.get("channel") or "").strip().lower(): dict(row)
        for row in channel_plans
        if isinstance(row, dict) and str(row.get("channel") or "").strip()
    }
    plans: list[dict[str, Any]] = []
    for channel in channels:
        raw_channel_plan = by_channel.get(channel)
        if not isinstance(raw_channel_plan, dict):
            intent = str(brief.get("campaign_intent") or "").lower()
            if channel == "email":
                fallback_pattern = (
                    "event_invitation"
                    if any(word in intent for word in ("event", "webinar", "registration"))
                    else "product_spotlight"
                    if any(word in intent for word in ("upsell", "upgrade", "launch", "feature"))
                    else "story_led"
                    if "re_engagement" in intent
                    else "editorial"
                )
                raw_channel_plan = {
                    "pattern_id": fallback_pattern,
                    "theme_id": "calm_professional"
                    if (campaign_profile or {}).get("mode") == "b2b"
                    else "clean_light",
                }
            elif channel == "whatsapp":
                raw_channel_plan = {
                    "preset_id": "wa_educational"
                    if any(word in intent for word in ("event", "education", "webinar"))
                    else "wa_header_hook"
                }
            else:
                raw_channel_plan = {}
        normalized = normalize_design_plan(
            channel,
            {
                **(raw_channel_plan if isinstance(raw_channel_plan, dict) else {}),
                "_company_pack": company_pack or {},
                "_campaign": campaign or {},
            },
            prior_pattern_ids=prior_ids,
            wants_images=wants_images,
        )
        plans.append(
            {
                **source_by_channel.get(channel, {"channel": channel}),
                "creative_brief": brief,
                "design_plan": normalized,
                "industry_profile": campaign_profile or {},
                "policy_profile": policy_profile,
                "company_rules": (company_pack or {}).get("rules", []),
            }
        )

    report = {
        "layers": {
            "information_enhancer": "pass",
            "context": "pass",
            "creative_brief": "pass",
            "industry_policy": "pass",
            "style_plan": "pass",
        },
        "prior_pattern_ids_avoided": sorted(prior_ids),
        "creative_brief": brief,
        "information_enhancer": enhancer,
        "design_plans": [p["design_plan"] for p in plans],
        "recent_fingerprints": recent_fps[:8],
    }
    return brief, plans, report


async def critique_template(
    *,
    channel: str,
    fields: dict[str, Any],
    brief: dict[str, Any],
    design_plan: dict[str, Any],
    prior_templates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    payload = {
        "channel": channel,
        "creative_brief": brief,
        "design_plan": design_plan,
        "generated_fields": fields,
        "prior_pattern_ids": sorted(_prior_pattern_ids(prior_templates)),
    }
    raw = await _json_call(STYLE_CRITIC_SYSTEM, payload, temperature=0.1)
    if not isinstance(raw, dict):
        return {"pass": True, "score": None, "failures": [], "status": "unavailable"}
    failures = raw.get("failures") if isinstance(raw.get("failures"), list) else []
    clean_failures = [str(v).strip() for v in failures if str(v).strip()][:6]
    passed = bool(raw.get("pass"))
    if not passed and not clean_failures:
        clean_failures = ["Creative output did not satisfy the selected design plan."]
    return {
        "pass": passed,
        "score": raw.get("score"),
        "failures": clean_failures,
        "status": "completed",
    }

