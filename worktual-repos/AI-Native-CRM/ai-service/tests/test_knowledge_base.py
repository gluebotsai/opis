"""Unit tests for Enterprise Context Layer KB client."""

from __future__ import annotations

import pytest

from app.services.knowledge_base import (
    _extract_results,
    _hit_text,
    kb_uses_retrieve,
    normalize_knowledge_base_url,
    retrieve_payload,
    resolve_kb_module,
    search_knowledge,
)


def test_normalize_retrieve_url():
    assert (
        normalize_knowledge_base_url("http://173.234.75.165:8080")
        == "http://173.234.75.165:8080/retrieve"
    )
    assert kb_uses_retrieve("http://173.234.75.165:8080/")
    assert kb_uses_retrieve("http://173.234.75.165:8080/retrieve")
    assert not kb_uses_retrieve("http://192.168.13.29:7051/search")


def test_retrieve_payload_shape():
    body = retrieve_payload(
        domain_id="example_kb",
        query="capabilities",
        limit=5,
        semantic_ratio=0.9,
        filters=["crm"],
    )
    assert body == {
        "domain_id": "example_kb",
        "query": "capabilities",
        "limit": 5,
        "semantic_ratio": 0.9,
        "filter": ["crm"],
    }


def test_resolve_kb_module_aliases():
    assert resolve_kb_module("sales") == "product"
    assert resolve_kb_module("product") == "product"
    assert resolve_kb_module("service") == "support"
    assert resolve_kb_module("support") == "support"
    assert resolve_kb_module("business") == "business"
    assert resolve_kb_module(None) == "product"


def test_hit_text_extracts_common_fields():
    assert _hit_text({"text": " alpha "}) == "alpha"
    assert _hit_text({"content": "beta"}) == "beta"
    assert _hit_text({"chunk": "gamma"}) == "gamma"
    assert _hit_text({"_formatted": {"content": "delta"}}) == "delta"
    assert _hit_text("plain") == "plain"
    assert _hit_text({}) == ""


def test_extract_results_prefers_results_key():
    assert _extract_results({"results": [1], "hits": [2]}) == [1]
    assert _extract_results({"hits": [2]}) == [2]
    assert _extract_results({}) == []


@pytest.mark.asyncio
async def test_search_knowledge_posts_new_payload(monkeypatch):
    captured: dict = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "results": [
                    {"content": "Create a lead from Contacts → New."},
                    {"text": "Required fields: name, email."},
                ]
            }

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json=None):
            captured["url"] = url
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr("app.services.knowledge_base.httpx.AsyncClient", FakeClient)

    class Settings:
        knowledge_base_url = "http://192.168.13.29:7051/search"
        kb_organization_id = "0000"
        kb_domain_id = ""
        kb_product_id = "crm"
        knowledge_base_semantic_ratio = 0.9
        knowledge_base_timeout_s = 12.0
        knowledge_base_probe_timeout_s = 3.0

    monkeypatch.setattr("app.services.knowledge_base.get_settings", lambda: Settings())

    out = await search_knowledge(
        "how to create a lead",
        module="support",
        limit=5,
        organization_id="0000",
        product_id="crm",
    )

    assert out["status"] == "success"
    assert out["module"] == "support"
    assert out["hitCount"] == 2
    assert "Create a lead" in out["context"]
    assert "Required fields" in out["context"]
    assert captured["json"] == {
        "organization_id": "0000",
        "module": "support",
        "query": "how to create a lead",
        "max_no_result": 5,
        "product_ids": ["crm"],
    }
    assert captured["url"].endswith("/search") or "7051/search" in captured["url"]


def test_kb_product_slug_maps_names_and_drops_cuids():
    from app.services.knowledge_base import kb_product_slug, resolve_kb_product_ids

    assert kb_product_slug("crm") == "crm"
    assert kb_product_slug("contact-center") == "contact-center"
    assert kb_product_slug("Worktual CCaaS") == "contact-center"
    assert kb_product_slug("AI Native CRM") == "crm"
    assert kb_product_slug("cmtlcopyi001p1a9vpooi9rs3") is None
    assert kb_product_slug("TOPSPEC PERFORMANCE CUBES") is None
    assert resolve_kb_product_ids(
        "cmtlcopyi001p1a9vpooi9rs3",
        "TOPSPEC PERFORMANCE CUBES",
        default="crm",
    ) == ["crm"]
    assert resolve_kb_product_ids(
        "cmtlcopyi001p1a9vpooi9rs3",
        "Intelligent CRM",
        default="crm",
    ) == ["crm"]
    assert resolve_kb_product_ids("contact-center", "cmtlcopyi001p1a9vpooi9rs3") == [
        "contact-center"
    ]


