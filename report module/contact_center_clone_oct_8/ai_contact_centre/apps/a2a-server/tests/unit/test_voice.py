"""Voice bot trigger adapter."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from cc_a2a.config import A2ASettings
from cc_a2a.integrations.voice import VoiceBotTriggerError, trigger_auto_bot_call


@pytest.mark.asyncio
async def test_trigger_auto_bot_call_posts_internal_route() -> None:
    settings = A2ASettings(
        CC_CORE_URL="http://cc-core.test",
        INTERNAL_SERVICE_KEY="secret",
    )
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "ok": True,
        "sessionId": "session-1",
        "channel": "CAMPAIGN_ACD_QA_70",
        "domainName": "1012.call.worktual.com",
        "cli": "+919003009126",
    }

    with patch("cc_a2a.integrations.voice.httpx.AsyncClient") as client_cls:
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.post = AsyncMock(return_value=mock_response)
        client_cls.return_value = client

        result = await trigger_auto_bot_call(
            settings,
            organization_id="1012",
            number="919150911820",
            data={"customer_name": "Subaz Bharathi"},
            instruction="Greet the customer.",
            command_id="cmd-1",
        )

    assert result["sessionId"] == "session-1"
    assert result["channel"] == "CAMPAIGN_ACD_QA_70"
    client.post.assert_awaited_once()
    call = client.post.await_args
    assert call.args[0] == "/internal/v1/voice/auto-bot-call"
    assert call.kwargs["headers"]["x-internal-service-key"] == "secret"
    assert call.kwargs["headers"]["x-tenant-id"] == "1012"
    assert call.kwargs["json"]["organizationId"] == "1012"
    assert call.kwargs["json"]["number"] == "919150911820"


@pytest.mark.asyncio
async def test_trigger_auto_bot_call_maps_not_found() -> None:
    settings = A2ASettings(CC_CORE_URL="http://cc-core.test", INTERNAL_SERVICE_KEY="secret")
    mock_response = MagicMock()
    mock_response.status_code = 404
    mock_response.json.return_value = {"message": "Organization domain is not configured"}

    with patch("cc_a2a.integrations.voice.httpx.AsyncClient") as client_cls:
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.__aexit__.return_value = None
        client.post = AsyncMock(return_value=mock_response)
        client_cls.return_value = client

        with pytest.raises(VoiceBotTriggerError) as raised:
            await trigger_auto_bot_call(
                settings,
                organization_id="1012",
                number="919150911820",
            )

    assert raised.value.status_code == 404
    assert raised.value.retryable is False
