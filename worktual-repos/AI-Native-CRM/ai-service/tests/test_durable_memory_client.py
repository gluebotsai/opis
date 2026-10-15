from __future__ import annotations

import json

import httpx
import pytest

from app.memory.durable import DurableMemoryClient


def test_durable_memory_allowlist_and_expiry_validation():
    valid = DurableMemoryClient.validate_write(
        {
            "scopeType": "user",
            "slotKey": "prefs",
            "slotValue": {"tone": "brief"},
            "expiresInSeconds": 3600,
        }
    )
    assert valid["expiresInSeconds"] == 3600
    with pytest.raises(ValueError):
        DurableMemoryClient.validate_write(
            {"scopeType": "user", "slotKey": "arbitrary", "slotValue": "no"}
        )
    with pytest.raises(ValueError):
        DurableMemoryClient.validate_write(
            {
                "scopeType": "user",
                "slotKey": "prefs",
                "slotValue": "no",
                "expiresInSeconds": 1,
            }
        )


@pytest.mark.asyncio
async def test_durable_memory_uses_authenticated_fastify_http_contract():
    seen = {}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen["authorization"] = request.headers.get("authorization")
        seen["path"] = request.url.path
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"ok": True, "slot": seen["body"]})

    client = DurableMemoryClient(
        base_url="http://fastify.internal",
        execution_token="signed-execution-jwt",
        transport=httpx.MockTransport(handler),
    )
    result = await client.write(
        {
            "scopeType": "user",
            "slotKey": "open_ask",
            "slotValue": {"question": "budget?"},
            "expiresInSeconds": 900,
        }
    )
    assert result["ok"] is True
    assert seen["authorization"] == "Bearer signed-execution-jwt"
    assert seen["path"] == "/api/internal/mcp/agent-memory"
    assert seen["body"]["slotKey"] == "open_ask"

