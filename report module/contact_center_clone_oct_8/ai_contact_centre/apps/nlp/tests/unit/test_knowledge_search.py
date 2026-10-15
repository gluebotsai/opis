import httpx
import pytest

from app.config import Settings
from app.services.knowledge_search import (
    EMPTY_KNOWLEDGE_REPLY,
    EMPTY_KNOWLEDGE_REPLY_AGENT,
    adapt_knowledge_search_response,
    empty_knowledge_message,
    normalize_knowledge_module,
    normalize_organization_entity_id,
    search_knowledge_gateway,
)


def test_normalize_organization_entity_id_stringifies_int() -> None:
    assert normalize_organization_entity_id(1000) == "1000"
    assert normalize_organization_entity_id("1000") == "1000"
    assert normalize_organization_entity_id(" 1000 ") == "1000"
    assert normalize_organization_entity_id("ce4ff326-4c0e-43f2-a978-e6b494cd0775") is None
    assert normalize_organization_entity_id(None) is None


def test_normalize_knowledge_module_maps_setup_categories() -> None:
    assert normalize_knowledge_module("business") == "business"
    assert normalize_knowledge_module("product") == "product"
    assert normalize_knowledge_module("support") == "support"
    assert normalize_knowledge_module("customer_support") == "support"
    assert normalize_knowledge_module("Customer Support") == "support"
    assert normalize_knowledge_module("unknown") is None


def test_empty_knowledge_message_is_audience_specific() -> None:
    assert empty_knowledge_message(channel="webchat") == EMPTY_KNOWLEDGE_REPLY
    assert empty_knowledge_message(channel="whatsapp") == EMPTY_KNOWLEDGE_REPLY
    assert empty_knowledge_message(channel="inbox") == EMPTY_KNOWLEDGE_REPLY_AGENT
    assert empty_knowledge_message(channel="other") == EMPTY_KNOWLEDGE_REPLY_AGENT
    assert empty_knowledge_message() == EMPTY_KNOWLEDGE_REPLY_AGENT
    assert "live agent" not in EMPTY_KNOWLEDGE_REPLY_AGENT.lower()


def test_adapt_knowledge_search_empty_results() -> None:
    result = adapt_knowledge_search_response(
        {"results": []},
        module="business",
        query="What is Lucas?",
    )
    assert result["ok"] is False
    assert result["empty"] is True
    assert result["message"] == EMPTY_KNOWLEDGE_REPLY_AGENT
    assert result["results"] == []


def test_adapt_knowledge_search_empty_results_customer_channel() -> None:
    result = adapt_knowledge_search_response(
        {"results": []},
        module="product",
        query="tell me about your product",
        channel="webchat",
    )
    assert result["message"] == EMPTY_KNOWLEDGE_REPLY


def test_adapt_knowledge_search_with_snippets() -> None:
    result = adapt_knowledge_search_response(
        {
            "results": [
                {
                    "id": "a1",
                    "text": "Lola is a digital assistant.",
                    "file_name": "Worktual_sales_kb.pdf",
                    "page_number": 1,
                    "document_id": "1787235232130002",
                    "_rankingScore": 0.84,
                },
                {"id": "a2", "text": "   ", "_rankingScore": 0.1},
            ]
        },
        module="business",
        query="What is lola?",
    )
    assert result["ok"] is True
    assert result["empty"] is False
    assert result["count"] == 1
    assert result["results"][0]["text"] == "Lola is a digital assistant."
    assert result["results"][0]["ranking_score"] == 0.84


@pytest.mark.asyncio
async def test_search_knowledge_gateway_posts_fixed_fields() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        captured["url"] = str(request.url)
        captured["json"] = json.loads(request.content.decode())
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "id": "1",
                        "text": "Worktual is an AI contact center.",
                        "_rankingScore": 0.9,
                    }
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    settings = Settings(
        knowledge_search_url="http://kb.test",
        knowledge_search_product_id="contact-center",
        knowledge_search_ccaas_audience="both",
        knowledge_search_max_results=5,
    )
    async with httpx.AsyncClient(transport=transport) as client:
        result = await search_knowledge_gateway(
            "What is Worktual?",
            organization_id="1000",
            module="customer_support",
            settings=settings,
            client=client,
        )

    assert captured["url"] == "http://kb.test/search"
    assert captured["json"] == {
        "organization_id": "1000",
        "module": "support",
        "query": "What is Worktual?",
        "max_no_result": 5,
        "product_ids": "contact-center",
        "ccaas_audience": "both",
    }
    assert result["ok"] is True
    assert result["module"] == "support"


@pytest.mark.asyncio
async def test_search_knowledge_gateway_empty_results_message() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    transport = httpx.MockTransport(handler)
    settings = Settings(knowledge_search_url="http://kb.test")
    async with httpx.AsyncClient(transport=transport) as client:
        result = await search_knowledge_gateway(
            "obscure question",
            organization_id="1000",
            module="business",
            settings=settings,
            client=client,
        )

    assert result["ok"] is False
    assert result["empty"] is True
    assert result["message"] == EMPTY_KNOWLEDGE_REPLY_AGENT


@pytest.mark.asyncio
async def test_search_knowledge_gateway_empty_results_customer_channel() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": []})

    transport = httpx.MockTransport(handler)
    settings = Settings(knowledge_search_url="http://kb.test")
    async with httpx.AsyncClient(transport=transport) as client:
        result = await search_knowledge_gateway(
            "tell me about your product",
            organization_id="1000",
            module="product",
            settings=settings,
            client=client,
            channel="webchat",
        )

    assert result["ok"] is False
    assert result["empty"] is True
    assert result["message"] == EMPTY_KNOWLEDGE_REPLY


@pytest.mark.asyncio
async def test_search_knowledge_gateway_rejects_legacy_uuid_org() -> None:
    called = False

    def handler(_request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200, json={"results": []})

    transport = httpx.MockTransport(handler)
    settings = Settings(knowledge_search_url="http://kb.test")
    async with httpx.AsyncClient(transport=transport) as client:
        result = await search_knowledge_gateway(
            "What is ZIFO?",
            organization_id="ce4ff326-4c0e-43f2-a978-e6b494cd0775",
            module="business",
            settings=settings,
            client=client,
        )

    assert called is False
    assert result["ok"] is False
    assert result["empty"] is True
    assert "numeric" in str(result.get("error", "")).lower()
    assert result["message"] == EMPTY_KNOWLEDGE_REPLY_AGENT


@pytest.mark.asyncio
async def test_search_knowledge_gateway_stringifies_int_org_id() -> None:
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        import json

        captured["json"] = json.loads(request.content.decode())
        return httpx.Response(
            200,
            json={"results": [{"id": "1", "text": "ok", "_rankingScore": 0.9}]},
        )

    transport = httpx.MockTransport(handler)
    settings = Settings(knowledge_search_url="http://kb.test")
    async with httpx.AsyncClient(transport=transport) as client:
        result = await search_knowledge_gateway(
            "What is ZIFO?",
            organization_id=1000,
            module="business",
            settings=settings,
            client=client,
        )

    assert captured["json"]["organization_id"] == "1000"
    assert isinstance(captured["json"]["organization_id"], str)
    assert result["ok"] is True
