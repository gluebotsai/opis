from __future__ import annotations

import json
import time
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.a2a.catalog import list_spoke_skills
from app.a2a.dispatch import dispatch_skill
from app.a2a.errors import InputRequiredError, SpokeRejectError
from app.a2a.escalate import (
    matches_peer_skill,
    maybe_escalate_coworker_turn,
    maybe_escalate_to_hub,
)
from app.a2a.payload import hub_execute_text, normalize_payload
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


def _token_body(**extra: Any) -> dict[str, Any]:
    body = {
        "grant_type": "client_credentials",
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "a2a_server_name": "worktual-crm",
    }
    body.update(extra)
    return body


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


def test_card_lists_action_skills_and_excludes_reads() -> None:
    ids = {skill.id for skill in list_spoke_skills()}
    assert "contact-crud" in ids
    assert "score-lead" in ids
    assert "nurture-lead" in ids
    assert "deals" in ids
    assert "hello" not in ids
    assert "chat" not in ids
    assert "reports" not in ids


def test_unpublished_named_agent_stays_off_card() -> None:
    fake = {"score-lead": object(), "brand-new-agent": object()}
    ids = {skill.id for skill in list_spoke_skills(named_registry=fake)}
    assert "score-lead" in ids
    assert "brand-new-agent" not in ids
    assert "crm-agent" not in ids
    assert "hygiene" not in ids
    assert "assist-meeting" not in ids


def test_cdp_id_normalizes_to_contact_id() -> None:
    payload = normalize_payload(
        {"cdpId": "cdp-99", "organizationId": "1000", "skillId": "score-lead"}
    )
    assert payload["contact_id"] == "cdp-99"
    assert payload["contactId"] == "cdp-99"


def test_nested_hub_instruction_is_flattened() -> None:
    payload = normalize_payload(
        {
            "skillId": "activities",
            "organizationId": "1000",
            "source": "hub",
            "cdpId": "42",
            "instruction": {
                "actionType": "notify",
                "description": "Lead score increased from 41 to 82.",
            },
        }
    )
    assert payload["contact_id"] == "42"
    assert payload["action_type"] == "notify"
    assert payload["instruction"] == "Lead score increased from 41 to 82."
    text = hub_execute_text(payload, skill_id="activities")
    assert "will not reply" in text.lower()
    assert "Lead score increased from 41 to 82." in text
    assert "actionType" not in text or "notify" in text
    assert "{'source'" not in text


@pytest.mark.asyncio
async def test_score_lead_dispatch_uses_cdp_id_as_contact_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[tuple[str, str | None]] = []

    async def fake_score(contact_id: str, organization_id: str | None = None) -> dict[str, Any]:
        seen.append((contact_id, organization_id))
        return {"ok": True, "band": "warm", "total": 55}

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    import app.agents as agents

    monkeypatch.setitem(agents.REGISTRY, "score-lead", fake_score)
    monkeypatch.setattr(agents, "get_agent", lambda name: fake_score)
    result = await dispatch_skill(
        {"skillId": "score-lead", "organizationId": "1000", "cdpId": "cdp-1"},
        actor_id="hub:test",
        named_registry={"score-lead": fake_score},
    )
    assert result["status"] == "completed"
    assert seen == [("cdp-1", "1000")]


async def _async_b2b(_org: str, fallback: str | None = None) -> str:
    del fallback
    return "b2b"


async def _async_b2c(_org: str, fallback: str | None = None) -> str:
    del fallback
    return "b2c"


@pytest.mark.asyncio
async def test_missing_org_is_rejected() -> None:
    with pytest.raises(SpokeRejectError) as exc:
        await dispatch_skill({"skillId": "score-lead", "cdpId": "x"}, actor_id="hub:test")
    assert exc.value.code == "missing_org"


@pytest.mark.asyncio
async def test_unknown_skill_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    with pytest.raises(SpokeRejectError) as exc:
        await dispatch_skill(
            {"skillId": "not-a-skill", "organizationId": "1000"},
            actor_id="hub:test",
        )
    assert exc.value.code == "unknown_skill"


