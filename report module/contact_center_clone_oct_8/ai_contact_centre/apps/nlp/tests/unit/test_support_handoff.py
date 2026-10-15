"""Tests for shared support handoff helpers."""

import json

import pytest

from app.agents.support_handoff import extract_handoff_from_messages, resolve_handoff_fields


def test_extract_handoff_from_recommend_live_agent_tool() -> None:
    messages = [
        {
            "role": "tool",
            "name": "recommend_live_agent_handoff",
            "content": json.dumps({"handoff_recommended": True, "reason": "explicit_request"}),
        }
    ]
    recommended, reason = extract_handoff_from_messages(messages)
    assert recommended is True
    assert reason == "explicit_request"


def test_extract_handoff_from_lola_live_agent_tool() -> None:
    messages = [
        {
            "role": "tool",
            "name": "LIVE_AGENT",
            "content": json.dumps(
                {
                    "handoff_recommended": True,
                    "reason": "explicit_request",
                    "message": "Connecting you now.",
                }
            ),
        }
    ]
    recommended, reason = extract_handoff_from_messages(messages)
    assert recommended is True
    assert reason == "explicit_request"


async def test_resolve_handoff_fields_without_handoff() -> None:
    fields = await resolve_handoff_fields(
        messages=[],
        tenant_context={},
        transcript=[],
        message="hello",
    )
    assert fields.handoff_recommended is False
    assert fields.intent == "general_inquiry"


@pytest.mark.asyncio
async def test_handoff_fallback_does_not_keyword_route_customer_text() -> None:
    class FailingLLM:
        async def json(self, _messages):
            raise RuntimeError("unavailable")

    fields = await resolve_handoff_fields(
        messages=[
            {
                "role": "tool",
                "name": "recommend_live_agent_handoff",
                "content": json.dumps(
                    {"handoff_recommended": True, "reason": "explicit_request"}
                ),
            }
        ],
        tenant_context={
            "queue_profiles": [
                {"key": "support", "name": "Support", "skills": ["support"]},
                {"key": "billing", "name": "Billing", "skills": ["billing"]},
            ]
        },
        transcript=[],
        message="Please connect me with billing",
        llm=FailingLLM(),
    )

    assert fields.selected_queue_key == "support"
