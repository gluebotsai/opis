"""Campaign-idea image context for enhance layer."""

from __future__ import annotations

from app.agents.image.campaign_image_context import (
    build_campaign_image_context,
    default_image_user_prompt,
)


def test_build_campaign_image_context_from_session():
    session = {
        "channels": ["email"],
        "campaign": {
            "name": "AI Support Launch",
            "goal": "Drive sign-ups for AI support product",
            "objective": "Increase trial starts",
        },
        "channel_plans": [
            {
                "channel": "email",
                "how_it_works": "Lead with ROI and ease of setup for support teams.",
            }
        ],
        "templates": [
            {
                "channel": "email",
                "template_id": "tpl1",
                "fields": {
                    "subject": "Transform customer support with AI",
                    "paragraphs": ["Teams save hours every week with intelligent routing."],
                },
            }
        ],
    }
    ctx = build_campaign_image_context(session, channel="email")
    assert ctx["campaign_name"] == "AI Support Launch"
    assert ctx["template_subject"] == "Transform customer support with AI"
    assert "intelligent routing" in ctx["template_body_snippet"]
    assert "ROI" in ctx["messaging_angle"]
    assert "AI Support Launch" in ctx["campaign_brief"]


def test_default_image_user_prompt_uses_campaign_idea():
    ctx = build_campaign_image_context(
        {
            "channels": ["email"],
            "campaign": {"name": "Summer Sale", "goal": "Boost weekend orders"},
            "templates": [
                {
                    "channel": "email",
                    "fields": {"subject": "20% off this weekend"},
                }
            ],
        },
        channel="email",
    )
    prompt = default_image_user_prompt(ctx)
    assert "Summer Sale" in prompt
    assert "weekend orders" in prompt.lower() or "Boost weekend orders" in prompt
    assert "20% off" in prompt


def test_merge_image_slots_includes_campaign_brief():
    from app.agents.image.enhance import merge_image_slots_from_session

    session = {
        "channels": ["email"],
        "campaign": {"name": "Festive Promo", "goal": "Holiday revenue"},
        "templates": [
            {
                "channel": "email",
                "fields": {"subject": "Holiday deals inside"},
            }
        ],
    }
    spec = merge_image_slots_from_session(session, {"query": "hero"})
    assert spec["campaign_name"] == "Festive Promo"
    assert "Festive Promo" in spec.get("campaign_brief", "")
    assert spec.get("template_subject") == "Holiday deals inside"


def test_sync_primary_template_id_email():
    from app.agents.create_campaign.tool_functions import _sync_primary_template_id

    session = {"channels": ["email"], "send_strategy": {"primary_channel": "email"}}
    tid = _sync_primary_template_id(
        session,
        [
            {"channel": "email", "template_id": "email-123"},
            {"channel": "whatsapp", "template_id": "wa-456"},
        ],
    )
    assert tid == "email-123"
    assert session["template_id"] == "email-123"
