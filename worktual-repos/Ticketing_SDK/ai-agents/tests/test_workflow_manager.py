"""Workflow Manager + last_entity — frozen architecture."""

from __future__ import annotations

from unittest.mock import patch

from app.messages_compat import HumanMessage

from app.agents.workflow_manager import (
    complete_specialist_handoff,
    resolve_active_workflow,
    workflow_manager_node,
)
from app.workflow_state import (
    WF_ADD_TEAM_MEMBERS,
    enrich_handler_result,
    hydrate_from_legacy_drafts,
)


def _fake_phrase(**kwargs):
    ctx = kwargs.get("context") or {}
    return str(ctx.get("nextStep") or kwargs.get("fallback") or "ok")


def test_hydrate_team_members_draft():
    snap = hydrate_from_legacy_drafts(
        escalate_draft=None,
        macro_draft=None,
        team_draft={"awaiting": "members", "name": "nlp", "id": "q1"},
        kb_draft=None,
    )
    assert snap["current_workflow"] == WF_ADD_TEAM_MEMBERS
    assert snap["current_step"] == "members"
    assert snap["last_entity"]["name"] == "nlp"
    assert snap["last_entity"]["type"] == "team"


def test_enrich_create_team_done_sets_last_entity():
    out = enrich_handler_result(
        {
            "handled": True,
            "actions": [
                {"type": "create_team", "done": True, "name": "nlp", "id": "q1"}
            ],
            "team_draft": {"awaiting": "members", "name": "nlp", "id": "q1"},
        }
    )
    assert out["last_entity"]["id"] == "q1"
    assert out["current_workflow"] == WF_ADD_TEAM_MEMBERS


def test_last_entity_add_members_not_create_team():
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_fake_phrase
    ), patch(
        "app.tasks.catalog_commands.list_queues",
        create=True,
    ):
        with patch(
            "app.tools.catalog_tools.list_queues",
            return_value={
                "success": True,
                "payload": [{"id": "q1", "queueName": "nlp", "name": "nlp"}],
            },
        ):
            hit = resolve_active_workflow(
                "add members",
                page="Teams",
                organization_id="org-1",
                user_role="admin",
                user_id="u1",
                user_name="Admin",
                escalate_draft=None,
                macro_draft=None,
                team_draft=None,
                kb_draft=None,
                parked_drafts=None,
                session_history=None,
                last_entity={"type": "team", "id": "q1", "name": "nlp"},
                workflow_decision={
                    "action": "START_ADD_TEAM_MEMBERS",
                    "intent": "UPDATE",
                    "entity_type": "team",
                    "entity_name": "nlp",
                    "values": [],
                    "confidence": 0.99,
                },
            )
    assert hit is not None
    assert hit.get("handled") is True
    assert hit.get("team_draft", {}).get("awaiting") in ("members", "members_names")
    assert hit.get("team_draft", {}).get("name") == "nlp"
    # Must not restart create-team name step
    assert hit.get("team_draft", {}).get("awaiting") != "name"


def test_workflow_manager_continues_members_draft():
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_fake_phrase
    ):
        state = {
            "messages": [HumanMessage(content="add members")],
            "organization_id": "org-1",
            "user_role": "admin",
            "user_id": "u1",
            "team_draft": {"awaiting": "members", "name": "nlp", "id": "q1"},
            "last_entity": {"type": "team", "id": "q1", "name": "nlp"},
            "page": "Teams",
            "workflow_decision": {
                "action": "CONTINUE_WORKFLOW",
                "intent": "UPDATE",
                "entity_type": "team",
                "entity_name": "nlp",
                "values": [],
                "confidence": 0.99,
            },
        }
        orch = workflow_manager_node(state)  # type: ignore[arg-type]
        out = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
    assert out.get("current_workflow") == WF_ADD_TEAM_MEMBERS
    assert out.get("team_draft", {}).get("name") == "nlp"


def test_side_quest_parks_draft_via_workflow_manager():
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase):
        out = workflow_manager_node(
            {
                "messages": [HumanMessage(content="how many open tickets?")],
                "organization_id": "org-1",
                "user_role": "admin",
                "kb_draft": {"awaiting": "category", "title": "add"},
                "page": "Knowledge Base",
                "workflow_decision": {
                    "action": "SIDE_QUEST",
                    "intent": "TICKET",
                    "entity_type": None,
                    "entity_name": None,
                    "values": [],
                    "confidence": 0.99,
                },
            }  # type: ignore[arg-type]
        )
    assert out.get("workflow_handled") is False
    assert out.get("kb_draft") is None
    assert any(
        item.get("flow") == "kb"
        and item.get("draft") == {"awaiting": "category", "title": "add"}
        for item in out.get("parked_drafts") or []
    )
