from __future__ import annotations

import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import create_app
from app.mcp.rbac import can_access_module, modules_for_access
from app.mcp_main import create_mcp_app


def _claims(**overrides):
    now = int(time.time())
    return {
        "iss": "worktual-crm-api",
        "aud": "worktual-crm-mcp",
        "iat": now,
        "exp": now + 60,
        "jti": "jti-1",
        "agentName": "crm-agent",
        "executionMode": "native",
        "businessType": "b2b",
        "module": "sales",
        "surface": "list",
        "policyVersion": "crm-modules-v1",
        "organizationId": "1000",
        "actorId": "user-1",
        "role": "sales_rep",
        "runId": "run-1",
        "traceId": "trace-1",
        "idempotencyKey": "idem-1",
        **overrides,
    }


def _context(claims):
    return {
        "agentName": claims["agentName"],
        "executionMode": claims["executionMode"],
        "businessType": claims["businessType"],
        "module": claims["module"],
        "surface": claims["surface"],
        "policyVersion": claims["policyVersion"],
        "organizationId": claims["organizationId"],
        "actingUserId": claims["actorId"],
        "role": claims["role"],
        "runId": claims["runId"],
        "traceId": claims["traceId"],
        "idempotencyKey": claims["idempotencyKey"],
    }


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("MCP_EXECUTION_JWT_SECRET", "jwt-test-secret-32-bytes-minimum!!")
    get_settings.cache_clear()
    with TestClient(create_mcp_app()) as test_client:
        yield test_client
    get_settings.cache_clear()


def _headers(claims):
    token = jwt.encode(
        claims, "jwt-test-secret-32-bytes-minimum!!", algorithm="HS256"
    )
    return {"Authorization": f"Bearer {token}"}


def test_scope_mismatch_is_rejected(client: TestClient) -> None:
    claims = _claims()
    context = _context(claims)
    context["organizationId"] = "other-org"
    response = client.post(
        "/mcp/v1/tools/list",
        headers=_headers(claims),
        json={"module": "sales", "surface": "list", "context": context},
    )
    assert response.status_code == 403
    assert "organizationId" in response.json()["detail"]


def test_expired_execution_token_is_rejected(client: TestClient) -> None:
    claims = _claims(exp=int(time.time()) - 1)
    response = client.post(
        "/mcp/v1/tools/list",
        headers=_headers(claims),
        json={
            "module": "sales",
            "surface": "list",
            "context": _context(claims),
        },
    )
    assert response.status_code == 401


def test_wrong_audience_is_rejected(client: TestClient) -> None:
    claims = _claims(aud="another-service")
    response = client.post(
        "/mcp/v1/tools/list",
        headers=_headers(claims),
        json={
            "module": "sales",
            "surface": "list",
            "context": _context(claims),
        },
    )
    assert response.status_code == 401


def test_role_business_type_matrix_matches_backend_contract() -> None:
    assert not can_access_module("finance", "b2c", "admin")
    assert can_access_module("sales", "b2b", "finance")  # deep link
    assert can_access_module("finance", "b2b", "sales_rep")  # deep link
    assert not can_access_module("marketing", "b2b2c", "sales_rep")
    assert "configuration" in modules_for_access("b2b", "finance")
    assert "configuration" not in modules_for_access("b2b", "viewer")


def test_effective_catalog_does_not_expose_viewer_mutations(client: TestClient) -> None:
    claims = _claims(role="viewer")
    response = client.post(
        "/mcp/v1/tools/list",
        headers=_headers(claims),
        json={
            "module": "sales",
            "surface": "list",
            "context": _context(claims),
        },
    )
    assert response.status_code == 200
    names = {tool["name"] for tool in response.json()["tools"]}
    assert "propose_stage_change" not in names


def test_b2c_finance_catalog_is_empty(client: TestClient) -> None:
    claims = _claims(businessType="b2c", module="finance", role="admin")
    response = client.post(
        "/mcp/v1/tools/list",
        headers=_headers(claims),
        json={
            "module": "finance",
            "surface": "list",
            "context": _context(claims),
        },
    )
    assert response.status_code == 200
    assert response.json()["tools"] == []


def test_claim_tool_allowlist_only_narrows_catalog(client: TestClient) -> None:
    claims = _claims(allowedTools=["navigate"])
    response = client.post(
        "/mcp/v1/tools/list",
        headers=_headers(claims),
        json={
            "module": "sales",
            "surface": "list",
            "context": _context(claims),
        },
    )
    assert response.status_code == 200
    assert {tool["name"] for tool in response.json()["tools"]} == {"navigate"}


@pytest.mark.asyncio
async def test_production_client_fails_closed_without_http(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.mcp_client import McpClient

    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("MCP_ALLOW_TEST_INPROCESS", "true")
    get_settings.cache_clear()
    client = McpClient(base_url="", prefer_http=False)
    assert await client.list_tools(module="sales", surface="list") == []
    assert await client.call_tool("navigate", {"href": "/sales"}) is None
    get_settings.cache_clear()


def test_production_api_does_not_mount_mcp(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("MCP_MOUNT_IN_API", "true")
    get_settings.cache_clear()
    with TestClient(create_app()) as api_client:
        assert api_client.get("/mcp/v1/health").status_code == 404
    assert any(route.path == "/mcp/v1/health" for route in create_mcp_app().routes)
    get_settings.cache_clear()
