from typing import Any
from unittest.mock import AsyncMock

import pytest

from app.agents.support_bot import (
    SupportBotAgent,
    format_channel_reply,
)
from app.agents.support_handoff import extract_handoff_from_messages
from app.runtime.agent import Agent
from app.runtime.context import RunContext
from app.schemas.bot import ContactEntities
from app.schemas.copilot import ToolContext


@pytest.fixture(autouse=True)
def _stub_omnichannel_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.agents.support_bot.fetch_contact_omnichannel_memory",
        AsyncMock(return_value={"omni_channel_summary": None, "channel_items": []}),
    )


class FakeMCP:
    def __init__(self, result: dict[str, Any] | None = None) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.result = result or {"status": "enriched"}

    async def call_tool(
        self,
        server_name: str,
        tool_name: str,
        _context: ToolContext,
        arguments: dict[str, Any],
        **_kwargs: Any,
    ) -> dict[str, Any]:
        self.calls.append((server_name, tool_name, arguments))
        return self.result


class FakeAgent:
    def __init__(
        self,
        *,
        run_result: dict[str, Any] | None = None,
        mcp_result: dict[str, Any] | None = None,
    ) -> None:
        self.mcp_client = FakeMCP(mcp_result)
        self.run_result = run_result or {"reply": "Thanks, I updated your details."}

    def build_tool_context(self, context: RunContext) -> ToolContext:
        return Agent.build_tool_context(self, context)

    async def run(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
        return self.run_result


@pytest.mark.asyncio
async def test_support_bot_enriches_contact_entity_for_any_channel(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.agents.support_bot.extract_contact_entities_llm",
        AsyncMock(
            return_value=ContactEntities(email="customer@example.com"),
        ),
    )
    support_bot = SupportBotAgent()
    fake_agent = FakeAgent()
    support_bot.agent = fake_agent

    response = await support_bot.run_turn(
        organization_id="tenant-1",
        conversation_id="conversation-1",
        message="My email is customer@example.com",
        channel="whatsapp",
    )

    assert response.contact_entities.email == "customer@example.com"
    assert fake_agent.mcp_client.calls == [
        ("contact", "contact_enrich", {"email": "customer@example.com"})
    ]


@pytest.mark.asyncio
async def test_support_bot_skips_enrich_when_email_matches_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.agents.support_bot.extract_contact_entities_llm",
        AsyncMock(
            return_value=ContactEntities(email="customer@example.com"),
        ),
    )
    support_bot = SupportBotAgent()
    fake_agent = FakeAgent()
    support_bot.agent = fake_agent

    await support_bot.run_turn(
        organization_id="tenant-1",
        conversation_id="conversation-1",
        message="My email is customer@example.com",
        channel="whatsapp",
        tenant_context={
            "contact_profile": {
                "contactId": "contact-1",
                "primaryEmail": "customer@example.com",
            },
        },
    )

    assert fake_agent.mcp_client.calls == []


@pytest.mark.asyncio
async def test_support_bot_applies_phone_and_asks_before_replacing_email(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.agents.support_bot.extract_contact_entities_llm",
        AsyncMock(
            return_value=ContactEntities(
                email="new@example.com",
                phone="8467565853",
            ),
        ),
    )
    support_bot = SupportBotAgent()
    fake_agent = FakeAgent(
        mcp_result={
            "result": {
                "outcome": "enriched",
                "appliedFields": ["phone"],
            },
        },
    )
    support_bot.agent = fake_agent

    response = await support_bot.run_turn(
        organization_id="tenant-1",
        conversation_id="conversation-1",
        message="My email is new@example.com and phone is 8467565853",
        channel="webchat",
        tenant_context={
            "contact_profile": {
                "contactId": "contact-1",
                "primaryEmail": "old@example.com",
            },
        },
    )

    assert fake_agent.mcp_client.calls == [
        (
            "contact",
            "contact_enrich",
            {"phone": "8467565853", "email": "new@example.com"},
        ),
    ]
    assert "updated your phone" in response.reply
    assert "email you provided differs" in response.reply
    assert "Would you like me to replace it?" in response.reply


