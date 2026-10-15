from __future__ import annotations

import json
from datetime import date
from pathlib import Path

from app.a2a.log import (
    agent_activity,
    crm_instruction,
    crm_respond,
    hub_instruction,
    hub_reply,
    log_a2a,
    log_http_exchange,
    redact,
)
from app.agent_log import a2a_log_path, reset_for_tests


def test_redact_hides_secrets() -> None:
    out = redact(
        {
            "client_id": "worktual-hub-crm",
            "client_secret": "super-secret",
            "refresh_token": "opaque",
            "access_token": "jwt",
            "grant_type": "refresh_token",
            "skillVersion": "abc",
        }
    )
    assert out["client_id"] == "worktual-hub-crm"
    assert out["client_secret"] == "[redacted]"
    assert out["refresh_token"] == "[redacted]"
    assert out["access_token"] == "[redacted]"
    assert out["skillVersion"] == "abc"


def test_hub_instruction_includes_full_instruction() -> None:
    instruct = hub_instruction(
        {
            "skillId": "score-lead",
            "organizationId": "1000",
            "cdpId": "cdp-1",
            "source": "hub",
            "text": "score this lead",
            "client_secret": "nope",
            "force": True,
        }
    )
    assert instruct["skillId"] == "score-lead"
    assert instruct["cdpId"] == "cdp-1"
    assert instruct["source"] == "hub"
    assert instruct["text"] == "score this lead"
    assert instruct["instruction"]["skillId"] == "score-lead"
    assert instruct["instruction"]["cdpId"] == "cdp-1"
    assert instruct["instruction"]["force"] is True
    assert instruct["instruction"]["client_secret"] == "[redacted]"


def test_agent_activity_summarizes_result() -> None:
    activity = agent_activity(
        {
            "status": "completed",
            "skillId": "score-lead",
            "agent": "score-lead",
            "result": {
                "score": 72,
                "band": "warm",
                "fitScore": 60,
                "intentScore": 80,
                "source": "llm",
                "rationale": "Strong intent signals.",
                "access_token": "should-hide",
            },
        }
    )
    assert activity["status"] == "completed"
    assert activity["agent"] == "score-lead"
    assert activity["result"]["score"] == 72
    assert activity["result"]["band"] == "warm"
    assert activity["result"]["access_token"] == "[redacted]"


def test_agent_activity_lifts_nested_tool_data() -> None:
    activity = agent_activity(
        {
            "status": "completed",
            "skillId": "activities",
            "agent": "crm-agent",
            "result": {
                "ok": True,
                "assistantText": "Logged note on the contact.",
                "data": {"contactId": "42", "activityId": "act-9", "type": "note"},
            },
        }
    )
    assert activity["result"]["activityId"] == "act-9"
    assert activity["result"]["contactId"] == "42"
    assert activity["result"]["type"] == "note"


def test_a2a_log_writes_hub_instruction_and_activity(tmp_path: Path) -> None:
    reset_for_tests(tmp_path)
    instruct_hub = hub_instruction(
        {
            "skillId": "score-lead",
            "organizationId": "1000",
            "cdpId": "42",
            "source": "hub",
            "client_secret": "nope",
        }
    )
    log_a2a(
        step="hub_instruct",
        hub=instruct_hub,
        instruction=instruct_hub.get("instruction"),
        crm={"actorId": "hub:worktual-hub-crm"},
    )
    activity = agent_activity(
        {
            "status": "completed",
            "skillId": "score-lead",
            "agent": "score-lead",
            "result": {"score": 55, "band": "warm", "source": "llm"},
        }
    )
    log_a2a(
        step="complete",
        ok=True,
        hub=hub_instruction(
            {
                "skillId": "score-lead",
                "organizationId": "1000",
                "cdpId": "42",
                "source": "hub",
            }
        ),
        activity=activity,
        message="Task finished successfully",
        crm={
            "outcome": "success",
            "message": "Task finished successfully",
            "taskId": "t-1",
            "skillId": "score-lead",
            "status": "completed",
            "agent": "score-lead",
            "result": activity.get("result"),
        },
    )
    path = a2a_log_path()
    assert path == tmp_path / f"a2a-{date.today().isoformat()}.log"
    lines = path.read_text(encoding="utf-8").strip().splitlines()
    instruct = json.loads(lines[0].split(" INFO ", 1)[-1])
    complete = json.loads(lines[1].split(" INFO ", 1)[-1])
    assert instruct["step"] == "hub_instruct"
    assert instruct["instruction"]["cdpId"] == "42"
    assert instruct["instruction"]["client_secret"] == "[redacted]"
    assert instruct["hub"]["instruction"]["cdpId"] == "42"
    assert "nope" not in path.read_text(encoding="utf-8")
    assert complete["step"] == "complete"
    assert complete["message"] == "Task finished successfully"
    assert complete["activity"]["result"]["score"] == 55
    assert complete["activity"]["result"]["band"] == "warm"
    assert complete["crm"]["outcome"] == "success"
    assert complete["crm"]["result"]["score"] == 55


