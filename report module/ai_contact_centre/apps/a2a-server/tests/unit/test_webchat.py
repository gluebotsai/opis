"""Webchat integration helpers."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from cc_a2a.config import A2ASettings
from cc_a2a.integrations.webchat import resolve_default_active_webchat


@pytest.mark.asyncio
async def test_resolve_default_active_webchat_returns_payload() -> None:
    settings = A2ASettings(
        CC_CORE_URL="http://cc-core.test",
        INTERNAL_SERVICE_KEY="secret",
    )
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "webchatId": "wc_796fe56fa6f94e4c81039fbe90547468",
        "channelConfigId": "1025",
        "title": "Lola",
    }

    with patch("cc_a2a.integrations.webchat.httpx.AsyncClient") as client_cls:
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get = AsyncMock(return_value=mock_response)
        client_cls.return_value = client

        result = await resolve_default_active_webchat(
            settings,
            organization_id="1003",
        )

    assert result is not None
    assert result["webchatId"] == "wc_796fe56fa6f94e4c81039fbe90547468"
    client.get.assert_awaited_once()
    call_args = client.get.await_args
    assert call_args.args[0] == "/internal/v1/organizations/1003/webchat/default"
    assert call_args.kwargs["headers"]["x-internal-service-key"] == "secret"


@pytest.mark.asyncio
async def test_resolve_default_active_webchat_not_found() -> None:
    settings = A2ASettings(CC_CORE_URL="http://cc-core.test")
    mock_response = MagicMock()
    mock_response.status_code = 404

    with patch("cc_a2a.integrations.webchat.httpx.AsyncClient") as client_cls:
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.get = AsyncMock(return_value=mock_response)
        client_cls.return_value = client

        result = await resolve_default_active_webchat(
            settings,
            organization_id="9999",
        )

    assert result is None
