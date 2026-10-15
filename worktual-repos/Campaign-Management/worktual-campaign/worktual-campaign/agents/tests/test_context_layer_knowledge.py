"""context_layer search client + create-campaign search_knowledge tool."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.integrations.context_layer import (
    campaign_knowledge_query,
    format_search_hits,
    search_campaign_knowledge,
    search_context_layer,
)


def test_format_search_hits_clips_and_skips_empty() -> None:
    hits = format_search_hits(
        [
            {"text": "Pro Plan is 50% off", "file_name": "Sales KB.pdf", "module": "product"},
            {"text": "   ", "file_name": "skip.pdf"},
            "not-a-dict",
        ],
        max_hits=5,
    )
    assert len(hits) == 1
    assert hits[0]["text"] == "Pro Plan is 50% off"
    assert hits[0]["file_name"] == "Sales KB.pdf"


def test_campaign_knowledge_query_joins_campaign_fields() -> None:
    q = campaign_knowledge_query(
        {"name": "Diwali", "goal": "Sales", "objective": "10% off"},
        extra="Pro Plan email",
    )
    assert "Pro Plan email" in q
    assert "Diwali" in q
    assert "10% off" in q


@pytest.mark.asyncio
async def test_search_context_layer_requires_org() -> None:
    out = await search_context_layer(organization_id="", query="pricing")
    assert out["ok"] is False
    assert out["error"] == "organization_id_required"
    assert out["results"] == []


@pytest.mark.asyncio
async def test_search_campaign_knowledge_posts_product_ids_campaign() -> None:
    class _Resp:
        content = b'{"results":[{"text":"Campaign Management overview","file_name":"Sales KB.pdf","module":"product"}]}'

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "results": [
                    {
                        "text": "Campaign Management overview",
                        "file_name": "Sales KB.pdf",
                        "module": "product",
                    }
                ]
            }

    class _Client:
        def __init__(self, *args: object, **kwargs: object) -> None:
            self.posted: list[tuple[str, dict]] = []

        async def __aenter__(self) -> "_Client":
            return self

        async def __aexit__(self, *args: object) -> None:
            return None

        async def post(self, url: str, json: dict | None = None) -> _Resp:
            self.posted.append((url, dict(json or {})))
            return _Resp()

    with patch("app.integrations.context_layer.httpx.AsyncClient", _Client), patch(
        "app.integrations.context_layer.get_settings"
    ) as settings:
        settings.return_value.kb_enabled = True
        settings.return_value.context_layer_url = "http://82.113.92.47:7051"
        settings.return_value.context_layer_timeout_s = 12.0
        out = await search_campaign_knowledge(
            organization_id="1003",
            query="campaign product",
            modules=("product",),
        )
    assert out["ok"] is True
    assert out["count"] == 1
    assert "Campaign Management" in out["snippets"]


@pytest.mark.asyncio
async def test_search_knowledge_for_agent_uses_session_org() -> None:
    from app.knowledge_base import search_knowledge_for_agent

    async def fake_search(**kwargs: object) -> dict:
        assert kwargs.get("organization_id") == "1003"
        return {
            "ok": True,
            "results": [{"text": "Pro Plan quote", "file_name": "Sales KB.pdf"}],
            "snippets": "[Sales KB.pdf] Pro Plan quote",
            "count": 1,
        }

    with patch(
        "app.knowledge_base.search_campaign_knowledge",
        new=AsyncMock(side_effect=fake_search),
    ):
        out = await search_knowledge_for_agent(
            query="Pro Plan pricing",
            session={"organization_id": "1003"},
            module="auto",
        )
    assert out["ok"] is True
    assert out["count"] == 1
    assert "Pro Plan quote" in out["snippets"]


def test_search_knowledge_on_create_and_edit_tools() -> None:
    from app.agents.create_campaign.tools import CORE_TOOLS, tools_for_mas_executor
    from app.mas.catalog import EXECUTOR_META, executors_for_domain
    from app.mas.executors.registry import get_executor_runner
    from app.mas.skills.create_campaign import CREATE_CAMPAIGN_MODULE
    from app.mas.skills.registry import get_skill_registry
    from app.mas.skills.template_edit import TEMPLATE_EDIT_MODULE

    names = [t["function"]["name"] for t in CORE_TOOLS]
    assert "search_knowledge" in names

    brief = {t["function"]["name"] for t in tools_for_mas_executor("brief_validation")}
    content = {t["function"]["name"] for t in tools_for_mas_executor("campaign_content")}
    kb = {t["function"]["name"] for t in tools_for_mas_executor("search_knowledge")}
    assert "search_knowledge" in brief
    assert "search_knowledge" in content
    assert kb == {"search_knowledge"}

    assert "search_knowledge" in executors_for_domain("creation")
    assert EXECUTOR_META["search_knowledge"]["domain"] == "creation"
    runner = get_executor_runner("search_knowledge")
    assert callable(runner)

    registry = get_skill_registry()
    templates = registry.get(CREATE_CAMPAIGN_MODULE, "campaign_templates")
    assert templates and "search_knowledge" in templates.tool_names
    copy = registry.get(TEMPLATE_EDIT_MODULE, "edit_copy")
    assert copy and "search_knowledge" in copy.tool_names
