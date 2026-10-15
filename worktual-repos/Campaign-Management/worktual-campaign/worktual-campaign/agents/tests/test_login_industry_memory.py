"""Login industry_type must stay in create-campaign memory and template stamps."""

from __future__ import annotations

from app.agents.create_campaign.memory_note import upsert_industry_memory_note
from app.agents.create_campaign.prompts import build_system_prompt
from app.industry_packs.loader import (
    apply_login_profile_to_session,
    merge_campaign_profile,
    normalize_campaign_profile,
    stamp_campaign_industry,
)
from app.mas.runtime.campaign_setup_snapshot import live_session_facts
from app.mas.runtime.context import build_mas_runtime_context


def test_clothing_on_industry_field_becomes_industry_type() -> None:
    p = normalize_campaign_profile({"mode": "b2c", "industry": "clothing"})
    assert p["mode"] == "b2c"
    assert p["industry"] == "generic-b2c"
    assert p["industry_type"] == "clothing"


def test_merge_keeps_vertical_when_join_omits_it() -> None:
    merged = merge_campaign_profile(
        {"mode": "b2c", "industry": "generic-b2c", "industry_type": "clothing"},
        {"mode": "b2c", "industry": "generic-b2c", "industry_type": ""},
        seed_industry_type="Retail & Apparel",
    )
    assert merged["industry_type"] == "clothing"


def test_merge_backfills_from_company_pack_seed() -> None:
    session: dict = {
        "company_pack": {"seed_industry_type": "clothing"},
    }
    apply_login_profile_to_session(
        session, {"mode": "b2c", "industry": "generic-b2c"}
    )
    assert session["campaign_profile"]["industry_type"] == "clothing"
    note = str(session.get("chat_memory_note") or "")
    assert "Login industry: clothing (B2C)" in note


def test_stamp_does_not_overwrite_vertical_with_pack_id() -> None:
    camp = stamp_campaign_industry(
        {"name": "Drop"},
        {"mode": "b2c", "industry": "generic-b2c", "industry_type": "clothing"},
    )
    assert camp["industry"] == "clothing"
    assert camp["industry_type"] == "clothing"
    assert camp["mode"] == "b2c"


def test_live_session_and_prompts_carry_clothing() -> None:
    session = {
        "session_id": "s1",
        "campaign": {},
        "audience": {},
        "channels": [],
        "templates": [],
        "messages": [],
        "campaign_profile": {
            "mode": "b2c",
            "industry": "generic-b2c",
            "industry_type": "clothing",
        },
    }
    upsert_industry_memory_note(session, session["campaign_profile"])
    facts = live_session_facts(session)
    assert facts["industry_alignment"]["industry_type"] == "clothing"
    prompt = build_system_prompt(
        session,
        {"channels_available": [{"id": "email"}]},
    )
    assert "clothing" in prompt
    assert "Industry vertical" in prompt
    runtime = build_mas_runtime_context(session, module_hint="create_campaign")
    assert "clothing" in runtime
