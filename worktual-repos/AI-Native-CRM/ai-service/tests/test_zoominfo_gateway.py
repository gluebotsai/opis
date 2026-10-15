"""Unit tests for ZoomInfo Worktual gateway helpers."""

from __future__ import annotations

import pytest

from app.integrations import zoominfo_gateway as zg


def test_uses_gateway_sentinel(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ZOOMINFO_GATEWAY_TOKEN", raising=False)
    assert zg.uses_zoominfo_gateway(zg.ZOOMINFO_GATEWAY_API_KEY) is True
    assert zg.uses_zoominfo_gateway("real-key") is False
    assert zg.is_zoominfo_gateway_configured() is False


def test_configured_when_token_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ZOOMINFO_GATEWAY_TOKEN", "tok")
    monkeypatch.setenv("ZOOMINFO_GATEWAY_URL", "http://gw.example/")
    assert zg.is_zoominfo_gateway_configured() is True
    assert zg.zoominfo_gateway_base_url() == "http://gw.example"
    assert zg.uses_zoominfo_gateway(None) is True


def test_reads_token_from_settings_when_os_env_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.config import Settings, get_settings

    monkeypatch.delenv("ZOOMINFO_GATEWAY_TOKEN", raising=False)
    get_settings.cache_clear()
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: Settings(
            zoominfo_gateway_token="from-settings",
            zoominfo_gateway_url="http://settings.example/",
        ),
    )
    assert zg.is_zoominfo_gateway_configured() is True
    assert zg.zoominfo_gateway_token() == "from-settings"
    assert zg.zoominfo_gateway_base_url() == "http://settings.example"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_call_requires_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ZOOMINFO_GATEWAY_TOKEN", raising=False)
    with pytest.raises(RuntimeError, match="ZOOMINFO_GATEWAY_TOKEN"):
        await zg.zoominfo_gateway_call(
            organization_id="1003",
            tool_name="search_contacts",
            parameters={"pageSize": 1},
        )