def test_a2a_log_writes_hub_to_crm_response_pair(tmp_path: Path) -> None:
    reset_for_tests(tmp_path)
    instruct_hub = hub_instruction(
        {
            "skillId": "score-lead",
            "organizationId": "1000",
            "cdpId": "42",
            "source": "hub",
            "text": "score this lead",
        }
    )
    log_a2a(
        step="hub_instruct",
        hub=instruct_hub,
        instruction=instruct_hub.get("instruction"),
        crm={"actorId": "hub:worktual-hub-crm"},
        message="Hub instruction received",
    )
    reply = crm_respond(
        {
            "id": "task-2",
            "contextId": "ctx-2",
            "kind": "task",
            "status": {"state": "completed", "message": {"parts": [{"kind": "text", "text": "CRM spoke completed the request."}]}},
            "artifacts": [
                {
                    "parts": [
                        {
                            "kind": "data",
                            "data": {
                                "skillId": "score-lead",
                                "status": "completed",
                                "result": {"score": 55, "band": "warm"},
                            },
                        }
                    ]
                }
            ],
        }
    )
    log_a2a(
        step="crm_respond",
        ok=True,
        message="CRM response sent to Hub",
        hub=instruct_hub,
        crm=reply,
    )
    lines = a2a_log_path().read_text(encoding="utf-8").strip().splitlines()
    instruct = json.loads(lines[0].split(" INFO ", 1)[-1])
    responded = json.loads(lines[1].split(" INFO ", 1)[-1])
    assert instruct["step"] == "hub_instruct"
    assert instruct["hub"]["skillId"] == "score-lead"
    assert instruct["hub"]["cdpId"] == "42"
    assert responded["step"] == "crm_respond"
    assert responded["ok"] is True
    assert responded["crm"]["state"] == "completed"
    assert responded["crm"]["taskId"] == "task-2"
    assert responded["crm"]["artifacts"][0]["skillId"] == "score-lead"


def test_crm_instruction_and_hub_reply_for_remainder() -> None:
    sent = crm_instruction(
        {
            "cdp_id": "42",
            "spoke": "CRM",
            "recent_event": {
                "channel": "chat",
                "query": "acknowledge this remainder ping",
            },
            "organization_id": 1000,
            "client_secret": "nope",
        }
    )
    assert sent["source"] == "crm"
    assert sent["cdpId"] == "42"
    assert sent["text"] == "acknowledge this remainder ping"
    assert sent["instruction"]["client_secret"] == "[redacted]"
    assert sent["instruction"]["spoke"] == "CRM"
    reply = hub_reply(
        {
            "id": "task-1",
            "contextId": "ctx-1",
            "kind": "task",
            "status": {"state": "completed"},
            "artifacts": [
                {
                    "parts": [
                        {
                            "kind": "data",
                            "data": {
                                "skillId": "leftover-work",
                                "summary": "Logged system acknowledgment.",
                                "suggestedAgentReply": "Acknowledged remainder ping for customer 42.",
                                "customerId": "42",
                                "dispatch": [
                                    {
                                        "action_type": "service_intervention",
                                        "spoke_target": "crm",
                                        "status": "queued",
                                        "description": "Log acknowledgment note",
                                    }
                                ],
                            },
                        }
                    ]
                }
            ],
        }
    )
    assert reply["state"] == "completed"
    assert reply["taskId"] == "task-1"
    assert reply["speech"].startswith("Acknowledged remainder ping")
    assert reply["artifacts"][0]["dispatch"][0]["spoke_target"] == "crm"


