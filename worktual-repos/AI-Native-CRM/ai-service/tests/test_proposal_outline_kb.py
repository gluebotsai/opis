import asyncio
import json
from unittest.mock import AsyncMock, patch

from app.agents.proposal_kb_retrieve_agent import run as kb_run
from app.agents.proposal_outline_agent import _playbook_leaves, run as outline_run
from app.agents.proposal_section_keys import canonicalize_section_key
from app.services.knowledge_base import KB_UNAVAILABLE_REASON
from app.services.proposal_knowledge import (
    filter_products_for_requirement,
    kb_slugs_for_requirement,
    load_product_catalog_kb,
    requirement_search_query,
)


def test_brd_category_aliases():
    assert canonicalize_section_key("Solution Architecture") == "architecture"
    assert canonicalize_section_key("API Integrations") == "integrations"
    assert canonicalize_section_key("Implementation Plan") == "rollout"


def test_playbook_leaves_from_specs():
    leaves = _playbook_leaves(
        {
            "sectionSpecs": {
                "overview": {"purpose": "open", "title": "Overview"},
                "requested_solution": {"purpose": "offer"},
            }
        }
    )
    assert [row["key"] for row in leaves] == ["overview", "requested_solution"]


def test_requirement_filters_catalog_rows():
    rows = [
        {"name": "Northwind CRM", "sku": "crm"},
        {"name": "Outbound Blitz", "sku": "campaign"},
    ]
    hay = "Acme needs Northwind CRM for 40 seats and API sync."
    matched = filter_products_for_requirement(rows, hay)
    assert [r["sku"] for r in matched] == ["crm"]
    assert kb_slugs_for_requirement(rows, hay) == ["crm"]
    q = requirement_search_query(hay)
    assert "Acme needs Northwind CRM" in q
    assert "capabilities features architecture" not in q


async def test_outline_falls_back_without_llm():
    with patch(
        "app.agents.proposal_outline_agent.proposal_gemini_configured",
        return_value=False,
    ), patch(
        "app.agents.proposal_outline_agent.is_ai_configured",
        return_value=False,
    ):
        out = await outline_run(
            {"skeleton": [{"key": "overview", "title": "Overview"}]}
        )
    assert out["source"] == "heuristic"
    assert out["sections"][0]["key"] == "overview"


async def test_kb_retrieve_fail_closed():
    with patch(
        "app.agents.proposal_kb_retrieve_agent.load_product_catalog_kb",
        new=AsyncMock(return_value=("", KB_UNAVAILABLE_REASON)),
    ):
        out = await kb_run(
            {
                "organizationId": "1",
                "products": [{"name": "CRM"}],
                "requirementText": "need crm",
            }
        )
    assert out["reason"] == KB_UNAVAILABLE_REASON
    assert out["ok"] is False


async def test_product_catalog_kb_one_requirement_query():
    captured: dict = {}

    async def fake_sales(query, **kwargs):
        captured["query"] = query
        captured["product_ids"] = kwargs.get("product_ids")
        captured["limit"] = kwargs.get("limit")
        captured["timeout"] = kwargs.get("timeout")
        return {"status": "success", "context": "module notes"}

    with patch(
        "app.services.proposal_knowledge.get_sales_knowledge",
        new=fake_sales,
    ):
        text, fail = await load_product_catalog_kb(
            [
                {"name": "Northwind CRM", "sku": "crm"},
                {"name": "Outbound Blitz", "sku": "campaign"},
            ],
            organization_id="9",
            requirement_summary="Acme needs Northwind CRM for 40 seats and API sync.",
        )
    assert fail is None
    assert text == "module notes"
    assert captured["limit"] == 8
    assert "capabilities features architecture" not in captured["query"]
    assert "Acme needs Northwind CRM" in captured["query"]
    assert captured["product_ids"] == ["crm"]
    assert captured["timeout"] is not None
    assert captured["timeout"] >= 12
    assert len(captured["query"]) <= 600


async def test_section_extra_requirement_before_kb_no_heading_search():
    from app.agents import proposal_generate_section_agent as agent

    captured: dict = {}
    section_calls = {"n": 0}

    class Dummy:
        def model_dump(self):
            return {
                "key": "scope",
                "heading": "Scope",
                "body": "written body " * 40,
                "kind": "prose",
                "tableRows": [],
            }

    async def fake_json(prompt, schema, extra_text=""):
        captured["extra"] = extra_text
        captured["prompt"] = prompt
        return Dummy()

    async def fake_section(*_a, **_k):
        section_calls["n"] += 1
        return "leaf", None

    with patch.object(agent, "proposal_gemini_configured", return_value=True), patch.object(
        agent, "generate_json", fake_json
    ), patch.object(agent, "load_section_kb", fake_section):
        out = await agent.run(
            {
                "sectionKey": "scope",
                "heading": "Architecture Overview",
                "purpose": "delivery only",
                "requirementText": "Acme needs Northwind CRM for 40 seats.",
                "knowledgeBase": "x" * 100,
                "rollingRecap": ["Scope: prior unique fact about 40 seats"],
                "products": [
                    {
                        "id": "p1",
                        "name": "CRM",
                        "price": "10",
                        "currency": "USD",
                        "description": "x" * 4000,
                    }
                ],
                "targetWords": 80,
            }
        )
    assert out["ok"] is True
    assert section_calls["n"] == 0
    extra = captured["extra"]
    assert extra.find('"requirementText"') < extra.find('"knowledgeBase"')
    parsed = json.loads(extra)
    assert len(str(parsed.get("knowledgeBase") or "")) <= agent.KB_EXTRA_CAP
    assert parsed.get("alreadyCovered")
    assert "rollingRecap" not in parsed
    products = parsed.get("products") or []
    assert products and "description" not in products[0]
    assert products[0]["name"] == "CRM"


if __name__ == "__main__":
    test_brd_category_aliases()
    test_playbook_leaves_from_specs()
    test_requirement_filters_catalog_rows()
    asyncio.run(test_outline_falls_back_without_llm())
    asyncio.run(test_kb_retrieve_fail_closed())
    asyncio.run(test_product_catalog_kb_one_requirement_query())
    asyncio.run(test_section_extra_requirement_before_kb_no_heading_search())
    print("test_proposal_outline_kb.py ok")