@pytest.mark.asyncio
async def test_search_sends_required_product_ids_not_inventory_cuids(monkeypatch):
    captured: dict = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"results": []}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            captured["timeout"] = kwargs.get("timeout")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json=None):
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr("app.services.knowledge_base.httpx.AsyncClient", FakeClient)

    class Settings:
        knowledge_base_url = "http://192.168.13.29:7051/search"
        kb_organization_id = "1003"
        kb_domain_id = ""
        kb_product_id = "crm"
        knowledge_base_semantic_ratio = 0.9
        knowledge_base_timeout_s = 12.0
        knowledge_base_probe_timeout_s = 3.0

    monkeypatch.setattr("app.services.knowledge_base.get_settings", lambda: Settings())

    out = await search_knowledge(
        "product capabilities",
        module="product",
        organization_id="1003",
        product_ids=["cmtlcopyi001p1a9vpooi9rs3"],
        timeout=3,
    )
    assert out["status"] == "success"
    assert captured["json"]["product_ids"] == ["crm"]
    assert "product_id" not in captured["json"]
    assert captured["json"]["organization_id"] == "1003"
    t = captured["timeout"]
    assert getattr(t, "read", t) == 3


@pytest.mark.asyncio
async def test_retrieve_posts_domain_id_payload(monkeypatch):
    captured: dict = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"hits": [{"text": "Indexed capability notes."}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json=None):
            captured["url"] = url
            captured["json"] = json
            return FakeResponse()

    class Settings:
        knowledge_base_url = "http://173.234.75.165:8080/"
        kb_organization_id = "1003"
        kb_domain_id = "example_kb"
        kb_product_id = "crm"
        knowledge_base_semantic_ratio = 0.9
        knowledge_base_timeout_s = 12.0
        knowledge_base_probe_timeout_s = 3.0

    monkeypatch.setattr("app.services.knowledge_base.httpx.AsyncClient", FakeClient)
    monkeypatch.setattr("app.services.knowledge_base.get_settings", lambda: Settings())

    out = await search_knowledge(
        "product capabilities",
        module="product",
        organization_id="1003",
        product_ids=["crm"],
    )
    assert out["status"] == "success"
    assert "Indexed capability notes" in out["context"]
    assert captured["url"] == "http://173.234.75.165:8080/retrieve"
    assert captured["json"] == {
        "domain_id": "example_kb",
        "query": "product capabilities",
        "limit": 5,
        "semantic_ratio": 0.9,
        "filter": ["crm"],
    }


@pytest.mark.asyncio
async def test_probe_unavailable_on_connect_timeout(monkeypatch):
    from app.services import knowledge_base as kb

    class EmptyTimeout(Exception):
        def __str__(self) -> str:
            return ""

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json=None):
            raise EmptyTimeout()

    monkeypatch.setattr(kb.httpx, "AsyncClient", FakeClient)
    out = await kb.probe_product_knowledge(organization_id="1003")
    assert out["available"] is False
    assert out["reason"] == "kb_unavailable"
    assert "temporarily unavailable" in out["message"]
    assert out["errorType"] == "EmptyTimeout"
    assert kb.is_kb_transport_failure(
        {"status": "failure", "errorType": "ConnectTimeout", "error": "ConnectTimeout: "}
    )
    assert not kb.is_kb_transport_failure(
        {"status": "success", "context": "", "hitCount": 0}
    )


@pytest.mark.asyncio
async def test_probe_available_when_search_returns_http_4xx(monkeypatch):
    from app.services import knowledge_base as kb

    async def fake_search(*_args, **_kwargs):
        return {
            "status": "failure",
            "errorType": "HTTPStatusError",
            "error": "Client error '400 Bad Request' for url 'http://kb/search'",
        }

    monkeypatch.setattr(kb, "search_knowledge", fake_search)
    out = await kb.probe_product_knowledge(organization_id="1003")
    assert out["available"] is True
    assert out.get("degraded") is True


@pytest.mark.asyncio
async def test_get_sales_knowledge_maps_to_product(monkeypatch):
    from app.services import knowledge_base as kb

    async def fake_search(query, **kwargs):
        return {"status": "success", "module": kwargs.get("module"), "query": query}

    monkeypatch.setattr(kb, "search_knowledge", fake_search)
    out = await kb.get_sales_knowledge("CRM sync")
    assert out["module"] == "product"


@pytest.mark.asyncio
async def test_search_retries_once_on_read_timeout(monkeypatch):
    from app.services import knowledge_base as kb

    posts = {"n": 0}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"results": [{"text": "ok"}]}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json=None):
            posts["n"] += 1
            if posts["n"] == 1:
                raise kb.httpx.ReadTimeout("timed out")
            return FakeResponse()

    class Settings:
        knowledge_base_url = "http://192.168.13.29:7051/search"
        kb_organization_id = "1003"
        kb_domain_id = ""
        kb_product_id = "crm"
        knowledge_base_semantic_ratio = 0.9
        knowledge_base_timeout_s = 12.0
        knowledge_base_probe_timeout_s = 3.0

    monkeypatch.setattr(kb.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(kb, "get_settings", lambda: Settings())
    out = await kb.search_knowledge(
        "product capabilities",
        module="product",
        organization_id="1003",
    )
    assert posts["n"] == 2
    assert out["status"] == "success"


@pytest.mark.asyncio
async def test_get_sales_knowledge_forwards_timeout(monkeypatch):
    from app.services import knowledge_base as kb

    captured: dict = {}

    async def fake_search(*_args, **kwargs):
        captured["timeout"] = kwargs.get("timeout")
        return {"status": "success", "module": kwargs.get("module")}

    monkeypatch.setattr(kb, "search_knowledge", fake_search)
    await kb.get_sales_knowledge("CRM", timeout=45)
    assert captured["timeout"] == 45
