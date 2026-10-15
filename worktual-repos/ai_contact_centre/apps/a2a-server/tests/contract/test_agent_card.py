"""Agent Card and JSON-RPC contract tests."""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ["A2A_ENABLED"] = "true"
os.environ["A2A_ALLOW_DEV_AUTH"] = "true"
os.environ["A2A_PUBLIC_URL"] = "http://testserver"
os.environ["A2A_TASK_STORE"] = "memory"


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    from cc_a2a.config import get_settings
    from cc_a2a.contracts import SkillResultArtifact
    from cc_a2a.main import create_app
    from cc_a2a.store import InMemoryTaskStore

    get_settings.cache_clear()
    application = create_app()
    application.state.task_store = InMemoryTaskStore()

    async def fake_execute(envelope, caller):  # noqa: ANN001
        return SkillResultArtifact(
            commandId=envelope.commandId,
            skillId=envelope.skillId,
            outcome="succeeded",
            evidence={"mocked": True},
        )

    monkeypatch.setattr(application.state.executor, "execute", fake_execute)
    return TestClient(application)


def test_public_agent_card_lists_skills(client: TestClient) -> None:
    response = client.get("/.well-known/agent-card.json")
    assert response.status_code == 200
    card = response.json()
    assert card["protocolVersion"] == "1.0"
    ids = {skill["id"] for skill in card["skills"]}
    assert "cc.contact.list" in ids
    assert "cc.webchat.proactive-engagement.trigger" in ids
    assert "cc.voice.auto-bot-call.trigger" in ids
    assert "cc.queue.agent.add" in ids
    assert "cc.organization.read" not in ids
    assert "cc.analytics.root-cause.analyze" not in ids
    assert "navigate" not in ids
    assert card["supportsAuthenticatedExtendedCard"] is True


def test_extended_card_requires_auth(client: TestClient) -> None:
    denied = client.get("/a2a/agent-card/extended")
    assert denied.status_code == 401
    ok = client.get(
        "/a2a/agent-card/extended",
        headers={"Authorization": "Bearer dev", "X-Tenant-Id": "42"},
    )
    assert ok.status_code == 200
    skill = next(s for s in ok.json()["skills"] if s["id"] == "cc.contact.create")
    assert skill["extensions"]
    assert skill["inputSchema"].endswith(
        "/a2a/contracts/skills/cc.contact.create.v1.json"
    )
    ext = skill["extensions"][0]["params"]
    assert ext["inputSchema"].endswith("cc.contact.create.v1.json")
    assert ext["super"] == "contact_center_super"
    assert ext["domain"] == "interaction_operations_domain"
    assert ext["executor"] == "contact"


def test_skill_contract_endpoint(client: TestClient) -> None:
    path = "/a2a/contracts/skills/cc.webchat.proactive-engagement.trigger.v1.json"
    response = client.get(path)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["properties"]["skillId"]["const"] == "cc.webchat.proactive-engagement.trigger"
    args = body["properties"]["arguments"]
    assert "webchatId" not in args.get("required", [])
    assert "visitorId" in args["required"]
    assert "webchatId" in args["properties"]
    assert "text" in args["properties"]

    staffing = client.get("/a2a/contracts/skills/cc.queue.agent.add.v1.json")
    assert staffing.status_code == 200, staffing.text
    staff_args = staffing.json()["properties"]["arguments"]
    assert "queueName" in staff_args["required"]
    assert "addAgents" in staff_args["required"]
    assert "queueId" in staff_args["properties"]
    assert "agentName" in staff_args["properties"]

    missing = client.get("/a2a/contracts/skills/cc.does.not.exist.v1.json")
    assert missing.status_code == 404


def test_public_card_advertises_skill_schema_template(client: TestClient) -> None:
    card = client.get("/.well-known/agent-card.json").json()
    ext = card["capabilities"]["extensions"][0]["params"]
    assert ext["skillContractPathTemplate"] == "/a2a/contracts/skills/{skillId}.v1.json"
    webchat = next(
        s for s in card["skills"] if s["id"] == "cc.webchat.proactive-engagement.trigger"
    )
    assert webchat["inputSchema"].endswith(
        "cc.webchat.proactive-engagement.trigger.v1.json"
    )


def test_send_message_and_get_task(client: TestClient) -> None:
    headers = {
        "Authorization": "Bearer dev",
        "X-Tenant-Id": "42",
        "X-A2A-Client-Id": "hub-test",
    }
    send = client.post(
        "/",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": "1",
            "method": "message/send",
            "params": {
                "message": {
                    "messageId": "m1",
                    "role": "user",
                    "parts": [
                        {
                            "kind": "data",
                            "data": {
                                "commandId": "cmd-contract-001",
                                "skillId": "cc.contact.list",
                                "contractVersion": "1.0",
                                "organizationId": "42",
                                "arguments": {},
                            },
                        }
                    ],
                }
            },
        },
    )
    assert send.status_code == 200
    body = send.json()
    assert "result" in body, body
    task = body["result"]
    assert task["status"]["state"] == "completed"
    task_id = task["id"]

    got = client.post(
        "/",
        headers=headers,
        json={
            "jsonrpc": "2.0",
            "id": "2",
            "method": "tasks/get",
            "params": {"id": task_id, "organizationId": "42"},
        },
    )
    assert got.status_code == 200
    assert got.json()["result"]["id"] == task_id


def test_duplicate_command_id_same_payload(client: TestClient) -> None:
    headers = {
        "Authorization": "Bearer dev",
        "X-Tenant-Id": "42",
        "X-A2A-Client-Id": "hub-test",
    }
    payload = {
        "jsonrpc": "2.0",
        "id": "1",
        "method": "message/send",
        "params": {
            "message": {
                "messageId": "m1",
                "role": "user",
                "parts": [
                    {
                        "kind": "data",
                        "data": {
                            "commandId": "cmd-dup-001",
                            "skillId": "cc.contact.list",
                            "contractVersion": "1.0",
                            "organizationId": "42",
                            "arguments": {},
                        },
                    }
                ],
            }
        },
    }
    first = client.post("/", headers=headers, json=payload)
    second = client.post("/", headers=headers, json={**payload, "id": "2"})
    assert first.json()["result"]["id"] == second.json()["result"]["id"]


def test_tenant_mismatch_rejected(client: TestClient) -> None:
    response = client.post(
        "/",
        headers={
            "Authorization": "Bearer dev",
            "X-Tenant-Id": "42",
            "X-A2A-Client-Id": "hub-test",
        },
        json={
            "jsonrpc": "2.0",
            "id": "1",
            "method": "message/send",
            "params": {
                "message": {
                    "parts": [
                        {
                            "kind": "data",
                            "data": {
                                "commandId": "cmd-mismatch-001",
                                "skillId": "cc.contact.list",
                                "contractVersion": "1.0",
                                "organizationId": "99",
                                "arguments": {},
                            },
                        }
                    ]
                }
            },
        },
    )
    assert "error" in response.json()