@pytest.mark.asyncio
async def test_b2c_invoices_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2c)
    with pytest.raises(SpokeRejectError) as exc:
        await dispatch_skill(
            {
                "skillId": "invoices",
                "organizationId": "1000",
                "text": "create an invoice",
            },
            actor_id="hub:test",
        )
    assert exc.value.code == "b2c_finance"


@pytest.mark.asyncio
async def test_score_lead_missing_contact_asks_hub_ai(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    with pytest.raises(InputRequiredError) as exc:
        await dispatch_skill(
            {"skillId": "score-lead", "organizationId": "1000"},
            actor_id="hub:test",
        )
    assert "contactId" in exc.value.fields


@pytest.mark.asyncio
async def test_hub_source_does_not_call_hub_client(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[Any] = []

    async def fake_send(**kwargs: Any) -> dict[str, Any]:
        called.append(kwargs)
        return {}

    monkeypatch.setenv("HUB_A2A_URL", "http://hub.example")
    get_settings.cache_clear()
    monkeypatch.setattr("app.a2a.hub_client.send_to_hub", fake_send)
    result = await maybe_escalate_to_hub(
        text="create a campaign for this lead",
        payload={"source": "hub", "organizationId": "1000"},
    )
    get_settings.cache_clear()
    assert result is None
    assert called == []


def test_peer_skill_match_ignores_local_tags() -> None:
    local = {"lead", "crm", "score-lead"}
    assert matches_peer_skill("create a campaign", ("campaign", "lead"), local)
    assert not matches_peer_skill("score this lead", ("campaign",), local)


def test_remainder_body_is_hub_query_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.a2a.hub_client import remainder_body

    monkeypatch.setenv("HUB_A2A_SPOKE_LABEL", "CRM")
    get_settings.cache_clear()
    body = remainder_body(
        text="I was charged twice this month and I want that fixed now.",
        metadata={"cdp_id": "bbbbbbbb-cccc-4ddd-8eee-ffff00000001", "organization_id": 1000, "channel": "chat"},
    )
    get_settings.cache_clear()
    assert body == {
        "cdp_id": "bbbbbbbb-cccc-4ddd-8eee-ffff00000001",
        "spoke": "CRM",
        "recent_event": {
            "channel": "chat",
            "query": "I was charged twice this month and I want that fixed now.",
        },
        "organization_id": 1000,
    }


@pytest.mark.asyncio
async def test_hub_high_risk_tool_is_auto_confirmed(monkeypatch: pytest.MonkeyPatch) -> None:
    turns: list[dict[str, Any]] = []

    async def fake_crm(**kwargs: Any) -> dict[str, Any]:
        turns.append(kwargs)
        if kwargs.get("confirmTool"):
            return {"ok": True, "assistantText": "Deleted."}
        return {
            "ok": True,
            "assistantText": "Confirm delete?",
            "toolProposals": [
                {
                    "id": "t1",
                    "name": "propose_delete_contact",
                    "args": {"contactId": "cdp-1"},
                    "risk": "high",
                }
            ],
        }

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    monkeypatch.setattr("app.a2a.dispatch.issue_hub_mcp_token", lambda **k: "mcp-token")
    import app.agents as agents

    monkeypatch.setattr(agents, "get_agent", lambda name: fake_crm)
    result = await dispatch_skill(
        {
            "skillId": "contact-crud",
            "organizationId": "1000",
            "cdpId": "cdp-1",
            "text": "delete this contact",
        },
        actor_id="hub:test",
    )
    assert result["status"] == "completed"
    assert len(turns) == 2
    assert turns[1]["confirmTool"]["name"] == "propose_delete_contact"
    assert turns[1]["actingUserId"] == "hub:test"


@pytest.mark.asyncio
async def test_hub_coworker_executes_instruction_without_follow_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    async def fake_tool(name: str, arguments: dict[str, Any] | None = None, **kwargs: Any) -> dict[str, Any]:
        calls.append((name, dict(arguments or {})))
        return {
            "ok": True,
            "assistantText": "Logged note on the contact.",
            "data": {"activityId": "act-1", "type": "note"},
        }

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    monkeypatch.setattr("app.a2a.dispatch.issue_hub_mcp_token", lambda **k: "mcp-token")
    monkeypatch.setattr("app.mcp.server.begin_agent_mcp_context", lambda **k: None)
    monkeypatch.setattr("app.mcp.server.end_agent_mcp_context", lambda: {})
    monkeypatch.setattr("app.mcp.server.call_coworker_tool", fake_tool)

    result = await dispatch_skill(
        {
            "skillId": "activities",
            "organizationId": "1000",
            "source": "hub",
            "cdpId": "42",
            "instruction": {
                "source": "hub",
                "skillId": "activities",
                "cdpId": "42",
                "actionType": "notify",
                "description": "Lead score increased from 41 to 82.",
            },
        },
        actor_id="hub:test",
    )
    assert result["status"] == "completed"
    assert result["result"]["ok"] is True
    assert calls and calls[0][0] == "propose_create_activity"
    assert calls[0][1].get("confirmed") is True
    assert "Lead score increased from 41 to 82." in str(
        result["result"].get("assistantText") or ""
    ) or result["result"].get("ok") is True


@pytest.mark.asyncio
async def test_hub_open_task_maps_to_task_draft(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen_draft: dict[str, Any] = {}

    async def fake_tool(name: str, arguments: dict[str, Any] | None = None, **kwargs: Any) -> dict[str, Any]:
        ctx = kwargs.get("context") if isinstance(kwargs.get("context"), dict) else {}
        seen_draft.update(ctx.get("draft") or {})
        return {"ok": True, "assistantText": "Logged task.", "data": {"activityId": "t1", "type": "task"}}

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    monkeypatch.setattr("app.a2a.dispatch.issue_hub_mcp_token", lambda **k: "mcp-token")
    monkeypatch.setattr("app.mcp.server.begin_agent_mcp_context", lambda **k: None)
    monkeypatch.setattr("app.mcp.server.end_agent_mcp_context", lambda: {})
    monkeypatch.setattr("app.mcp.server.call_coworker_tool", fake_tool)

    result = await dispatch_skill(
        {
            "skillId": "activities",
            "organizationId": "1000",
            "source": "hub",
            "cdpId": "42",
            "actionType": "open_task",
            "description": "Follow up on stale opportunity.",
        },
        actor_id="hub:test",
    )
    assert result["status"] == "completed"
    assert seen_draft.get("type") == "task"
    assert seen_draft.get("contactId") == "42"
    assert seen_draft.get("dueAt")
    assert result["result"]["ok"] is True


def test_agent_card_is_public_and_lists_token_endpoint(a2a_client: TestClient) -> None:
    ok = a2a_client.get("/.well-known/agent-card.json")
    assert ok.status_code == 200
    body = ok.json()
    ids = {skill["id"] for skill in body["skills"]}
    assert "score-lead" in ids
    assert "hello" not in ids
    assert body["skillVersion"] == body["version"]
    assert body["id"] == "worktual-crm"
    assert body["protocolVersion"] == "1.0"
    assert body["preferredTransport"] == "JSONRPC"
    assert body["supportsAuthenticatedExtendedCard"] is True
    flows = body["securitySchemes"]["oauth2"]["flows"]["clientCredentials"]
    assert flows["tokenUrl"].endswith("/token")
    assert flows["refreshUrl"].endswith("/token")
    assert "crm.score-lead.write" in flows["scopes"]
    score = next(s for s in body["skills"] if s["id"] == "score-lead")
    assert score["inputSchema"] == "/a2a/contracts/skills/score-lead.v1.json"
    assert score["outputSchema"] == "/a2a/contracts/skill-result.v1.json"
    assert score["security"] == [{"oauth2": ["crm.score-lead.write"]}]
    assert score["requiredArgumentKeys"] == ["organizationId", "cdpId"]
    assert "extensions" not in score
    assert "crm-agent" not in ids
    assert "hygiene" not in ids
    assert "assist-meeting" not in ids
    assert "daily-briefing" not in ids
    assert "prospect-search" not in ids
    assert "document-template" not in ids
    ext = body["capabilities"]["extensions"][0]
    assert ext["uri"] == "urn:worktual:a2a:typed-skills:v1"
    assert ext["params"]["contractSchema"] == "/a2a/contracts/worktual-envelope.v1.json"
    assert ext["params"]["resultSchema"] == "/a2a/contracts/skill-result.v1.json"
    assert "navigate" in ext["params"]["excludedCapabilities"]


def test_http_in_logs_hub_card_request_and_response(
    a2a_client: TestClient, tmp_path: Any
) -> None:
    from app.agent_log import a2a_log_path, reset_for_tests

    reset_for_tests(tmp_path)
    response = a2a_client.get("/.well-known/agent-card.json")
    assert response.status_code == 200
    rows: list[dict[str, Any]] = []
    for line in a2a_log_path().read_text(encoding="utf-8").splitlines():
        if " INFO " in line:
            rows.append(json.loads(line.split(" INFO ", 1)[-1]))
    inbound = next(row for row in rows if row.get("step") == "http_in")
    assert inbound["direction"] == "hub_to_crm"
    assert inbound["method"] == "GET"
    assert inbound["url"] == "/.well-known/agent-card.json"
    assert inbound["status"] == 200
    assert inbound["response"]["id"] == "worktual-crm"
    assert inbound["response"]["skills"]


def test_public_contract_schemas_and_oauth_metadata(a2a_client: TestClient) -> None:
    envelope = a2a_client.get("/a2a/contracts/worktual-envelope.v1.json")
    assert envelope.status_code == 200
    assert "organizationId" in envelope.json()["properties"]
    result = a2a_client.get("/a2a/contracts/skill-result.v1.json")
    assert result.status_code == 200
    skill = a2a_client.get("/a2a/contracts/skills/score-lead.v1.json")
    assert skill.status_code == 200
    required = skill.json()["required"]
    assert "organizationId" in required
    assert "cdpId" in required
    assert "contactId" not in required
    missing = a2a_client.get("/a2a/contracts/skills/not-a-skill.v1.json")
    assert missing.status_code == 404
    meta = a2a_client.get("/.well-known/oauth-authorization-server")
    assert meta.status_code == 200
    assert meta.json()["token_endpoint"].endswith("/token")


def test_extended_agent_card_requires_bearer(a2a_client: TestClient) -> None:
    denied = a2a_client.get("/a2a/agent-card/extended")
    assert denied.status_code == 401
    ok = a2a_client.get("/a2a/agent-card/extended", headers=_hub_headers())
    assert ok.status_code == 200
    body = ok.json()
    assert body["additionalInterfaces"][0]["transport"] == "JSONRPC"
    score = next(s for s in body["skills"] if s["id"] == "score-lead")
    params = score["extensions"][0]["params"]
    assert params["specialist"] == "lead"
    assert params["risk"] == "reversible_write"
    assert params["requiredArgumentKeys"] == ["organizationId", "cdpId"]
    assert params["inputSchema"] == "/a2a/contracts/skills/score-lead.v1.json"


def test_jsonrpc_extended_card_method(a2a_client: TestClient) -> None:
    response = a2a_client.post(
        "/",
        headers=_hub_headers(),
        json={"jsonrpc": "2.0", "id": "card", "method": "agent/getAuthenticatedExtendedCard"},
    )
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["supportsAuthenticatedExtendedCard"] is True
    assert any(s.get("extensions") for s in result["skills"])


def test_jsonrpc_requires_bearer(a2a_client: TestClient) -> None:
    denied = a2a_client.post("/", json={"jsonrpc": "2.0", "id": "1", "method": "tasks/get"})
    assert denied.status_code == 401


def test_access_token_carries_live_skill_ids(a2a_client: TestClient) -> None:
    card = a2a_client.get("/.well-known/agent-card.json").json()
    issued = a2a_client.post("/token", json=_token_body()).json()
    assert issued["token_type"] == "Bearer"
    assert issued["a2a_server_name"] == "worktual-crm"
    assert issued["expires_in"] == 21600
    assert issued["refresh_expires_in"] == 5184000
    assert issued["refresh_token"]
    assert issued["skillVersion"] == card["skillVersion"]
    assert "score-lead" in issued["skills"]
    assert "contact-crud" in issued["skills"]
    assert "hello" not in issued["skills"]
    claims = jwt.decode(
        issued["access_token"],
        SECRET,
        algorithms=["HS256"],
        audience="worktual-crm-a2a",
    )
    assert claims["iss"] == "worktual-crm-a2a-access"
    assert claims["skillVersion"] == issued["skillVersion"]
    assert claims["skills"] == issued["skills"]
    assert claims["a2a_server_name"] == "worktual-crm"


def test_reissued_token_picks_up_new_skill_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.a2a.access_token import issue_access_token
    from app.a2a.catalog import SpokeSkill

    monkeypatch.setenv("A2A_HUB_JWT_SECRET", SECRET)
    get_settings.cache_clear()
    first = [
        SpokeSkill(
            id="score-lead",
            name="Score Lead",
            description="score",
            kind="proactive",
            agent_name="score-lead",
            mutation_capable=True,
            tags=("crm",),
            examples=(),
            required_fields=("contactId",),
        )
    ]
    second = first + [
        SpokeSkill(
            id="brand-new-agent",
            name="Brand New",
            description="new",
            kind="proactive",
            agent_name="brand-new-agent",
            mutation_capable=False,
            tags=("crm",),
            examples=(),
            required_fields=(),
        )
    ]
    monkeypatch.setattr("app.a2a.access_token.list_spoke_skills", lambda: tuple(first))
    monkeypatch.setattr(
        "app.a2a.access_token.spoke_card_version", lambda skills=None: "ver-1"
    )
    token_a = issue_access_token(subject="hub", client_id="hub-test")
    monkeypatch.setattr("app.a2a.access_token.list_spoke_skills", lambda: tuple(second))
    monkeypatch.setattr(
        "app.a2a.access_token.spoke_card_version", lambda skills=None: "ver-2"
    )
    token_b = issue_access_token(subject="hub", client_id="hub-test")
    get_settings.cache_clear()
    assert token_a["access_token"] != token_b["access_token"]
    assert token_a["skillVersion"] == "ver-1"
    assert token_b["skillVersion"] == "ver-2"
    assert "brand-new-agent" not in token_a["skills"]
    assert "brand-new-agent" in token_b["skills"]
    assert token_a["refresh_token"] != token_b["refresh_token"]


def test_stale_access_token_rejected_on_invoke(
    a2a_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    issued = a2a_client.post("/token", json=_token_body()).json()
    monkeypatch.setattr("app.a2a.catalog.spoke_card_version", lambda skills=None: "other-hash")
    response = a2a_client.post(
        "/",
        headers={"Authorization": f"Bearer {issued['access_token']}"},
        json={
            "jsonrpc": "2.0",
            "id": "2",
            "method": "message/send",
            "params": {
                "message": {
                    "role": "user",
                    "messageId": "m2",
                    "parts": [
                        {
                            "kind": "data",
                            "data": {
                                "organizationId": "1000",
                                "skillId": "score-lead",
                                "cdpId": "cdp-1",
                            },
                        }
                    ],
                }
            },
        },
    )
    assert response.status_code == 200
    error = response.json()["error"]
    assert error["message"] == "skill_version_stale"
    assert error["data"]["skillVersion"] == "other-hash"


def test_jsonrpc_unknown_skill_rejected(
    a2a_client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    from app.agent_log import a2a_log_path, reset_for_tests

    reset_for_tests(tmp_path)
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    response = a2a_client.post(
        "/",
        headers=_hub_headers(),
        json={
            "jsonrpc": "2.0",
            "id": "1",
            "method": "message/send",
            "params": {
                "message": {
                    "role": "user",
                    "messageId": "m1",
                    "parts": [
                        {"kind": "text", "text": "do it"},
                        {
                            "kind": "data",
                            "data": {
                                "organizationId": "1000",
                                "skillId": "not-a-skill",
                            },
                        },
                    ],
                }
            },
        },
    )
    assert response.status_code == 200
    task = response.json()["result"]
    assert task["status"]["state"] == "rejected"
    rows: list[dict[str, Any]] = []
    for line in a2a_log_path().read_text(encoding="utf-8").splitlines():
        for sep in (" INFO ", " ERROR "):
            if sep in line:
                rows.append(json.loads(line.split(sep, 1)[-1]))
                break
    steps = [row["step"] for row in rows]
    assert "hub_instruct" in steps
    assert "crm_respond" in steps
    instruct = next(row for row in rows if row["step"] == "hub_instruct")
    assert instruct["hub"]["skillId"] == "not-a-skill"
    responded = next(row for row in rows if row["step"] == "crm_respond")
    assert responded["ok"] is False
    assert responded["crm"]["state"] == "rejected"
    assert "Unknown skill" in str(responded["crm"].get("error") or "")


def test_wrong_spoke_name_rejected(a2a_client: TestClient) -> None:
    response = a2a_client.post(
        "/token",
        json=_token_body(a2a_server_name="worktual-marketing"),
    )
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_request"


def test_refresh_rotates_access_and_refresh(a2a_client: TestClient) -> None:
    first = a2a_client.post("/token", json=_token_body()).json()
    second = a2a_client.post(
        "/token",
        json={
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": first["refresh_token"],
            "a2a_server_name": "worktual-crm",
        },
    ).json()
    assert second["access_token"] != first["access_token"]
    assert second["refresh_token"] != first["refresh_token"]
    reused = a2a_client.post(
        "/token",
        json={
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "refresh_token": first["refresh_token"],
            "a2a_server_name": "worktual-crm",
        },
    )
    assert reused.status_code == 401
    assert reused.json()["error"] == "invalid_grant"


class _FakeHttp:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any] | None, dict[str, str] | None]] = []
        self.timeouts: list[float | None] = []

    def __call__(self, timeout: float | None = None) -> "_FakeHttp":
        self.timeouts.append(timeout)
        return self

    async def __aenter__(self) -> "_FakeHttp":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    async def post(self, url: str, json: dict[str, Any] | None = None, headers: dict[str, str] | None = None) -> Any:
        self.calls.append(("POST", url, json, headers))

        class _Resp:
            def __init__(self, body: dict[str, Any]) -> None:
                self._body = body
                self.status_code = 200
                self.content = b"{}"

            def raise_for_status(self) -> None:
                return None

            def json(self) -> dict[str, Any]:
                return self._body

        if str(url).endswith("/token"):
            return _Resp(
                {
                    "access_token": "hub-access-live",
                    "refresh_token": "hub-refresh-live",
                    "expires_in": 21600,
                    "refresh_expires_in": 5184000,
                    "token_type": "Bearer",
                }
            )
        return _Resp({"jsonrpc": "2.0", "result": {"ok": True, "status": {"state": "completed"}}})


@pytest.mark.asyncio
async def test_crm_mints_hub_tokens_into_same_table(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    from app.a2a.clients import load_client_by_server, reset_memory
    from app.a2a.hub_client import send_to_hub
    from app.agent_log import a2a_log_path, reset_for_tests

    reset_for_tests(tmp_path)
    fake = _FakeHttp()
    monkeypatch.setenv("HUB_A2A_URL", "http://192.168.13.26:8030")
    monkeypatch.setenv("HUB_A2A_TOKEN_URL", "http://192.168.13.26:8030/token")
    monkeypatch.setenv("HUB_A2A_SERVER_NAME", "worktual-hub")
    monkeypatch.setenv("HUB_A2A_CLIENT_ID", "worktual-crm-hub")
    monkeypatch.setenv("HUB_A2A_CLIENT_SECRET", "hub-secret-test")
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("ACCOUNT_DATABASE_URL", "")
    get_settings.cache_clear()
    reset_memory()
    monkeypatch.setattr("httpx.AsyncClient", fake)
    result = await send_to_hub(
        text="create a campaign for this leftover lead",
        metadata={"organization_id": "1000", "cdp_id": "42", "channel": "chat"},
    )
    get_settings.cache_clear()
    assert result.get("ok") is True
    assert fake.calls[0][0] == "POST"
    assert fake.calls[0][1] == "http://192.168.13.26:8030/token"
    assert fake.calls[0][2]["client_id"] == "worktual-crm-hub"
    assert fake.calls[0][2]["a2a_server_name"] == "worktual-hub"
    assert fake.calls[1][1] == "http://192.168.13.26:8030/"
    assert fake.timeouts[-1] == 300.0
    assert fake.calls[1][3]["Authorization"] == "Bearer hub-access-live"
    invoke_msg = fake.calls[1][2]["params"]["message"]
    data_parts = [p["data"] for p in invoke_msg["parts"] if p.get("kind") == "data"]
    assert data_parts[0] == {
        "cdp_id": "42",
        "spoke": "CRM",
        "recent_event": {
            "channel": "chat",
            "query": "create a campaign for this leftover lead",
        },
        "organization_id": 1000,
    }
    assert "skillId" not in data_parts[0]
    assert invoke_msg["metadata"]["source"] == "crm"
    stored = await load_client_by_server("worktual-hub")
    assert stored is not None
    assert stored.access_token == "hub-access-live"
    assert stored.refresh_token == "hub-refresh-live"
    lines = [
        json.loads(line.split(" INFO ", 1)[-1])
        for line in a2a_log_path().read_text(encoding="utf-8").strip().splitlines()
        if " INFO " in line
    ]
    steps = [row["step"] for row in lines]
    assert "crm_instruct" in steps
    assert "hub_reply" in steps
    assert steps.count("http_out") == 2
    http_rows = [row for row in lines if row["step"] == "http_out"]
    token_row = next(row for row in http_rows if row["url"].endswith("/token"))
    invoke_row = next(row for row in http_rows if row["url"].endswith("/"))
    assert token_row["request"]["client_id"] == "worktual-crm-hub"
    assert token_row["request"]["client_secret"] == "[redacted]"
    assert token_row["response"]["access_token"] == "[redacted]"
    assert invoke_row["request"]["method"] == "message/send"
    assert invoke_row["request"]["params"]["message"]["parts"][0]["data"]["cdp_id"] == "42"
    assert invoke_row["response"]["result"]["status"]["state"] == "completed"
    instruct = next(row for row in lines if row["step"] == "crm_instruct")
    assert instruct["crm"]["text"] == "create a campaign for this leftover lead"
    assert instruct["crm"]["cdpId"] == "42"
    assert instruct["instruction"]["spoke"] == "CRM"
    assert instruct["instruction"]["organization_id"] == 1000
    reply = next(row for row in lines if row["step"] == "hub_reply")
    assert reply["hub"]["state"] == "completed"


@pytest.mark.asyncio
async def test_crm_reuses_live_hub_access_without_token_call(monkeypatch: pytest.MonkeyPatch) -> None:
    from datetime import datetime, timedelta, timezone

    from app.a2a.clients import persist_tokens, reset_memory
    from app.a2a.hub_client import send_to_hub

    fake = _FakeHttp()
    monkeypatch.setenv("HUB_A2A_URL", "http://192.168.13.26:8030")
    monkeypatch.setenv("HUB_A2A_SERVER_NAME", "worktual-hub")
    monkeypatch.setenv("HUB_A2A_CLIENT_ID", "worktual-crm-hub")
    monkeypatch.setenv("HUB_A2A_CLIENT_SECRET", "hub-secret-test")
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("ACCOUNT_DATABASE_URL", "")
    get_settings.cache_clear()
    reset_memory()
    now = datetime.now(timezone.utc)
    await persist_tokens(
        client_id="worktual-crm-hub",
        server_name="worktual-hub",
        access_token="already-live",
        access_expires_at=now + timedelta(hours=5),
        refresh_token="refresh-live",
        refresh_expires_at=now + timedelta(days=30),
        skill_version="v1",
        client_secret="hub-secret-test",
    )
    monkeypatch.setattr("httpx.AsyncClient", fake)
    await send_to_hub(text="create a campaign", metadata={"organization_id": "1000", "cdp_id": "42"})
    get_settings.cache_clear()
    urls = [call[1] for call in fake.calls]
    assert "http://192.168.13.26:8030/token" not in urls
    assert fake.calls[0][3]["Authorization"] == "Bearer already-live"


@pytest.mark.asyncio
async def test_hub_invoke_timeout_is_pending_not_failure(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Any
) -> None:
    import httpx
    from datetime import datetime, timedelta, timezone

    from app.a2a.clients import persist_tokens, reset_memory
    from app.a2a.hub_client import send_to_hub
    from app.agent_log import a2a_log_path, reset_for_tests

    reset_for_tests(tmp_path)

    class _TimeoutHttp(_FakeHttp):
        async def post(
            self, url: str, json: dict[str, Any] | None = None, headers: dict[str, str] | None = None
        ) -> Any:
            self.calls.append(("POST", url, json, headers))
            raise httpx.ReadTimeout("timed out")

    fake = _TimeoutHttp()
    monkeypatch.setenv("HUB_A2A_URL", "http://192.168.13.26:8030")
    monkeypatch.setenv("HUB_A2A_SERVER_NAME", "worktual-hub")
    monkeypatch.setenv("HUB_A2A_CLIENT_ID", "worktual-crm-hub")
    monkeypatch.setenv("HUB_A2A_CLIENT_SECRET", "hub-secret-test")
    monkeypatch.setenv("DATABASE_URL", "")
    monkeypatch.setenv("ACCOUNT_DATABASE_URL", "")
    get_settings.cache_clear()
    reset_memory()
    now = datetime.now(timezone.utc)
    await persist_tokens(
        client_id="worktual-crm-hub",
        server_name="worktual-hub",
        access_token="already-live",
        access_expires_at=now + timedelta(hours=5),
        refresh_token="refresh-live",
        refresh_expires_at=now + timedelta(days=30),
        skill_version="v1",
        client_secret="hub-secret-test",
    )
    monkeypatch.setattr("httpx.AsyncClient", fake)
    result = await send_to_hub(
        text="create a campaign",
        metadata={"organization_id": "1000", "cdp_id": "42"},
    )
    get_settings.cache_clear()
    assert result.get("ok") is True
    assert result.get("pending") is True
    assert result.get("status", {}).get("state") == "working"
    lines = [
        json.loads(line.split(" INFO ", 1)[-1])
        for line in a2a_log_path().read_text(encoding="utf-8").strip().splitlines()
        if " INFO " in line
    ]
    reply = next(row for row in lines if row["step"] == "hub_reply")
    assert reply["ok"] is True
    assert reply["crm"]["outcome"] == "pending"


@pytest.mark.asyncio
async def test_coworker_remainder_does_not_claim_finished_on_hub_fail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_send(**kwargs: Any) -> dict[str, Any]:
        del kwargs
        return {"status": {"state": "failed"}, "error": "unknown skillId ''"}

    monkeypatch.setenv("HUB_A2A_URL", "http://hub.example")
    get_settings.cache_clear()
    monkeypatch.setattr("app.a2a.hub_client.send_to_hub", fake_send)
    result = await maybe_escalate_coworker_turn(
        messages=[{"role": "user", "content": "create a campaign for this leftover lead"}],
        context={"organizationId": "1000", "cdpId": "42", "channel": "chat"},
        organization_id="1000",
    )
    get_settings.cache_clear()
    assert result is not None
    assert result["ok"] is False
    assert "Hub finished" not in str(result.get("assistantText") or "")
    assert "unknown skillId" in str(result.get("assistantText") or "")


@pytest.mark.asyncio
async def test_seo_content_page_does_not_escalate_campaign_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    called: list[Any] = []

    async def fake_send(**kwargs: Any) -> dict[str, Any]:
        called.append(kwargs)
        return {"status": {"state": "failed"}, "error": "unknown skillId ''"}

    monkeypatch.setenv("HUB_A2A_URL", "http://hub.example")
    get_settings.cache_clear()
    monkeypatch.setattr("app.a2a.hub_client.send_to_hub", fake_send)
    result = await maybe_escalate_coworker_turn(
        messages=[{"role": "user", "content": "Write CRM email campaign"}],
        context={
            "organizationId": "1000",
            "module": "marketing",
            "pathname": "/marketing/seo",
        },
        organization_id="1000",
    )
    get_settings.cache_clear()
    assert result is None
    assert called == []
