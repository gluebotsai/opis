"""Unit tests for Hub remote-agent client."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from cc_a2a.bridge.hub_client import (
    HubRemoteAgentClient,
    build_hub_remainder_payload,
    build_message_send_body,
)
from cc_a2a.config import A2ASettings
from cc_a2a.contracts import HubHelpRequest


def _settings() -> A2ASettings:
    return A2ASettings(
        HUB_A2A_URL="http://hub.test:8030",
        HUB_A2A_TOKEN_URL="http://hub.test:8030/token",
        HUB_A2A_CLIENT_ID="worktual-ccaas-hub",
        HUB_A2A_CLIENT_SECRET="test-secret",
        HUB_A2A_SPOKE_LABEL="CCaaS",
        HUB_A2A_SERVER_NAME="worktual-hub",
        HUB_A2A_TIMEOUT_SECONDS=5,
        HUB_A2A_POLL_INTERVAL_SECONDS=0.01,
        CC_CORE_URL="http://cc-core.test",
        INTERNAL_SERVICE_KEY="internal-key",
    )


def test_build_hub_remainder_payload_omits_cdp_when_missing() -> None:
    request = HubHelpRequest(
        organizationId="1000",
        query="Suggest next best action",
        commandId="cmd-hub-0001",
    )
    payload = build_hub_remainder_payload(_settings(), request)
    assert payload["organization_id"] == 1000
    assert payload["spoke"] == "CCaaS"
    assert payload["recent_event"]["channel"] == "chat"
    assert "cdp_id" not in payload


def test_build_message_send_body_sets_ccaas_metadata() -> None:
    request = HubHelpRequest(
        organizationId="1000",
        query="Need campaign help",
        cdpId="42",
        commandId="cmd-hub-0002",
    )
    body = build_message_send_body(_settings(), request)
    message = body["params"]["message"]
    assert message["metadata"]["source"] == "ccaas"
    data = message["parts"][0]["data"]
    assert data["cdp_id"] == "42"
    assert "skillId" not in data


@pytest.mark.asyncio
async def test_delegate_succeeds_on_completed_task(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings()
    client = HubRemoteAgentClient(settings)
    future_expiry = (datetime.now(UTC) + timedelta(hours=1)).isoformat()

    async def fake_get_token(_organization_id: str):
        return {
            "accessToken": "stored-token",
            "accessExpiresAt": future_expiry,
            "refreshToken": "refresh",
            "refreshExpiresAt": future_expiry,
        }

    async def fake_jsonrpc(**_kwargs):
        return {
            "id": "hub-task-1",
            "status": {"state": "completed"},
            "artifacts": [],
        }

    monkeypatch.setattr(client.token_store, "get_token", fake_get_token)
    monkeypatch.setattr(client, "_jsonrpc", fake_jsonrpc)

    request = HubHelpRequest(
        organizationId="1000",
        query="Cross-product suggestion",
        commandId="cmd-hub-0003",
    )
    result = await client.delegate(request)
    assert result.outcome == "succeeded"
    assert result.hubTaskId == "hub-task-1"
    assert result.hubTaskState == "completed"


@pytest.mark.asyncio
async def test_delegate_mints_token_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings()
    client = HubRemoteAgentClient(settings)
    future_expiry = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    calls = {"mint": 0, "get": 0}

    async def fake_get_token(_organization_id: str):
        calls["get"] += 1
        if calls["get"] == 1:
            return None
        return {
            "accessToken": "minted-token",
            "accessExpiresAt": future_expiry,
        }

    async def fake_upsert_token(*_args, **_kwargs):
        return {"updated": True}

    async def fake_mint(organization_id: str, *, grant_type: str, refresh_token=None):
        calls["mint"] += 1
        assert organization_id == "1000"
        assert grant_type == "client_credentials"
        return {"access_token": "minted-token", "expires_in": 3600}

    async def fake_jsonrpc(**_kwargs):
        return {
            "id": "hub-task-2",
            "status": {"state": "completed"},
        }

    monkeypatch.setattr(client.token_store, "get_token", fake_get_token)
    monkeypatch.setattr(client.token_store, "upsert_token", fake_upsert_token)
    monkeypatch.setattr(client, "_mint_token", fake_mint)
    monkeypatch.setattr(client, "_jsonrpc", fake_jsonrpc)

    request = HubHelpRequest(
        organizationId="1000",
        query="Need Hub planning",
        commandId="cmd-hub-0004",
    )
    result = await client.delegate(request)
    assert calls["mint"] == 1
    assert result.outcome == "succeeded"