@pytest.mark.asyncio
async def test_explicit_live_agent_request_uses_agent_tool_signal() -> None:
    support_bot = SupportBotAgent()
    support_bot.agent = FakeAgent(
        run_result={
            "reply": "I'm connecting you with a live agent from our team. Please hold.",
            "messages": [
                {
                    "role": "tool",
                    "name": "recommend_live_agent_handoff",
                    "content": '{"handoff_recommended": true, "reason": "explicit_request"}',
                }
            ],
        }
    )

    response = await support_bot.run_turn(
        organization_id="tenant-1",
        conversation_id="conversation-1",
        message="Please connect me to a live agent",
        channel="webchat",
    )

    assert response.handoff_recommended is True
    assert response.handoff_reason == "explicit_request"


def test_extract_handoff_from_messages() -> None:
    recommended, reason = extract_handoff_from_messages(
        [
            {
                "role": "tool",
                "name": "recommend_live_agent_handoff",
                "content": '{"handoff_recommended": true, "reason": "customer_request"}',
            }
        ]
    )
    assert recommended is True
    assert reason == "customer_request"


@pytest.mark.asyncio
async def test_support_bot_injects_omni_channel_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.agents.support_bot.extract_contact_entities_llm",
        AsyncMock(return_value=ContactEntities()),
    )
    monkeypatch.setattr(
        "app.agents.support_bot.fetch_contact_omnichannel_memory",
        AsyncMock(
            return_value={
                "omni_channel_summary": "Refund in progress; prefers WhatsApp.",
                "channel_items": [
                    {"channel": "whatsapp", "summary": "Asked about order 4412"},
                ],
            }
        ),
    )
    captured: dict[str, Any] = {}

    class CaptureAgent(FakeAgent):
        async def run(self, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
            captured["memory"] = _args[2] if len(_args) > 2 else _kwargs.get("memory")
            return self.run_result

    support_bot = SupportBotAgent()
    support_bot.agent = CaptureAgent()

    await support_bot.run_turn(
        organization_id="tenant-1",
        conversation_id="conversation-1",
        message="What happened to my refund?",
        channel="webchat",
        tenant_context={"contact_profile": {"contactId": "contact-wa-1"}},
    )

    memory = captured["memory"]
    system = memory.messages[0]["content"]
    assert "Omni-channel summary: Refund in progress; prefers WhatsApp." in system
    assert "[whatsapp] Asked about order 4412" in system


@pytest.mark.asyncio
async def test_support_bot_fetches_omni_after_phone_enrich(monkeypatch: pytest.MonkeyPatch) -> None:
    fetch = AsyncMock(return_value={"omni_channel_summary": None, "channel_items": []})
    monkeypatch.setattr(
        "app.agents.support_bot.extract_contact_entities_llm",
        AsyncMock(return_value=ContactEntities(phone="919150911820")),
    )
    monkeypatch.setattr("app.agents.support_bot.fetch_contact_omnichannel_memory", fetch)
    support_bot = SupportBotAgent()
    support_bot.agent = FakeAgent(
        mcp_result={
            "result": {
                "outcome": "enriched",
                "appliedFields": ["phone"],
                "canonicalContactId": "cdp-whatsapp-1",
                "contact": {
                    "id": "cdp-whatsapp-1",
                    "primaryPhone": "919150911820",
                },
            },
        }
    )

    await support_bot.run_turn(
        organization_id="tenant-1",
        conversation_id="conversation-1",
        message="My mobile number is 919150911820",
        channel="webchat",
    )

    fetch.assert_awaited_once_with("tenant-1", "cdp-whatsapp-1")


def test_social_reply_formatting_removes_html_and_limits_length() -> None:
    reply = format_channel_reply("<p>Hello</p>\n<strong>Customer</strong>" + ("!" * 1200), "instagram")
    assert "<" not in reply
    assert reply.startswith("Hello")
    assert len(reply) == 1000
