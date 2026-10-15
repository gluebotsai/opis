from __future__ import annotations

import pytest

from app.orchestrator.mutation_gate import (
    conversation_excerpt,
    llm_open_record_mutation_requested,
    llm_speech_claims_mutation_done,
    seeded_create_navigate,
    turn_already_acted,
    turn_has_mutation_action,
)
from app.orchestrator.coworker_mutation_finalize import block_false_mutation_success_speech


def test_turn_has_mutation_action_from_proposal():
    assert turn_has_mutation_action(
        proposals=[{"name": "propose_update_contact", "args": {}}],
        patch=None,
    )
    assert not turn_has_mutation_action(
        proposals=[{"name": "navigate", "args": {}}],
        patch=None,
    )
    assert turn_has_mutation_action(proposals=[], patch={"firstName": "Ada"})


def test_seeded_create_navigate():
    assert seeded_create_navigate(
        [
            {
                "name": "navigate",
                "args": {
                    "href": "/sales/new",
                    "seedPrompt": 'Create a deal titled "chandru -crm"',
                },
            }
        ]
    )
    assert not seeded_create_navigate(
        [{"name": "navigate", "args": {"href": "/sales/new"}}]
    )
    assert not seeded_create_navigate(
        [{"name": "patch_deal_draft", "args": {"title": "x"}}]
    )


def test_navigate_counts_as_acted():
    assert turn_already_acted(
        proposals=[{"name": "navigate", "args": {"href": "/contact/new"}}],
        patch=None,
    )


@pytest.mark.asyncio
async def test_block_does_not_overwrite_navigate_reply():
    speech = await block_false_mutation_success_speech(
        agent_name="contact-agent",
        module="contact",
        surface="create",
        entity_id=None,
        catalog={},
        user_text="creae a contact",
        proposals=[{"name": "navigate", "args": {"href": "/contact/new"}}],
        patch=None,
        loop_content="Opening the new contact form now.",
        mutation_requested_hint=True,
        remaining_seconds=30.0,
    )
    assert speech == "Opening the new contact form now."


@pytest.mark.asyncio
async def test_llm_mutation_intent_true(monkeypatch):
    async def fake_chat_with_tools(**kwargs):
        return {"content": '{"mutationRequested": true}'}

    monkeypatch.setattr("app.llm.chat_with_tools", fake_chat_with_tools)
    monkeypatch.setattr("app.llm.is_ai_configured", lambda: True)

    ok = await llm_open_record_mutation_requested(
        user_text="Please set their title to VP Sales",
        agent_name="contact-agent",
        module="contact",
        surface="detail",
        entity_id="c1",
        catalog={"openContact": {"id": "c1", "displayName": "Jane"}},
        remaining_seconds=30.0,
    )
    assert ok is True


@pytest.mark.asyncio
async def test_llm_mutation_intent_false(monkeypatch):
    async def fake_chat_with_tools(**kwargs):
        return {"content": '{"mutationRequested": false}'}

    monkeypatch.setattr("app.llm.chat_with_tools", fake_chat_with_tools)
    monkeypatch.setattr("app.llm.is_ai_configured", lambda: True)

    ok = await llm_open_record_mutation_requested(
        user_text="What is their email?",
        agent_name="contact-agent",
        module="contact",
        surface="detail",
        entity_id="c1",
        catalog={"openContact": {"id": "c1"}},
        remaining_seconds=30.0,
    )
    assert ok is False


def test_conversation_excerpt_keeps_prior_assistant():
    text = conversation_excerpt(
        [
            {"role": "user", "content": "change the source of him"},
            {"role": "assistant", "content": "What would you like to change the lead source to for Manoj?"},
            {"role": "user", "text": "call"},
        ]
    )
    assert "lead source" in text
    assert "call" in text


@pytest.mark.asyncio
async def test_speech_claim_true(monkeypatch):
    async def fake_chat_with_tools(**kwargs):
        return {"content": '{"claimedDone": true}'}

    monkeypatch.setattr("app.llm.chat_with_tools", fake_chat_with_tools)
    monkeypatch.setattr("app.llm.is_ai_configured", lambda: True)
    assert await llm_speech_claims_mutation_done(
        assistant_text="I've updated Manoj's lead source to call.",
        remaining_seconds=30.0,
    )


@pytest.mark.asyncio
async def test_block_overwrites_claimed_success_without_tool(monkeypatch):
    async def fake_chat_with_tools(**kwargs):
        content = str((kwargs.get("messages") or [{}])[0].get("content") or "")
        if "claimedDone" in content or "audit coworker" in content.lower():
            return {"content": '{"claimedDone": true}'}
        return {"content": "I couldn't apply that change yet."}

    monkeypatch.setattr("app.llm.chat_with_tools", fake_chat_with_tools)
    monkeypatch.setattr("app.llm.is_ai_configured", lambda: True)
    speech = await block_false_mutation_success_speech(
        agent_name="contact-agent",
        module="contact",
        surface="detail",
        entity_id="c1",
        catalog={"openContact": {"id": "c1", "displayName": "Manoj"}},
        user_text="call",
        proposals=[],
        patch=None,
        loop_content="I've updated Manoj's lead source to call.",
        mutation_requested_hint=False,
        remaining_seconds=30.0,
        messages=[
            {"role": "assistant", "content": "What source?"},
            {"role": "user", "content": "call"},
        ],
    )
    assert "updated" not in speech.lower()
