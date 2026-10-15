from __future__ import annotations

import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app.a2a.sft_catalog import (
    export_sft_catalog,
    get_sft_agent,
    list_sft_catalog,
    restamp_conversations,
)
from app.config import get_settings

SECRET = "a2a-hub-test-secret-32-bytes-min!!"
CLIENT_ID = "hub-crm-test"
CLIENT_SECRET = "spoke-secret-test"


def _hub_headers() -> dict[str, str]:
    now = int(time.time())
    token = jwt.encode(
        {
            "iss": "worktual-hub",
            "aud": "worktual-crm-a2a",
            "sub": "hub",
            "client_id": "hub-test",
            "iat": now,
            "exp": now + 120,
        },
        SECRET,
        algorithm="HS256",
    )
    if not isinstance(token, str):
        token = token.decode("utf-8")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def a2a_client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("A2A_HUB_JWT_SECRET", SECRET)
    monkeypatch.setenv("A2A_HUB_JWT_ISSUER", "worktual-hub")
    monkeypatch.setenv("A2A_HUB_JWT_AUDIENCE", "worktual-crm-a2a")
    monkeypatch.setenv("A2A_SERVER_NAME", "worktual-crm")
    monkeypatch.setenv("A2A_SPOKE_CLIENT_ID", CLIENT_ID)
    monkeypatch.setenv("A2A_SPOKE_CLIENT_SECRET", CLIENT_SECRET)
    monkeypatch.setenv("A2A_ACCESS_TOKEN_TTL_SECONDS", "21600")
    monkeypatch.setenv("A2A_REFRESH_TOKEN_TTL_SECONDS", "5184000")
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("ACCOUNT_DATABASE_URL", "")
    get_settings.cache_clear()
    from app.a2a.clients import reset_memory

    reset_memory()
    from app.a2a.server import create_a2a_app

    with TestClient(create_a2a_app()) as client:
        yield client
    get_settings.cache_clear()


def test_sft_list_requires_auth(a2a_client):
    res = a2a_client.get("/internal/v1/agents")
    assert res.status_code == 401


def test_sft_list_accepts_internal_service_key(a2a_client):
    res = a2a_client.get(
        "/internal/v1/agents",
        headers={"x-internal-service-key": CLIENT_SECRET},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["version"] == "1.0.0"
    assert body["source"] == "nlp-agent-definitions"
    row = next(item for item in body["agents"] if item["id"] == "contact-agent")
    assert "skillCount" in row
    assert "toolCount" in row
    assert "sampleConversationCount" in row


def test_sft_rejects_wrong_internal_key(a2a_client):
    res = a2a_client.get(
        "/internal/v1/agents",
        headers={"x-internal-service-key": "nope"},
    )
    assert res.status_code == 401


def test_sft_list_and_export_cover_both_families(a2a_client):
    listed = a2a_client.get("/internal/v1/agents", headers=_hub_headers())
    assert listed.status_code == 200
    body = listed.json()
    assert body["version"] == "1.0.0"
    ids = {row["id"] for row in body["agents"]}
    assert "crm_super" in ids
    assert "contact-agent" in ids
    assert "enrich-lead" in ids
    assert "proposal-generate" in ids
    families = {row["family"] for row in body["agents"]}
    assert families == {"coworker", "job"}

    exported = a2a_client.get("/internal/v1/agents/export", headers=_hub_headers())
    assert exported.status_code == 200
    payload = exported.json()
    assert payload["agentCount"] == body["agentCount"]
    full_ids = {row["id"] for row in payload["agents"]}
    assert full_ids == ids
    contact = next(row for row in payload["agents"] if row["id"] == "contact-agent")
    assert "Role:" in contact["systemPrompt"]
    assert contact["skills"] == []
    assert contact["sampleConversations"] == []
    names = {t["name"] for t in contact["tools"]}
    assert "propose_create_contact" in names
    assert "route_to_agent" in names


def test_sft_detail_unknown_404(a2a_client):
    res = a2a_client.get("/internal/v1/agents/not-an-agent", headers=_hub_headers())
    assert res.status_code == 404
    assert res.json()["error"] == "unknown_agent"


def test_sft_crm_agent_alias_and_super_tools(a2a_client):
    res = a2a_client.get("/internal/v1/agents/crm-agent", headers=_hub_headers())
    assert res.status_code == 200
    agent = res.json()["agent"]
    assert agent["id"] == "crm_super"
    assert agent["layer"] == "super"
    assert [t["name"] for t in agent["tools"]] == ["route_to_agent"]
    assert agent["tools"][0]["kind"] == "runtime_handoff"


def test_job_agent_has_assembled_template():
    enrich = get_sft_agent("enrich-lead")
    assert enrich is not None
    assert enrich["family"] == "job"
    assert enrich["tools"] == []
    assert enrich["skills"] == []
    assert enrich["sampleConversations"] == []
    assert "Role:" in enrich["systemPrompt"]


def test_restamp_replaces_system_and_tools():
    agent = get_sft_agent("crm_super")
    assert agent is not None
    conv = {
        "agent": "crm_super",
        "id": "demo",
        "sample": {
            "messages": [
                {"role": "system", "content": "stale prompt"},
                {"role": "user", "content": "hi"},
            ],
            "tools_used": [],
        },
    }
    out = restamp_conversations([conv], [agent])
    assert out[0]["sample"]["messages"][0]["content"] == agent["systemPrompt"]
    assert out[0]["sample"]["messages"][1]["content"] == "hi"
    names = [t["function"]["name"] for t in out[0]["sample"]["tools_used"]]
    assert names == ["route_to_agent"]


def test_list_helper_matches_export_count():
    listed = list_sft_catalog()
    exported = export_sft_catalog()
    assert listed["agentCount"] == exported["agentCount"]
    assert listed["agentCount"] == len(exported["agents"])
