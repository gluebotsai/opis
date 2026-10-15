"""Internal synthetic-agent catalog APIs."""

import pytest
from app.agents.definitions import ALL_AGENT_DEFINITIONS
from fastapi.testclient import TestClient

from cc_a2a.agent_catalog import CATALOG_VERSION, clear_agent_catalog_cache
from cc_a2a.config import get_settings
from cc_a2a.main import create_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("INTERNAL_SERVICE_KEY", "test-internal-key")
    get_settings.cache_clear()
    clear_agent_catalog_cache()
    return TestClient(create_app())


def _headers() -> dict[str, str]:
    return {"x-internal-service-key": "test-internal-key"}


def test_list_agents_requires_service_key(client: TestClient) -> None:
    response = client.get("/internal/v1/agents")
    assert response.status_code == 401


def test_list_agents_returns_summaries(client: TestClient) -> None:
    response = client.get("/internal/v1/agents", headers=_headers())
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == CATALOG_VERSION
    ids = {agent["id"] for agent in body["agents"]}
    expected = {definition.name for definition in ALL_AGENT_DEFINITIONS}
    assert ids == expected
    contact = next(agent for agent in body["agents"] if agent["id"] == "contact")
    assert contact["layer"] == "executor"
    assert contact["family"] == "coworker"
    assert contact["skillCount"] >= 1
    assert contact["sampleConversationCount"] >= 1


def test_agent_detail_includes_prompt_tools_skills_samples(client: TestClient) -> None:
    response = client.get("/internal/v1/agents/contact", headers=_headers())
    assert response.status_code == 200
    agent = response.json()["agent"]
    assert "L3 Worktual co-worker" in agent["systemPrompt"]
    tool_names = {tool["name"] for tool in agent["tools"]}
    assert {
        "list_contacts",
        "count_contacts_created",
        "create_contact",
        "update_contact",
    } <= tool_names
    skill_ids = {skill["id"] for skill in agent["skills"]}
    assert "contact-create" in skill_ids
    assert agent["sampleConversations"]
    assert agent["sampleConversations"][0]["turns"]


def test_unknown_agent_is_404(client: TestClient) -> None:
    response = client.get("/internal/v1/agents/not-a-real-agent", headers=_headers())
    assert response.status_code == 404


def test_export_returns_all_agent_details(client: TestClient) -> None:
    response = client.get("/internal/v1/agents/export", headers=_headers())
    assert response.status_code == 200
    body = response.json()
    assert body["agentCount"] == len(ALL_AGENT_DEFINITIONS)
    ids = {agent["id"] for agent in body["agents"]}
    assert ids == {definition.name for definition in ALL_AGENT_DEFINITIONS}
    super_agent = next(agent for agent in body["agents"] if agent["id"] == "contact_center_super")
    assert super_agent["layer"] == "super"
    assert any(tool["name"] == "route_to_agent" for tool in super_agent["tools"])
