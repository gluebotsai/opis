"""Tests for inbound Ticketing A2A spoke (Hub → Ticketing)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.a2a.access_token import mint_access_token, verify_access_token
from app.a2a.card import build_agent_card, build_extended_agent_card
from app.a2a.catalog import (
    EXCLUDED_CAPABILITIES,
    HUB_CARD_SKILL_IDS,
    HUB_CARD_SKILL_ORDER,
    hub_skills,
    is_hub_card_skill,
    list_skill_specs,
    resolve_hub_skill,
    skill_version,
)
from app.a2a.clients import clear_memory_clients, seed_memory_client
from app.a2a.contracts import skill_input_schema
from app.a2a.payload import flatten_message_parts, instruction_text, parse_hub_payload
from app.a2a.store import clear_memory_tasks
from app.a2a_main import app
from app.config import get_settings


@pytest.fixture(autouse=True)
def _a2a_test_env(monkeypatch):
    get_settings.cache_clear()
    monkeypatch.setenv("A2A_PUBLIC_URL", "http://192.168.13.159:8021")
    monkeypatch.setenv("A2A_SERVER_NAME", "worktual-ticketing")
    monkeypatch.setenv("A2A_SPOKE_CLIENT_ID", "worktual-hub-ticketing")
    monkeypatch.setenv("A2A_SPOKE_CLIENT_SECRET", "test-spoke-secret")
    monkeypatch.setenv("A2A_HUB_JWT_SECRET", "test-jwt-secret")
    monkeypatch.setenv("A2A_HUB_JWT_AUDIENCE", "worktual-ticketing-a2a")
    monkeypatch.setenv("A2A_ACCESS_TOKEN_ISSUER", "worktual-ticketing-a2a-access")
    clear_memory_clients()
    clear_memory_tasks()
    seed_memory_client(
        a2a_server_name="worktual-ticketing",
        client_id="worktual-hub-ticketing",
        client_secret="test-spoke-secret",
    )
    get_settings.cache_clear()
    yield
    clear_memory_clients()
    clear_memory_tasks()
    get_settings.cache_clear()


@pytest.fixture
def client():
    return TestClient(app)


def test_agent_card_lists_hub_required_skills_only():
    card = build_agent_card()
    specs = list_skill_specs()
    assert card["id"] == "worktual-ticketing"
    assert card["name"] == "Worktual Ticketing"
    assert card["url"] == "http://192.168.13.159:8021/"
    assert card["tokenUrl"] == "http://192.168.13.159:8021/token"
    assert card["supportsAuthenticatedExtendedCard"] is True
    assert card["protocolVersion"] == "1.0"
    oauth = card["securitySchemes"]["oauth2"]["flows"]["clientCredentials"]
    assert oauth["tokenUrl"] == "http://192.168.13.159:8021/oauth/token"
    assert set(oauth["scopes"]) == set(HUB_CARD_SKILL_IDS)

    ids = {s["id"] for s in card["skills"]}
    assert ids == {s["id"] for s in hub_skills()}
    assert ids == {spec.id for spec in specs}
    assert ids == set(HUB_CARD_SKILL_IDS)
    assert [s["id"] for s in card["skills"]] == list(HUB_CARD_SKILL_ORDER)
    assert len(ids) == 10
    for skill_id in HUB_CARD_SKILL_ORDER:
        assert is_hub_card_skill(skill_id)
        assert skill_id in ids
    # Unpublished catalog skills stay off the Hub card.
    assert "tk.team.members.add" not in ids
    assert "tk.proactive.run" not in ids
    assert "tk.proactive.notify.staff" not in ids
    assert "tk.ticket.escalate" not in ids
    assert "tk.ticket.manage" not in ids
    assert "tk.admin.manage" not in ids
    assert not is_hub_card_skill("tk.ticket.escalate")
    assert not is_hub_card_skill("tk.proactive.run")
    # Legacy / UI-only never on the card.
    assert "tickets" not in ids
    assert "icpa" not in ids
    assert "super-agent" not in ids
    assert "ask_hub" not in ids
    assert "tk.navigate" not in ids
    for excluded in EXCLUDED_CAPABILITIES:
        assert excluded not in ids

    assert card["skillVersion"] == skill_version(hub_skills())
    assert all(s["id"].startswith("tk.") for s in card["skills"])
    for skill in card["skills"]:
        assert skill["inputSchema"] == f"/a2a/contracts/skills/{skill['id']}.v1.json"
        assert skill["outputSchema"] == "/a2a/contracts/skill-result.v1.json"
        assert "extensions" not in skill
        assert skill_input_schema(skill["id"]) is not None

    caps = card["capabilities"]["extensions"][0]["params"]
    assert caps["contractSchema"] == "/a2a/contracts/worktual-envelope.v1.json"
    assert caps["resultSchema"] == "/a2a/contracts/skill-result.v1.json"
    assert "navigate" in caps["excludedCapabilities"]


def test_extended_agent_card_adds_skill_extensions():
    public = build_agent_card()
    extended = build_extended_agent_card()
    assert extended["additionalInterfaces"]
    assert {s["id"] for s in extended["skills"]} == {s["id"] for s in public["skills"]}
    sample = next(s for s in extended["skills"] if s["id"] == "tk.ticket.create")
    assert sample["extensions"]
    params = sample["extensions"][0]["params"]
    assert params["specialist"] == "ticket_creation_executor"
    assert params["mcpTool"] == "create_ticket"
    assert params["risk"] == "reversible_write"
    assert "issue" in params["requiredArgumentKeys"]


def test_resolve_hub_skill_tk_and_legacy_aliases():
    tk = resolve_hub_skill("tk.ticket.manage")
    assert tk is not None
    assert tk.kind == "super"
    assert tk.agent_id == "ticketing_coworker"
    assert tk.module == "tickets"

    granular = resolve_hub_skill("tk.ticket.list")
    assert granular is not None
    assert granular.agent_id == "ticket_lifecycle_executor"
    assert granular.task_id == "ticket.read.search"
    assert granular.skill_name == "ticket-read-search"

    legacy = resolve_hub_skill("tickets")
    assert legacy is not None
    assert legacy.kind == "coworker"
    assert legacy.agent_id == "tickets"

    proactive_run = resolve_hub_skill("tk.proactive.run")
    assert proactive_run is not None
    assert proactive_run.kind == "proactive"
    assert proactive_run.agent_id == "__hub_event__"

    granular_proactive = resolve_hub_skill("tk.proactive.notify.staff")
    assert granular_proactive is not None
    assert granular_proactive.agent_id == "pna"

    legacy_pna = resolve_hub_skill("pna")
    assert legacy_pna is not None
    assert legacy_pna.agent_id == "pna"

    super_tk = resolve_hub_skill("tk.super-agent.route")
    assert super_tk is not None
    assert super_tk.kind == "super"

    assert resolve_hub_skill("not-a-skill") is None


def test_token_mint_client_credentials(client):
    resp = client.post(
        "/token",
        json={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ticketing",
            "client_secret": "test-spoke-secret",
            "a2a_server_name": "worktual-ticketing",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["access_token"]
    assert data["refresh_token"]
    claims = verify_access_token(data["access_token"])
    assert claims["client_id"] == "worktual-hub-ticketing"
    assert claims["skillVersion"] == skill_version()
    assert set(claims["skills"]) == set(HUB_CARD_SKILL_IDS)


def test_oauth_token_alias_and_metadata(client):
    meta = client.get("/.well-known/oauth-authorization-server")
    assert meta.status_code == 200
    assert meta.json()["token_endpoint"].endswith("/oauth/token")

    resp = client.post(
        "/oauth/token",
        json={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ticketing",
            "client_secret": "test-spoke-secret",
            "a2a_server_name": "worktual-ticketing",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["access_token"]


def test_contracts_and_extended_card_http(client):
    env = client.get("/a2a/contracts/worktual-envelope.v1.json")
    assert env.status_code == 200
    assert env.json()["title"] == "WorktualA2AEnvelope"

    result = client.get("/a2a/contracts/skill-result.v1.json")
    assert result.status_code == 200
    assert result.json()["title"] == "SkillResultArtifact"

    skill = client.get("/a2a/contracts/skills/tk.ticket.create.v1.json")
    assert skill.status_code == 200
    assert "issue" in skill.json()["required"]

    unpublished = client.get("/a2a/contracts/skills/tk.ticket.escalate.v1.json")
    assert unpublished.status_code == 404
    assert unpublished.json()["error"] == "not_found"

    unknown = client.get("/a2a/contracts/skills/not-a-skill.v1.json")
    assert unknown.status_code == 404

    assert client.get("/a2a/agent-card/extended").status_code == 401

    token_resp = client.post(
        "/oauth/token",
        json={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ticketing",
            "client_secret": "test-spoke-secret",
        },
    )
    access = token_resp.json()["access_token"]
    ext = client.get(
        "/a2a/agent-card/extended",
        headers={"Authorization": f"Bearer {access}"},
    )
    assert ext.status_code == 200
    body = ext.json()
    assert body["skills"][0]["extensions"]

    rpc = client.post(
        "/",
        headers={"Authorization": f"Bearer {access}"},
        json={
            "jsonrpc": "2.0",
            "id": "card-1",
            "method": "agent/getAuthenticatedExtendedCard",
            "params": {},
        },
    )
    assert rpc.status_code == 200
    assert rpc.json()["result"]["supportsAuthenticatedExtendedCard"] is True


def test_skill_version_stale_rejected(client):
    access, _ = mint_access_token(
        client_id="worktual-hub-ticketing",
        a2a_server_name="worktual-ticketing",
    )
    with patch("app.a2a.access_token.skill_version", return_value="deadbeef00000000"):
        resp = client.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": "1",
                "method": "message/send",
                "params": {"message": {"parts": []}},
            },
            headers={"Authorization": f"Bearer {access}"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["error"]["code"] == -32010
    assert body["error"]["message"] == "skill_version_stale"


def test_payload_flatten_and_parse():
    message = {
        "role": "user",
        "messageId": "msg-1",
        "parts": [
            {
                "kind": "data",
                "data": {
                    "source": "hub",
                    "organizationId": "1000",
                    "skillId": "general",
                    "cdpId": "cdp-uuid-1",
                    "instruction": {"description": "List open tickets"},
                },
            }
        ],
    }
    flat = flatten_message_parts(message)
    parsed = parse_hub_payload(flat)
    assert parsed["organization_id"] == "1000"
    assert parsed["skill_id"] == "general"
    assert parsed["cdp_id"] == "cdp-uuid-1"
    assert instruction_text(parsed["instruction"]) == "List open tickets"


def test_tk_skill_coworker_dispatch(client):
    token_resp = client.post(
        "/token",
        json={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ticketing",
            "client_secret": "test-spoke-secret",
            "a2a_server_name": "worktual-ticketing",
        },
    )
    access = token_resp.json()["access_token"]
    mock_result = MagicMock()
    mock_result.agent = "tickets"
    mock_result.assistant_text = "Listed"
    mock_result.error = None
    mock_result.tool_proposals = []
    mock_result.to_agent_turn_envelope.return_value = {
        "assistantText": "Listed",
        "toolProposals": [],
    }
    captured: dict = {}

    def _fake_run(request):
        captured["request"] = request
        return mock_result

    with patch("app.runtime.orchestrator.run_native_turn", side_effect=_fake_run):
        resp = client.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": "tk1",
                "method": "message/send",
                "params": {
                    "message": {
                        "messageId": "mtk1",
                        "parts": [
                            {
                                "kind": "data",
                                "data": {
                                    "source": "hub",
                                    "organizationId": "1000",
                                    "skillId": "tk.ticket.list",
                                    "instruction": "Show open tickets",
                                },
                            }
                        ],
                    }
                },
            },
            headers={"Authorization": f"Bearer {access}"},
        )
    assert resp.status_code == 200
    req = captured["request"]
    assert req.module == "tickets"
    assert req.session_memory["hubSkillId"] == "tk.ticket.list"
    assert "[Hub skill: tk.ticket.list]" in req.message


def test_tk_proactive_inbound_capture_dispatch(client):
    token_resp = client.post(
        "/token",
        json={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ticketing",
            "client_secret": "test-spoke-secret",
            "a2a_server_name": "worktual-ticketing",
        },
    )
    access = token_resp.json()["access_token"]

    proposal = MagicMock()
    proposal.agent_id = "tcaa"
    proposal.tool_name = "create_ticket"
    proposal.tool_args = {
        "customerName": "Jane",
        "issue": "VPN down",
        "confirmed": True,
    }
    proposal.summary = "Capture inbound ticket"
    proposal.confidence = 1.0
    proposal.payload = {}
    proposal.organization_id = "1000"
    proposal.ticket_id = None
    proposal.ticket_number = None
    proposal.event_id = "mtkp"
    proposal.event_type = "inbound.message"
    proposal.risk_level = "low"
    proposal.output_type = "ACTION_PROPOSAL"

    with patch("app.proactive.tcaa.propose", return_value=proposal):
        with patch(
            "app.proactive.runtime.execute_tool",
            return_value={"success": True},
        ) as exec_mock:
            resp = client.post(
                "/",
                json={
                    "jsonrpc": "2.0",
                    "id": "tkp",
                    "method": "message/send",
                    "params": {
                        "message": {
                            "messageId": "mtkp",
                            "parts": [
                                {
                                    "kind": "data",
                                    "data": {
                                        "source": "hub",
                                        "organizationId": "1000",
                                        "skillId": "tk.proactive.inbound.capture",
                                        "instruction": {
                                            "text": "VPN is not connecting",
                                            "customerName": "Jane",
                                        },
                                    },
                                }
                            ],
                        }
                    },
                },
                headers={"Authorization": f"Bearer {access}"},
            )
    assert resp.status_code == 200
    exec_mock.assert_called_once()
    body = resp.json()["result"]["artifacts"][0]["parts"][1]["data"]
    assert body["skill_id"] == "tk.proactive.inbound.capture"
    assert body["agent_id"] == "tcaa"


def test_coworker_dispatch_uses_hub_actor(client):
    token_resp = client.post(
        "/token",
        json={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ticketing",
            "client_secret": "test-spoke-secret",
            "a2a_server_name": "worktual-ticketing",
        },
    )
    access = token_resp.json()["access_token"]
    mock_result = MagicMock()
    mock_result.agent = "general"
    mock_result.assistant_text = "Done"
    mock_result.error = None
    mock_result.tool_proposals = []
    mock_result.to_agent_turn_envelope.return_value = {
        "assistantText": "Done",
        "toolProposals": [],
    }

    captured: dict = {}

    def _fake_run(request):
        captured["request"] = request
        return mock_result

    with patch("app.runtime.orchestrator.run_native_turn", side_effect=_fake_run):
        resp = client.post(
            "/",
            json={
                "jsonrpc": "2.0",
                "id": "2",
                "method": "message/send",
                "params": {
                    "message": {
                        "messageId": "m2",
                        "parts": [
                            {
                                "kind": "data",
                                "data": {
                                    "source": "hub",
                                    "organizationId": "1000",
                                    "skillId": "tk.ticket.list",
                                    "instruction": "List open tickets",
                                },
                            }
                        ],
                    }
                },
            },
            headers={"Authorization": f"Bearer {access}"},
        )
    assert resp.status_code == 200
    result = resp.json()["result"]
    assert result["status"]["state"] == "completed"
    req = captured["request"]
    assert req.actor.user_id == "hub:worktual-hub-ticketing"
    assert req.actor.user_role == "admin"
    assert req.session_memory["source"] == "hub"
    assert req.session_memory["hubExecute"] is True


def test_unpublished_skill_ids_rejected_on_invoke(client):
    token_resp = client.post(
        "/token",
        json={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ticketing",
            "client_secret": "test-spoke-secret",
            "a2a_server_name": "worktual-ticketing",
        },
    )
    access = token_resp.json()["access_token"]

    with patch("app.runtime.orchestrator.run_native_turn") as run_mock:
        with patch("app.proactive.pna.propose") as propose_mock:
            resp = client.post(
                "/",
                json={
                    "jsonrpc": "2.0",
                    "id": "rej1",
                    "method": "message/send",
                    "params": {
                        "message": {
                            "messageId": "mrej1",
                            "parts": [
                                {
                                    "kind": "data",
                                    "data": {
                                        "source": "hub",
                                        "organizationId": "1000",
                                        "skillId": "tk.ticket.escalate",
                                        "instruction": "Escalate ticket #42",
                                    },
                                }
                            ],
                        }
                    },
                },
                headers={"Authorization": f"Bearer {access}"},
            )
    assert resp.status_code == 200
    result = resp.json()["result"]
    assert result["status"] == "error"
    assert result["message"] == "Unknown skillId: tk.ticket.escalate"
    run_mock.assert_not_called()
    propose_mock.assert_not_called()


def test_tk_proactive_notify_staff_rejected(client):
    token_resp = client.post(
        "/token",
        json={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ticketing",
            "client_secret": "test-spoke-secret",
            "a2a_server_name": "worktual-ticketing",
        },
    )
    access = token_resp.json()["access_token"]

    with patch("app.proactive.pna.propose") as propose_mock:
        with patch("app.proactive.runtime.execute_tool") as exec_mock:
            resp = client.post(
                "/",
                json={
                    "jsonrpc": "2.0",
                    "id": "tk3",
                    "method": "message/send",
                    "params": {
                        "message": {
                            "messageId": "mtk3",
                            "parts": [
                                {
                                    "kind": "data",
                                    "data": {
                                        "source": "hub",
                                        "organizationId": "1000",
                                        "skillId": "tk.proactive.notify.staff",
                                        "instruction": {
                                            "description": "Ping the team",
                                            "user_id": "1",
                                            "title": "Hi",
                                            "message": "Test",
                                        },
                                    },
                                }
                            ],
                        }
                    },
                },
                headers={"Authorization": f"Bearer {access}"},
            )
    assert resp.status_code == 200
    result = resp.json()["result"]
    assert result["status"] == "error"
    assert result["message"] == "Unknown skillId: tk.proactive.notify.staff"
    propose_mock.assert_not_called()
    exec_mock.assert_not_called()


def test_legacy_pna_skill_id_rejected(client):
    token_resp = client.post(
        "/token",
        json={
            "grant_type": "client_credentials",
            "client_id": "worktual-hub-ticketing",
            "client_secret": "test-spoke-secret",
            "a2a_server_name": "worktual-ticketing",
        },
    )
    access = token_resp.json()["access_token"]

    with patch("app.proactive.pna.propose") as propose_mock:
        with patch("app.proactive.runtime.execute_tool") as exec_mock:
            resp = client.post(
                "/",
                json={
                    "jsonrpc": "2.0",
                    "id": "3",
                    "method": "message/send",
                    "params": {
                        "message": {
                            "messageId": "m3",
                            "parts": [
                                {
                                    "kind": "data",
                                    "data": {
                                        "source": "hub",
                                        "organizationId": "1000",
                                        "skillId": "pna",
                                        "instruction": {
                                            "description": "Ping the team",
                                            "user_id": "1",
                                            "title": "Hi",
                                            "message": "Test",
                                        },
                                    },
                                }
                            ],
                        }
                    },
                },
                headers={"Authorization": f"Bearer {access}"},
            )
    assert resp.status_code == 200
    result = resp.json()["result"]
    assert result["status"] == "error"
    assert result["message"] == "Unknown skillId: pna"
    propose_mock.assert_not_called()
    exec_mock.assert_not_called()


def test_ask_hub_blocked_for_hub_actor():
    from app.tools.catalog_tools import ask_hub
    from app.tools.express_client import ToolActor, tool_actor_scope

    actor = ToolActor(
        user_id="hub:worktual-hub-ticketing",
        organization_id="1000",
        user_role="admin",
    )
    with tool_actor_scope(actor):
        out = ask_hub(
            query="campaign idea",
            cdp_id="cdp-1",
            organization_id="1000",
        )
    assert out["success"] is False
    assert out.get("payload", {}).get("code") == "HUB_NO_BOUNCE"


def test_health_endpoint(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["service"] == "ticketing-a2a"


def test_token_wrong_server_name_logs_crm_style(client, tmp_path, monkeypatch):
    from app.a2a import log as a2a_log

    monkeypatch.setattr(a2a_log, "LOG_DIR", tmp_path)
    resp = client.post(
        "/token",
        json={
            "grant_type": "client_credentials",
            "client_id": "hub-crm-test",
            "client_secret": "x",
            "a2a_server_name": "worktual-marketing",
        },
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["error"] == "invalid_request"
    assert "worktual-ticketing" in body["message"]
    logged = tmp_path.joinpath("a2a-" + __import__("datetime").date.today().isoformat() + ".json").read_text(
        encoding="utf-8"
    )
    last = json.loads(logged.strip().splitlines()[-1])
    assert last["agent"] == "a2a-spoke"
    assert last["step"] == "token"
    assert last["channel"] == "a2a"
    assert last["ok"] is False
    assert last["hub"]["client_id"] == "hub-crm-test"
    assert last["hub"]["a2a_server_name"] == "worktual-marketing"
    assert last["ticketing"]["http"] == 400
    assert last["ticketing"]["error"] == "invalid_request"


def test_token_invalid_refresh_logs_grant_error(client, tmp_path, monkeypatch):
    from app.a2a import log as a2a_log

    monkeypatch.setattr(a2a_log, "LOG_DIR", tmp_path)
    resp = client.post(
        "/token",
        json={
            "grant_type": "refresh_token",
            "client_id": "worktual-hub-ticketing",
            "client_secret": "test-spoke-secret",
            "refresh_token": "not-a-real-refresh",
        },
    )
    assert resp.status_code == 401
    assert resp.json()["error"] == "invalid_grant"
    assert resp.json()["message"] == "Invalid refresh_token"
    logged = tmp_path.joinpath("a2a-" + __import__("datetime").date.today().isoformat() + ".json").read_text(
        encoding="utf-8"
    )
    last = json.loads(logged.strip().splitlines()[-1])
    assert last["ok"] is False
    assert last["hub"]["grant_type"] == "refresh_token"
    assert last["ticketing"]["error"] == "invalid_grant"


def test_log_event_redacts_secrets():
    from app.a2a.log import log_event

    payload = log_event(
        "token",
        ok=True,
        hub={"client_id": "hub-x", "client_secret": "super-secret"},
        ticketing={"access_token": "jwt", "stored": "accounts.a2a_spoke_clients"},
    )
    assert payload["ticketing"]["access_token"] == "***"
    assert payload["hub"]["client_secret"] == "***"
    assert payload["ticketing"]["stored"] == "accounts.a2a_spoke_clients"
