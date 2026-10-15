from __future__ import annotations

import pytest

from app.integrations import semrush_gateway as sg


def test_gateway_country_aliases() -> None:
    assert sg.gateway_country("us") == "US"
    assert sg.gateway_country("gb") == "UK"
    assert sg.gateway_country("uk") == "UK"
    assert sg.gateway_country("in") == "IN"
    assert sg.gateway_country("ae") == "AE"
    assert sg.gateway_country("france") == "US"


def test_idempotency_key_is_stable() -> None:
    a = sg.keyword_metrics_idempotency_key("1003", "SEO Tools", "US")
    b = sg.keyword_metrics_idempotency_key("1003", "seo tools", "US")
    assert a == b
    assert a.startswith("crm-semrush-")
    assert a != sg.keyword_metrics_idempotency_key("1003", "seo tools", "IN")


def test_configured_when_token_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SEMRUSH_GATEWAY_TOKEN", "tok")
    monkeypatch.setenv("SEMRUSH_GATEWAY_URL", "http://gw.example/")
    assert sg.is_semrush_gateway_configured() is True
    assert sg.semrush_gateway_base_url() == "http://gw.example"


def test_call_requires_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SEMRUSH_GATEWAY_TOKEN", raising=False)
    with pytest.raises(sg.SemrushGatewayError, match="SEMRUSH_GATEWAY_TOKEN"):
        sg.semrush_gateway_call(
            organization_id="1003",
            tool_name="keyword_metrics",
            parameters={"keyword": "seo", "country": "US"},
        )
