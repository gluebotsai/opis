"""Prompt contract: jun30 strategist + hub sections."""

from app.agents.contacts.prompts import build_system_prompt as contacts_prompt
from app.agents.create_campaign.prompts import (
    CAMPAIGN_MANAGEMENT_STRATEGIST_PROMPT,
    build_system_prompt,
    hub_system_prompt,
)
from app.prompt_sections import SECTION_ORDER, sectioned_system_prompt


def test_sectioned_order() -> None:
    text = sectioned_system_prompt(
        role="r",
        goal="g",
        instructions="i",
        context="c",
        output="o",
        guardrails="x",
    )
    positions = [text.index(f"## {name}") for name in SECTION_ORDER]
    assert positions == sorted(positions)


def test_create_campaign_prompt_is_jun30_with_live_context() -> None:
    session = {
        "session_id": "test-create",
        "campaign": {"name": "Spring", "goal": "Leads", "objective": "Signup"},
        "audience": {"matched_count": 3},
        "channels": ["web"],
        "templates": [{"id": "t1"}],
        "org_context": {"channels_available": ["email", "web"]},
        "strategy_accepted": False,
    }
    text = build_system_prompt(session, session.get("org_context"))
    assert "campaign strategist" in text.lower() or "USER PREFERENCE" in text
    assert "Spring" in text
    assert "launch_campaign" in text or "LAUNCH_CAMPAIGN" in text
    assert "build_campaign" in text or "create_template" in text
    assert (
        "clarify" in text.lower()
        or "USER PREFERENCE" in text
        or "unclear" in text.lower()
    )


def test_create_campaign_live_session_snapshot() -> None:
    session = {
        "session_id": "test-create-2",
        "campaign": {"name": "Spring", "goal": "Leads", "objective": "Signup"},
        "audience": {"matched_count": 2},
        "channels": ["whatsapp"],
        "templates": [],
        "strategy_accepted": True,
        "whatsapp_retry": None,
    }
    text = build_system_prompt(session, {})
    assert "Live session" in text or "strategy_accepted" in text
    assert "whatsapp" in text.lower()


def test_hub_prompt_has_sections() -> None:
    text = hub_system_prompt({"session_id": "hub-1", "hub_mode": True, "drafts_snapshot": []})
    for name in SECTION_ORDER:
        assert f"## {name}" in text
    assert "OPEN_HUB_DESTINATION" in text


def test_strategist_prompt_constant_present() -> None:
    assert "build_campaign" in CAMPAIGN_MANAGEMENT_STRATEGIST_PROMPT
    assert "launch_campaign" in CAMPAIGN_MANAGEMENT_STRATEGIST_PROMPT
    assert "USER PREFERENCE" in CAMPAIGN_MANAGEMENT_STRATEGIST_PROMPT
    assert "templates first" in CAMPAIGN_MANAGEMENT_STRATEGIST_PROMPT.lower()
    assert "three short names" in CAMPAIGN_MANAGEMENT_STRATEGIST_PROMPT.lower()
    assert "Knowledge Base" not in CAMPAIGN_MANAGEMENT_STRATEGIST_PROMPT
    assert "Operation Hub" not in CAMPAIGN_MANAGEMENT_STRATEGIST_PROMPT


def test_contacts_prompt_dynamic_missing_fields() -> None:
    session = {
        "session_id": "test-contacts",
        "module": "contacts",
        "draft_contact": {"first_name": "Ada"},
        "campaign_profile": {"mode": "b2b"},
    }
    text = contacts_prompt(session)
    assert "## Context" in text
    assert "Ada" in text or "first_name" in text
