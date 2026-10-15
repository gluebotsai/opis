from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest

from app.agents.template_generation_director.schemas import (
    align_email_fields_to_design_plan,
    normalize_design_plan,
    validate_email_structure,
)
from app.agents.template_generation_director.workflow import plan_generation
from app.agents.template_library.channels.whatsapp.meta_rules import (
    build_meta_submit_components,
    validate_whatsapp_layout,
)
from app.agents.template_library.fields import (
    fields_are_usable,
    normalize_fields,
)


def test_email_sections_are_normalized_and_usable() -> None:
    fields = normalize_fields(
        "email",
        {
            "subject": "A better way to work",
            "pattern_id": "product_spotlight",
            "theme_id": "clean_light",
            "theme": {"accent": "#2563eb", "unsafe": ""},
            "sections": [
                {"type": "headline", "purpose": "hook", "content": "Meet your next workflow"},
                {"type": "benefits", "purpose": "value", "items": ["Save time", "Stay aligned"]},
                {"type": "cta", "purpose": "action", "label": "Explore it", "url": "https://shop.example.com"},
                {"type": "script", "content": "not allowed"},
            ],
        },
    )
    assert fields["pattern_id"] == "product_spotlight"
    assert [row["type"] for row in fields["sections"]] == [
        "headline",
        "benefits",
        "cta",
    ]
    assert fields_are_usable("email", fields)
    ok, errors = validate_email_structure(
        fields,
        {"sections": ["headline", "benefits", "cta"], "pattern_id": "product_spotlight"},
    )
    assert ok, errors


def test_align_email_sections_reorders_wrong_order() -> None:
    design = normalize_design_plan(
        "email",
        {"pattern_id": "editorial", "theme_id": "clean_light"},
    )
    raw = {
        "subject": "Festive offers await",
        "sections": [
            {"type": "benefits", "items": ["Save more", "Shop festive deals"]},
            {"type": "headline", "content": "Celebrate with exclusive offers"},
            {"type": "cta", "label": "Shop now", "url": "https://shop.example.com"},
        ],
    }
    aligned = normalize_fields(
        "email",
        align_email_fields_to_design_plan(
            raw,
            design,
            campaign={"goal": "Reach", "objective": "Drive festive purchases"},
        ),
    )
    expected_types = design["sections"]
    assert [row["type"] for row in aligned["sections"]] == expected_types
    ok, errors = validate_email_structure(aligned, design)
    assert ok, errors
    assert fields_are_usable("email", aligned)


def test_align_email_sections_from_paragraphs_only() -> None:
    design = normalize_design_plan(
        "email",
        {"pattern_id": "minimal_announcement", "theme_id": "clean_light"},
    )
    raw = {
        "subject": "Vinayaka Chavithi specials",
        "greeting": "Hi {{first_name}},",
        "paragraphs": [
            "Our festive collection is live with rewards on new product purchases.",
            "Explore the offers and pick what fits you best this season.",
        ],
        "cta_label": "View offers",
        "cta_url": "https://shop.example.com/offers",
        "footer": "Unsubscribe anytime.",
    }
    aligned = normalize_fields(
        "email",
        align_email_fields_to_design_plan(
            raw,
            design,
            campaign={
                "goal": "More reach",
                "objective": "Drive new product purchase on Vinayaka Chavithi",
            },
        ),
    )
    assert aligned.get("sections")
    assert [row["type"] for row in aligned["sections"]] == design["sections"]
    ok, errors = validate_email_structure(aligned, design)
    assert ok, errors
    assert fields_are_usable("email", aligned)


def test_align_email_empty_fields_force_from_campaign() -> None:
    """Realtime hosts often return empty LLM content; force repair must still work
    without pasting internal goal/objective into customer-facing slots."""
    design = normalize_design_plan(
        "email",
        {
            "pattern_id": "editorial",
            "theme_id": "clean_light",
            "sections": ["headline", "text", "benefits", "cta", "compliance_footer"],
        },
    )
    goal = "Increase Diwali sales"
    objective = "Promote festive jewellery offers to existing customers"
    aligned = normalize_fields(
        "email",
        align_email_fields_to_design_plan(
            {},
            design,
            campaign={
                "name": "Diwali Jewellery Nights",
                "goal": goal,
                "objective": objective,
            },
            force=True,
        ),
    )
    assert aligned.get("sections")
    types = [row["type"] for row in aligned["sections"]]
    assert "cta" not in types
    assert types == ["headline", "text", "benefits", "compliance_footer"]
    ok, errors = validate_email_structure(aligned, design)
    assert ok, errors
    assert fields_are_usable("email", aligned)
    assert str(aligned.get("subject") or "").strip()
    blob = json.dumps(aligned, ensure_ascii=False).lower()
    assert goal.lower() not in blob
    assert objective.lower() not in blob
    assert "simple next step to get started" not in blob
    assert "learn more" not in blob


