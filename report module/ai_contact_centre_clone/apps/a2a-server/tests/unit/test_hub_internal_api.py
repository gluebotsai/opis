"""Internal Hub delegation endpoint."""

import pytest
from fastapi.testclient import TestClient

from cc_a2a.config import get_settings
from cc_a2a.main import create_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("INTERNAL_SERVICE_KEY", "test-internal-key")
    get_settings.cache_clear()
    return TestClient(create_app())


def test_internal_delegate_requires_service_key(client: TestClient) -> None:
    response = client.post(
        "/internal/v1/hub/delegate",
        headers={"x-tenant-id": "1000"},
        json={
            "organizationId": "1000",
            "query": "Need Hub help",
            "commandId": "cmd-internal-001",
        },
    )
    assert response.status_code == 401


def test_internal_delegate_rejects_hub_source(client: TestClient) -> None:
    response = client.post(
        "/internal/v1/hub/delegate",
        headers={
            "x-internal-service-key": "test-internal-key",
            "x-tenant-id": "1000",
        },
        json={
            "organizationId": "1000",
            "query": "Should not bounce",
            "commandId": "cmd-internal-002",
            "source": "hub",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["outcome"] == "rejected"
