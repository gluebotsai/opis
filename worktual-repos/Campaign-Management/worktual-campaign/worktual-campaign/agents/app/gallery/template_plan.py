"""Build gallery template plans via the same Director pipeline as create-campaign."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.agents.template_generation_director.patterns import EMAIL_PATTERNS, EMAIL_THEMES
from app.agents.template_generation_director.workflow import plan_generation
from app.agents.template_library.creation_agent import _merge_director_plans
from app.config import get_settings
from app.knowledge_base import fetch_campaign_knowledge


def _prior_pattern_ids(prior_templates: list[dict[str, Any]] | None) -> set[str]:
    ids: set[str] = set()
    for row in prior_templates or []:
        fields = row.get("fields") if isinstance(row.get("fields"), dict) else {}
        pid = str(fields.get("pattern_id") or "").strip().lower()
        if pid:
            ids.add(pid)
    return ids


def gallery_email_design_seed(
    variant_index: int,
    prior_pattern_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Deterministic pattern/theme rotation — one distinct layout per gallery idea."""
    prior = prior_pattern_ids or set()
    patterns = list(EMAIL_PATTERNS.keys())
    themes = list(EMAIL_THEMES.keys())
    idx = max(0, int(variant_index or 1) - 1)

    pattern_id = patterns[idx % len(patterns)]
    for offset in range(len(patterns)):
        candidate = patterns[(idx + offset) % len(patterns)]
        if candidate not in prior:
            pattern_id = candidate
            break

    theme_id = themes[idx % len(themes)]
    spec = EMAIL_PATTERNS[pattern_id]
    sections = [s for s in spec.get("sections", []) if s != "image"]
    return {
        "channel": "email",
        "pattern_id": pattern_id,
        "theme_id": theme_id,
        "theme": dict(EMAIL_THEMES[theme_id]),
        "sections": sections,
        "visual_direction": str(spec.get("direction") or ""),
        "content_rhythm": "scannable and purposeful",
        "cta_strategy": {
            "required": "cta" in sections,
            "position": "as planned",
        },
    }


def build_gallery_content_plan(
    *,
    idea: dict[str, Any],
    spec: dict[str, Any],
    agent_channel: str,
    has_image: bool,
) -> dict[str, Any]:
    """Native channel content plan — no Template Director (non-email channels)."""
    title = str(idea.get("title") or "Campaign").strip()
    summary = str(idea.get("summary") or "").strip()
    goal = str(idea.get("goal") or "Engagement").strip()
    launch = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    variant_index = spec.get("variant_index")
    ch = agent_channel.strip().lower()
    return {
        "channel": ch,
        "how_it_works": f"{ch} notification for campaign idea: {title}",
        "suggested_launch_at": launch,
        "gallery_variant_index": variant_index,
        "creative_brief": {
            "campaign_name": title,
            "goal": goal,
            "messaging_angle": summary or goal,
            "gallery_mode": True,
            "has_hero_image": False,
            "variant_index": variant_index,
        },
        "design_plan": {
            "layout": "gallery_native",
            "channel": ch,
            "has_image": False,
            "variant_index": variant_index,
        },
    }


async def build_gallery_channel_plan(
    *,
    org: dict[str, Any],
    idea: dict[str, Any],
    spec: dict[str, Any],
    agent_channel: str,
    has_image: bool,
    image_url: str | None,
    prior_templates: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Email only: Director plan_generation → merged channel plan with rotated design."""
    title = str(idea.get("title") or "Campaign").strip()
    summary = str(idea.get("summary") or "").strip()
    goal = str(idea.get("goal") or "Engagement").strip()
    launch = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    variant_index = int(spec.get("variant_index") or 1)
    prior = prior_templates or []
    prior_ids = _prior_pattern_ids(prior)
    design_seed = gallery_email_design_seed(variant_index, prior_ids)

    campaign = {
        "name": title,
        "goal": goal,
        "objective": summary or goal,
        "industry": str(org.get("pack_id") or org.get("industry") or ""),
    }
    channel_plans = [
        {
            "channel": agent_channel,
            "how_it_works": f"Email gallery template for: {title}",
            "suggested_launch_at": launch,
            "gallery_variant_index": variant_index,
            "design_plan": design_seed,
        }
    ]
    campaign_profile = {
        "mode": str(org.get("mode") or "b2b"),
        "industry": str(org.get("pack_id") or "generic-b2b"),
        "industry_type": str(org.get("industry_type") or ""),
    }
    company_pack = (
        org.get("company_pack") if isinstance(org.get("company_pack"), dict) else {}
    )
    knowledge = await fetch_campaign_knowledge(
        campaign,
        organization_id=str(org.get("organization_id") or org.get("organizationId") or ""),
    )

    if get_settings().template_director_enabled:
        brief, director_plans, _report = await plan_generation(
            campaign=campaign,
            audience={},
            channels=[agent_channel],
            channel_plans=channel_plans,
            knowledge=knowledge,
            campaign_profile=campaign_profile,
            company_pack=company_pack,
            prior_templates=prior,
            user_request=(
                f"Template Gallery email #{variant_index} for campaign idea: {title}. "
                f"Use pattern_id={design_seed['pattern_id']} and theme_id={design_seed['theme_id']}. "
                f"Layout must differ from other gallery emails — follow the planned sections exactly. "
                f"Text-only email: no image section."
            ),
            wants_images=False,
        )
        merged = _merge_director_plans(channel_plans, director_plans)
        plan = dict(merged[0] if merged else channel_plans[0])
        dp = plan.get("design_plan") if isinstance(plan.get("design_plan"), dict) else {}
        chosen_pattern = str(dp.get("pattern_id") or "").strip().lower()
        if chosen_pattern in prior_ids or chosen_pattern not in EMAIL_PATTERNS:
            plan["design_plan"] = {**design_seed, **dp, **design_seed}
        elif dp:
            plan["design_plan"] = {**design_seed, **dp}
        else:
            plan["design_plan"] = design_seed
        if isinstance(brief, dict):
            plan["creative_brief"] = {
                **(
                    plan.get("creative_brief")
                    if isinstance(plan.get("creative_brief"), dict)
                    else {}
                ),
                **brief,
                "gallery_mode": True,
                "has_hero_image": False,
                "variant_index": variant_index,
                "pattern_id": design_seed["pattern_id"],
                "theme_id": design_seed["theme_id"],
            }
    else:
        plan = build_gallery_content_plan(
            idea=idea,
            spec=spec,
            agent_channel=agent_channel,
            has_image=False,
        )
        plan["design_plan"] = design_seed

    return plan