def test_align_email_does_not_invent_cta_from_plan() -> None:
    design = normalize_design_plan(
        "email",
        {
            "pattern_id": "minimal_announcement",
            "theme_id": "clean_light",
            "sections": ["headline", "text", "cta", "compliance_footer"],
        },
    )
    raw = {
        "subject": "A quiet update",
        "sections": [
            {"type": "headline", "content": "A quiet update"},
            {"type": "text", "content": "Here is what changed this week."},
            {"type": "compliance_footer", "content": "Unsubscribe anytime."},
        ],
    }
    aligned = normalize_fields(
        "email",
        align_email_fields_to_design_plan(raw, design, campaign={"name": "Weekly note"}),
    )
    types = [row["type"] for row in aligned["sections"]]
    assert "cta" not in types
    assert not any(
        str(row.get("label") or "").lower() in {"learn more", "shop now"}
        for row in aligned["sections"]
        if isinstance(row, dict)
    )
    ok, errors = validate_email_structure(aligned, design)
    assert ok, errors
    assert fields_are_usable("email", aligned)


@pytest.mark.asyncio
async def test_email_generate_empty_llm_fallback_does_not_invent_cta() -> None:
    from app.agents.template_library.channels.email.agent import EmailChannelAgent

    design = normalize_design_plan(
        "email",
        {
            "pattern_id": "product_spotlight",
            "theme_id": "clean_light",
            "sections": ["headline", "text", "benefits", "cta"],
        },
    )
    agent = EmailChannelAgent()

    async def _empty(_prompt: str):
        return None

    with patch.object(agent, "_llm_fields", side_effect=_empty):
        fields = await agent.generate(
            campaign={
                "name": "Diwali Blast",
                "goal": "More reach",
                "objective": "Drive festive purchases this Diwali",
            },
            audience_summary={"count": 100},
            plan={"design_plan": design},
        )
    types = [
        str(row.get("type") or "")
        for row in (fields.get("sections") or [])
        if isinstance(row, dict)
    ]
    assert "cta" not in types
    blob = json.dumps(fields, ensure_ascii=False).lower()
    assert "learn more" not in blob
    assert "shop now" not in blob


def test_email_builtin_placeholder_detection() -> None:
    from app.agents.template_generation_director.schemas import (
        email_fields_contain_builtin_placeholders,
    )

    campaign = {"name": "Diwali Sale Blast"}
    assert email_fields_contain_builtin_placeholders(
        {
            "sections": [
                {"type": "text", "content": "Here's what matters for you — and a clear next step when you're ready."},
                {"type": "benefits", "items": ["A benefit that speaks to your needs"]},
            ]
        },
        campaign,
    )
    assert not email_fields_contain_builtin_placeholders(
        {
            "sections": [
                {"type": "text", "content": "Celebrate Diwali with curated offers."},
            ]
        },
        campaign,
    )


def test_email_design_plan_avoids_prior_pattern() -> None:
    plan = normalize_design_plan(
        "email",
        {"pattern_id": "editorial", "theme_id": "editorial_warm"},
        prior_pattern_ids={"editorial"},
    )
    assert plan["pattern_id"] != "editorial"
    assert plan["theme"]["surface"].startswith("#")
    assert "headline" in plan["sections"]


def test_email_design_plan_includes_image_when_wanted() -> None:
    plan = normalize_design_plan(
        "email",
        {"pattern_id": "editorial", "theme_id": "clean_light", "sections": ["headline", "text", "cta"]},
        wants_images=True,
    )
    assert plan["sections"].count("image") == 1
    assert plan["sections"].index("image") == plan["sections"].index("headline") + 1


def test_email_design_plan_strips_image_when_not_wanted() -> None:
    plan = normalize_design_plan(
        "email",
        {"pattern_id": "editorial", "sections": ["headline", "image", "text", "cta"]},
        wants_images=False,
    )
    assert "image" not in plan["sections"]