def test_a2a_log_writes_crm_to_hub_pair(tmp_path: Path) -> None:
    reset_for_tests(tmp_path)
    sent = crm_instruction(
        {
            "cdp_id": "42",
            "spoke": "CRM",
            "recent_event": {"channel": "chat", "query": "leftover ping"},
            "organization_id": 1000,
        }
    )
    log_a2a(
        step="crm_instruct",
        hub={"target": "http://192.168.13.26:8030", "spoke": "CRM"},
        crm=sent,
        instruction=sent.get("instruction"),
        message="CRM remainder sent to Hub",
    )
    reply = hub_reply(
        {
            "id": "task-9",
            "status": {"state": "completed"},
            "artifacts": [
                {
                    "parts": [
                        {
                            "kind": "data",
                            "data": {
                                "suggestedAgentReply": "Acknowledged.",
                                "skillId": "leftover-work",
                            },
                        }
                    ]
                }
            ],
        }
    )
    log_a2a(
        step="hub_reply",
        ok=True,
        hub=reply,
        crm={"outcome": "completed", "message": reply.get("speech")},
        message="Hub leftover work received",
    )
    lines = a2a_log_path().read_text(encoding="utf-8").strip().splitlines()
    instruct = json.loads(lines[0].split(" INFO ", 1)[-1])
    received = json.loads(lines[1].split(" INFO ", 1)[-1])
    assert instruct["step"] == "crm_instruct"
    assert instruct["crm"]["text"] == "leftover ping"
    assert instruct["instruction"]["cdpId"] == "42"
    assert received["step"] == "hub_reply"
    assert received["hub"]["speech"] == "Acknowledged."
    assert received["crm"]["outcome"] == "completed"


def test_http_exchange_logs_request_and_response_with_secrets_redacted(tmp_path: Path) -> None:
    reset_for_tests(tmp_path)
    log_http_exchange(
        direction="hub_to_crm",
        method="POST",
        url="/",
        status=200,
        client="192.168.13.112",
        request={
            "jsonrpc": "2.0",
            "method": "message/send",
            "params": {"message": {"parts": [{"kind": "data", "data": {"skillId": "score-lead"}}]}},
            "client_secret": "nope",
        },
        response={
            "jsonrpc": "2.0",
            "result": {"status": {"state": "completed"}},
            "access_token": "jwt-secret",
        },
        ms=12.3,
    )
    log_http_exchange(
        direction="crm_to_hub",
        method="POST",
        url="http://192.168.13.112:8030/",
        status=200,
        request={"client_secret": "hub-secret", "grant_type": "client_credentials"},
        response={"access_token": "hub-jwt", "token_type": "Bearer"},
    )
    text = a2a_log_path().read_text(encoding="utf-8")
    assert "nope" not in text
    assert "jwt-secret" not in text
    assert "hub-secret" not in text
    assert "hub-jwt" not in text
    rows = [json.loads(line.split(" INFO ", 1)[-1]) for line in text.splitlines() if " INFO " in line]
    inbound = next(row for row in rows if row["step"] == "http_in")
    outbound = next(row for row in rows if row["step"] == "http_out")
    assert inbound["direction"] == "hub_to_crm"
    assert inbound["request"]["params"]["message"]["parts"][0]["data"]["skillId"] == "score-lead"
    assert inbound["request"]["client_secret"] == "[redacted]"
    assert inbound["response"]["result"]["status"]["state"] == "completed"
    assert inbound["response"]["access_token"] == "[redacted]"
    assert inbound["client"] == "192.168.13.112"
    assert outbound["direction"] == "crm_to_hub"
    assert outbound["request"]["grant_type"] == "client_credentials"
    assert outbound["request"]["client_secret"] == "[redacted]"
    assert outbound["response"]["access_token"] == "[redacted]"
    assert outbound["response"]["token_type"] == "Bearer"

