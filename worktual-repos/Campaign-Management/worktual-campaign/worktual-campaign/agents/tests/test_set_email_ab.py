"""Email A/B: tool exposure, live facts, auto-regenerate when variants missing."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


def test_set_email_ab_in_core_and_executor_tools():
    from app.agents.create_campaign.tools import CORE_TOOLS, tools_for_mas_executor

    names = [t["function"]["name"] for t in CORE_TOOLS]
    assert "set_email_ab" in names

    brief = {t["function"]["name"] for t in tools_for_mas_executor("brief_validation")}
    content = {t["function"]["name"] for t in tools_for_mas_executor("campaign_content")}
    launch = {t["function"]["name"] for t in tools_for_mas_executor("launch_scheduling")}
    assert "set_email_ab" in brief
    assert "set_email_ab" in content
    assert "set_email_ab" in launch


def test_live_session_facts_include_email_ab():
    from app.mas.runtime.campaign_setup_snapshot import live_session_facts

    session = {
        "campaign": {"name": "Spring", "goal": "Sell", "objective": "Convert"},
        "channels": ["email"],
        "templates": [
            {
                "channel": "email",
                "fields": {
                    "ab_test": True,
                    "variant_a": {"subject": "A"},
                    "variant_b": {"subject": "B"},
                },
            }
        ],
        "launch_plan": {
            "ab_enabled": True,
            "ab_pct_a": 20,
            "ab_pct_b": 20,
            "ab_pct_holdout": 60,
            "ab_auto": True,
            "ab_decide_after_minutes": 30,
        },
    }
    facts = live_session_facts(session)
    assert facts.get("email_ab", {}).get("enabled") is True
    assert facts["email_ab"]["pct_a"] == 20
    assert facts["email_ab"]["decide_after_minutes"] == 30
    assert facts["email_ab"]["has_email_variants"] is True


@pytest.mark.asyncio
async def test_set_email_ab_auto_regenerates_when_templates_lack_variants():
    from app.agents.create_campaign.tool_functions import handle_set_email_ab

    base = {
        "session_id": "s-ab",
        "channels": ["email"],
        "templates": [{"channel": "email", "fields": {"subject": "Only A"}}],
        "launch_plan": {},
    }
    calls = {"n": 0}

    async def _get(_sid):
        calls["n"] += 1
        # After regenerate (2nd+ get), session already has variants.
        if calls["n"] >= 2:
            return {
                **base,
                "launch_plan": {
                    "ab_enabled": True,
                    "ab_pct_a": 20,
                    "ab_pct_b": 20,
                    "ab_pct_holdout": 60,
                },
                "templates": [
                    {
                        "channel": "email",
                        "fields": {
                            "ab_test": True,
                            "variant_a": {"subject": "A"},
                            "variant_b": {"subject": "B"},
                        },
                    }
                ],
            }
        return dict(base)

    mock_regen = AsyncMock(return_value={"ok": True, "message": "regenerated"})

    with (
        patch(
            "app.agents.create_campaign.tool_functions.get_or_create_session",
            new=AsyncMock(side_effect=_get),
        ),
        patch(
            "app.agents.create_campaign.tool_functions.save_session",
            new=AsyncMock(side_effect=lambda s: s),
        ),
        patch(
            "app.agents.create_campaign.tool_functions.handle_regenerate_templates",
            new=mock_regen,
        ),
    ):
        out = await handle_set_email_ab(
            "s-ab",
            {
                "enabled": True,
                "ab_pct_a": 20,
                "ab_pct_b": 20,
                "ab_pct_holdout": 60,
                "ab_decide_after_minutes": 15,
                "change_summary": "Enable email A/B",
            },
        )

    assert out.get("ok") is True
    assert out.get("ab_enabled") is True
    assert out.get("email_variants_regenerated") is True
    assert out.get("needs_email_variants") is False
    mock_regen.assert_awaited_once()
    regen_args = mock_regen.await_args.args[1]
    assert regen_args.get("channels") == ["email"]


@pytest.mark.asyncio
async def test_set_email_ab_requires_email_channel():
    from app.agents.create_campaign.tool_functions import handle_set_email_ab

    session = {"session_id": "s2", "channels": ["whatsapp"], "templates": []}

    with (
        patch(
            "app.agents.create_campaign.tool_functions.get_or_create_session",
            new=AsyncMock(return_value=session),
        ),
        patch(
            "app.agents.create_campaign.tool_functions.save_session",
            new=AsyncMock(),
        ),
    ):
        out = await handle_set_email_ab(
            "s2", {"enabled": True, "change_summary": "A/B"}
        )

    assert out.get("ok") is False
    assert "email" in str(out.get("error") or "").lower()


def test_ab_split_defaults():
    from app.agents.create_campaign.tool_functions import _ab_split_from_args

    enabled = _ab_split_from_args({}, enabled=True)
    assert enabled["ab_enabled"] is True
    assert enabled["ab_pct_a"] == 20
    assert enabled["ab_pct_b"] == 20
    assert enabled["ab_pct_holdout"] == 60
    assert enabled["ab_decide_after_minutes"] == 15
    assert "15 min" in str(enabled.get("ab_note") or "")


def test_templates_created_message_includes_real_ab_subjects():
    from app.agents.create_campaign.tool_functions import (
        _email_ab_card_facts,
        _templates_created_message,
    )

    templates = [
        {
            "channel": "email",
            "template_id": "t1",
            "fields": {
                "ab_test": True,
                "subject": "Your 20% discount is waiting",
                "variant_a": {"subject": "Your 20% discount is waiting"},
                "variant_b": {"subject": "What you've been missing"},
            },
        }
    ]
    facts = _email_ab_card_facts(templates)
    assert facts is not None
    assert facts["card_count"] == 1
    assert facts["variant_a_subject"] == "Your 20% discount is waiting"
    assert facts["variant_b_subject"] == "What you've been missing"

    msg = _templates_created_message(
        {},
        templates,
        audience_deferred=True,
    )
    assert "ONE email A/B" in msg
    assert "Your 20% discount is waiting" in msg
    assert "What you've been missing" in msg
    assert "matched_count=0" in msg
    assert "do NOT claim" in msg


def test_normalize_email_ab_variants_inherit_designed_sections():
    from app.agents.template_library.fields import normalize_fields

    raw = {
        "ab_test": True,
        "subject": "A subject",
        "sections": [
            {"type": "headline", "content": "A subject"},
            {"type": "text", "content": "A body paragraph"},
            {"type": "cta", "label": "Shop now", "url": "https://shop.example.com"},
            {"type": "compliance_footer", "content": "Unsubscribe"},
        ],
        "variant_a": {
            "subject": "A subject",
            "paragraphs": ["A body paragraph", "A next step"],
            "cta_label": "Shop now",
            "sections": [],
        },
        "variant_b": {
            "subject": "B different hook",
            "paragraphs": ["B angle body", "B next step"],
            "cta_label": "See offer",
            "sections": [],
        },
    }
    out = normalize_fields("email", raw)
    assert out.get("ab_test") is True
    va = out["variant_a"]
    vb = out["variant_b"]
    assert isinstance(va.get("sections"), list) and len(va["sections"]) >= 3
    assert isinstance(vb.get("sections"), list) and len(vb["sections"]) >= 3
    va_types = [str(r.get("type")) for r in va["sections"] if isinstance(r, dict)]
    vb_types = [str(r.get("type")) for r in vb["sections"] if isinstance(r, dict)]
    assert "headline" in va_types and "cta" in va_types
    assert "headline" in vb_types and "cta" in vb_types
    headline_b = next(
        str(r.get("content") or "")
        for r in vb["sections"]
        if isinstance(r, dict) and str(r.get("type")) == "headline"
    )
    assert "B different" in headline_b


def test_normalize_email_ab_flat_variants_synthesize_sections():
    from app.agents.template_library.fields import normalize_fields

    raw = {
        "ab_test": True,
        "variant_a": {
            "subject": "Flat A",
            "greeting": "Hi {{first_name}},",
            "paragraphs": ["Benefit A", "Next A"],
            "cta_label": "Go A",
            "footer": "Unsub",
        },
        "variant_b": {
            "subject": "Flat B",
            "greeting": "Hi {{first_name}},",
            "paragraphs": ["Benefit B", "Next B"],
            "cta_label": "Go B",
            "footer": "Unsub",
        },
    }
    out = normalize_fields("email", raw)
    assert len(out["variant_a"]["sections"]) >= 3
    assert len(out["variant_b"]["sections"]) >= 3
    assert out["subject"] == "Flat A"