def test_whatsapp_layout_preset_is_strict() -> None:
    plan = normalize_design_plan(
        "whatsapp",
        {"preset_id": "wa_dual_choice"},
    )
    valid_fields = {
        "header": "A practical next step",
        "body": (
            "Hi {{first_name}}, here is a practical way to get more value from your "
            "current setup. Review the details, see how the improvements support your "
            "day-to-day work, and choose what works for you today."
        ),
        "buttons": [
            {"type": "URL", "text": "View details", "url": "https://shop.example.com"},
            {"type": "QUICK_REPLY", "text": "Not now"},
        ],
    }
    ok, errors = validate_whatsapp_layout(valid_fields, plan)
    assert ok, errors

    invalid = {**valid_fields, "buttons": valid_fields["buttons"][:1]}
    ok, errors = validate_whatsapp_layout(invalid, plan)
    assert not ok
    assert "exactly 2" in errors[0]


def test_whatsapp_image_header_requires_meta_handle() -> None:
    plan = normalize_design_plan(
        "whatsapp",
        {
            "preset_id": "wa_image_header",
            "header_media_handle": "meta-upload-handle-123",
            "header_media_url": "https://cdn.example.com/header.png",
        },
    )
    fields = {
        "header_format": "IMAGE",
        "header_media_handle": "meta-upload-handle-123",
        "header_media_url": "https://cdn.example.com/header.png",
        "header": "",
        "body": (
            "Hi {{first_name}}, discover a clearer way to manage your workflow and "
            "see the practical benefits available to your team today. Review the "
            "details when it suits you and decide whether the next step fits."
        ),
        "buttons": [
            {"type": "URL", "text": "View details", "url": "https://shop.example.com"}
        ],
    }
    ok, errors = validate_whatsapp_layout(fields, plan)
    assert ok, errors
    components = build_meta_submit_components(fields)["components"]
    assert components[0] == {
        "type": "HEADER",
        "format": "IMAGE",
        "example": {"header_handle": ["meta-upload-handle-123"]},
    }

    fallback = normalize_design_plan(
        "whatsapp",
        {"preset_id": "wa_image_header", "header_media_url": "https://cdn.example.com/x.png"},
    )
    assert fallback["preset_id"] == "wa_header_hook"


def test_planning_layers_carry_login_industry_and_company_rules() -> None:
    brief_reply = {
        "core_idea": "Explain premium workflow access",
        "campaign_intent": "upsell",
        "funnel_stage": "expansion",
        "audience_state": "existing starter users",
        "primary_message": "Advanced workflows remove manual work",
        "desired_action": "upgrade",
        "tone": ["helpful", "premium"],
        "must_include": ["workflow value"],
        "must_avoid": ["aggressive sales language"],
        "verified_facts": [],
        "missing_facts": [],
    }
    style_reply = {
        "plans": [
            {
                "channel": "email",
                "pattern_id": "comparison",
                "theme_id": "calm_professional",
            },
            {"channel": "whatsapp", "preset_id": "wa_header_hook"},
        ]
    }

    async def run() -> None:
        with patch(
            "app.agents.template_generation_director.workflow._json_call",
            AsyncMock(side_effect=[brief_reply, style_reply]),
        ) as llm:
            brief, plans, report = await plan_generation(
                campaign={"goal": "Upsell", "objective": "Explain premium access"},
                audience={"description": "Existing users", "matched_count": 20},
                channels=["email", "whatsapp"],
                channel_plans=[
                    {"channel": "email"},
                    {"channel": "whatsapp"},
                ],
                knowledge="",
                campaign_profile={
                    "mode": "b2b",
                    "industry_type": "Technology & Software",
                },
                company_pack={
                    "rules": [{"text": "Use non-aggressive language"}]
                },
            )
        assert llm.await_count == 2
        assert brief["campaign_intent"] == "upsell"
        assert plans[0]["industry_profile"]["industry_type"] == "Technology & Software"
        assert plans[0]["company_rules"][0]["text"] == "Use non-aggressive language"
        assert plans[0]["policy_profile"]["mode"] == "b2b"
        assert plans[0]["design_plan"]["pattern_id"] == "comparison"
        assert plans[1]["design_plan"]["preset_id"] == "wa_header_hook"
        assert report["layers"]["style_plan"] == "pass"
        assert report["layers"]["industry_policy"] == "pass"

    asyncio.run(run())

