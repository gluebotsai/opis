"""HTTP MCP server routes (TestClient — no live network required)."""

from __future__ import annotations

import time
import uuid

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.mcp_main import create_mcp_app


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    get_settings.cache_clear()
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("MCP_EXECUTION_JWT_SECRET", "jwt-test-secret-32-bytes-minimum!!")
    get_settings.cache_clear()
    app = create_mcp_app()
    with TestClient(app) as c:
        yield c
    get_settings.cache_clear()


def _context(**overrides: str) -> dict[str, str]:
    base = {
        "agentName": "crm-agent",
        "executionMode": "native",
        "businessType": "b2b",
        "module": "sales",
        "surface": "list",
        "policyVersion": "crm-modules-v1",
        "organizationId": "1000",
        "actingUserId": "user-1",
        "role": "sales_rep",
        "runId": "run-1",
        "traceId": "trace-1",
        "idempotencyKey": "idem-1",
    }
    return {**base, **overrides}


def _token(context: dict[str, str], *, expires_in: int = 60) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "iss": "worktual-crm-api",
            "aud": "worktual-crm-mcp",
            "iat": now,
            "exp": now + expires_in,
            "jti": str(uuid.uuid4()),
            "actorId": context["actingUserId"],
            **{k: v for k, v in context.items() if k != "actingUserId"},
        },
        "jwt-test-secret-32-bytes-minimum!!",
        algorithm="HS256",
    )


def _headers(context: dict[str, str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(context)}"}


def test_mcp_health_requires_secret(client: TestClient) -> None:
    assert client.get("/mcp/v1/health").status_code == 401
    context = _context()
    r = client.get("/mcp/v1/health", headers=_headers(context))
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_mcp_tools_list_sales(client: TestClient) -> None:
    context = _context()
    r = client.post(
        "/mcp/v1/tools/list",
        headers=_headers(context),
        json={"module": "sales", "surface": "list", "context": context},
    )
    assert r.status_code == 200
    names = {t["name"] for t in r.json()["tools"]}
    assert "propose_stage_change" in names
    assert "propose_create_contact" not in names


def test_mcp_tools_call_stage_change_is_form_owned(client: TestClient) -> None:
    context = _context()
    r = client.post(
        "/mcp/v1/tools/call",
        headers=_headers(context),
        json={
            "name": "propose_stage_change",
            "arguments": {"dealId": "deal_x", "stage": "negotiate"},
            "context": context,
        },
    )
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "form_owned"
    assert body["ok"] is True
    assert body["proposal"]["args"]["auto"] is True


@pytest.mark.asyncio
async def test_mcp_client_inprocess_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.mcp_client import McpClient

    get_settings.cache_clear()
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("MCP_PREFER_HTTP", "false")
    monkeypatch.setenv("MCP_ALLOW_TEST_INPROCESS", "true")
    get_settings.cache_clear()
    mcp = McpClient(prefer_http=False, acting_user_id="u1", organization_id="o1")
    tools = await mcp.list_tools(module="sales", surface="list")
    assert any(t.get("name") == "propose_stage_change" for t in tools)
    get_settings.cache_clear()
