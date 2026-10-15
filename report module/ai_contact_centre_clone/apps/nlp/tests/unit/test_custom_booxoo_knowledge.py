"""Booxoo knowledge search uses the organization gateway."""

import json
from types import SimpleNamespace

from app.agents.custom_booxoo_bot.tools.handoff import recommend_live_agent_handoff
from app.agents.custom_booxoo_bot.tools.knowledge import search_business_knowledge
from app.agents.support_handoff import extract_handoff_from_messages


def test_search_business_knowledge_uses_organization_gateway(monkeypatch) -> None:
    seen: dict[str, str] = {}

    async def fake_search(query: str, *, organization_id: str, module: str, channel: str | None = None, **_kwargs):
        seen["query"] = query
        seen["organization_id"] = organization_id
        seen["module"] = module
        seen["channel"] = channel or ""
        return {
            "ok": True,
            "empty": False,
            "results": [{"text": "Booxoo sells clothes."}],
        }

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.knowledge.search_knowledge_gateway",
        fake_search,
    )
    ctx = SimpleNamespace(
        request=SimpleNamespace(organization_id="1012", channel="webchat"),
    )
    result = search_business_knowledge(ctx, "what does Booxoo sell", module="product")
    assert result["ok"] is True
    assert result["results"][0]["text"] == "Booxoo sells clothes."
    assert seen == {
        "query": "what does Booxoo sell",
        "organization_id": "1012",
        "module": "business",
        "channel": "webchat",
    }


def test_booxoo_live_agent_tool_matches_contact_center_handoff() -> None:
    result = recommend_live_agent_handoff(None, reason="explicit_request")
    assert result["handoff_recommended"] is True
    recommended, reason = extract_handoff_from_messages(
        [
            {
                "role": "tool",
                "name": "recommend_live_agent_handoff",
                "content": json.dumps(result),
            }
        ]
    )
    assert recommended is True
    assert reason == "explicit_request"
