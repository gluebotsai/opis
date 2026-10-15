from __future__ import annotations

import pytest

from app.services.semantic_layer import (
    ASK_SEMANTIC_LAYER_TOOL,
    ask_semantic_layer,
    format_metric_value,
    normalize_results,
    successful_results,
)


def test_tool_schema_matches_gateway_contract():
    fn = ASK_SEMANTIC_LAYER_TOOL["function"]
    assert fn["name"] == "ask_semantic_layer"
    assert fn["parameters"]["required"] == ["query"]


def test_format_metric_value_units():
    assert format_metric_value("won_deal_rate", 1.0) == "100.0%"
    assert format_metric_value("pipeline_coverage_ratio", 3.333) == "3.3x"
    assert format_metric_value("open_pipeline_value", 400000) == "$400,000"
    assert format_metric_value("deal_volume", 15) == "15"
    assert format_metric_value("days_sales_outstanding", 12.0) == "12.0 days"
    assert format_metric_value("won_deal_rate", None) == "—"


def test_normalize_results_unwraps_query_keyed_payload():
    payload = {
        "what's our win rate": [
            {"ok": True, "metric_id": "won_deal_rate", "rows": [{"won_deal_rate": 1.0}]}
        ]
    }
    rows = normalize_results(payload)
    assert rows[0]["metric_id"] == "won_deal_rate"
    assert successful_results(rows)[0]["metric_id"] == "won_deal_rate"


def test_successful_results_skip_errors_and_empty_rows():
    rows = successful_results(
        [
            {"ok": True, "metric_id": "deal_volume", "rows": [{"deal_volume": 2}]},
            {"ok": False, "error": {"code": "NO_DATA", "message": "none"}},
            {"ok": True, "metric_id": "order_gmv", "rows": []},
        ]
    )
    assert [item["metric_id"] for item in rows] == ["deal_volume"]


@pytest.mark.asyncio
async def test_ask_semantic_layer_posts_organization_and_product(monkeypatch):
    captured: dict = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self):
            return [{"ok": True, "metric_id": "won_deal_rate", "rows": [{"won_deal_rate": 1}]}]

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, url, json=None, headers=None):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return FakeResponse()

    monkeypatch.setattr("app.services.semantic_layer.httpx.AsyncClient", FakeClient)
    results = await ask_semantic_layer("win rate", "1000")
    assert captured["url"].endswith("/ask")
    assert captured["json"] == {
        "query": "win rate",
        "organization_id": "1000",
        "product": "crm",
    }
    assert normalize_results(results)[0]["metric_id"] == "won_deal_rate"
