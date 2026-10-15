"""Team resolution must be driven by live list_queues rows — any org, any names."""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from app.messages_compat import HumanMessage

from app.agents.workflow_manager import (
    complete_specialist_handoff,
    workflow_manager_node,
)
from app.agents.workflow_nlu import decide_workflow_turn
from app.prompts import WORKFLOW_NLU_SYSTEM
from app.tasks.catalog_commands import (
    _continue_add_team_members,
    _available_teams_context,
    _match_queue_by_name,
    _team_labels_from_rows,
    start_or_continue_add_team_members,
)
from tests.helpers import AdvancedFakeLLM, patch_llm


def _phrase(**kwargs):
    ctx = kwargs.get("context") or {}
    # Expose DB-backed facts for assertions (not user-facing hardcoding)
    teams = ctx.get("availableTeams")
    return f"teams={teams}|unknown={ctx.get('unknownTeam')}|{ctx.get('nextStep')}"


@pytest.mark.parametrize(
    "rows,needle,expect_id",
    [
        (
            [
                {"id": "1", "queueName": "Alpha Support"},
                {"id": "2", "queueName": "Billing EU"},
            ],
            "billing eu",
            "2",
        ),
        (
            [{"id": "9", "name": "플랫폼"}],
            "플랫폼",
            "9",
        ),
        (
            [{"id": "a", "queueName": "West-Coast-L2"}],
            "west-coast-l2",
            "a",
        ),
    ],
)
def test_match_queue_by_name_is_data_driven(rows, needle, expect_id):
    hit = _match_queue_by_name(rows, needle)
    assert hit is not None
    assert str(hit.get("id")) == expect_id


def test_available_teams_context_only_from_rows():
    rows = [
        {"id": "1", "queueName": "Ops"},
        {"id": "2", "queueName": "Sales"},
        {"id": "3", "name": "Ops"},  # dedupe
    ]
    labels = _team_labels_from_rows(rows)
    assert labels == ["Ops", "Sales"]
    ctx = _available_teams_context(rows)
    assert ctx["availableTeams"] == ["Ops", "Sales"]
    assert ctx["teamCount"] == 2
    assert "Ops" in ctx["nextStep"] and "Sales" in ctx["nextStep"]
    # Must not invent unrelated sample brands
    assert "nlp" not in ctx["nextStep"].lower()


def test_ask_which_team_lists_live_db_names_only():
    live = {
        "success": True,
        "payload": {
            "data": [
                {"id": "t1", "queueName": "Night Shift"},
                {"id": "t2", "queueName": "APAC Desk"},
            ]
        },
    }
    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_queues", return_value=live
    ):
        out = start_or_continue_add_team_members(
            "add members",
            org="org-dynamic",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            intent_confirmed=True,
        )
    assert out["handled"] is True
    assert out["team_draft"]["awaiting"] == "members_team"
    reply = out.get("reply") or ""
    assert "Night Shift" in reply and "APAC Desk" in reply
    assert "nlp" not in reply.lower()


def test_unknown_team_names_live_alternatives_not_hardcoded():
    live = {
        "success": True,
        "payload": {
            "data": [
                {"id": "t1", "queueName": "Night Shift"},
                {"id": "t2", "queueName": "APAC Desk"},
            ]
        },
    }
    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_queues", return_value=live
    ):
        out = start_or_continue_add_team_members(
            "add members to ZzzMissing",
            org="org-dynamic",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            intent_confirmed=True,
            resolved_team_name="ZzzMissing",
        )
    reply = out.get("reply") or ""
    assert "ZzzMissing" in reply
    assert "Night Shift" in reply
    assert out["team_draft"]["awaiting"] == "members_team"


@pytest.mark.parametrize(
    "text",
    [
        "add memeber",
        "add memebers",
        "add membar",
        "please ad member",
    ],
)
def test_add_member_typo_is_understood_semantically(monkeypatch, text):
    patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))
    decision = decide_workflow_turn(
        {
            "organization_id": "org-dynamic",
            "page": "Teams",
            "user_role": "admin",
            "session_history": [{"role": "user", "text": text}],
        },  # type: ignore[arg-type]
        text,
    )
    assert decision["action"] == "START_ADD_TEAM_MEMBERS"
    assert decision["intent"] == "UPDATE"


def test_production_prompt_has_no_typo_mapping_examples():
    for typo in ("memeber", "memebers", "membar"):
        assert typo not in WORKFLOW_NLU_SYSTEM


def test_semantic_context_excludes_unrequested_live_payload(monkeypatch):
    llm = AdvancedFakeLLM(route_mode="heuristic")
    patch_llm(monkeypatch, llm)
    decide_workflow_turn(
        {
            "organization_id": "org-dynamic",
            "page": "Teams",
            "user_role": "admin",
            "team_draft": {
                "awaiting": "members_team",
                "available_teams": ["Night Shift"],
            },
            "data": {"unrelated_live_payload": "must-not-be-sent"},
        },  # type: ignore[arg-type]
        "which one?",
    )
    call = [record for record in llm.records if record.kind == "workflow_nlu"][-1]
    context = json.loads(call.human)
    assert "live_tool_data" not in context
    assert "must-not-be-sent" not in call.human
    drafts = context.get("drafts") if isinstance(context.get("drafts"), dict) else {}
    team = drafts.get("team_draft") if isinstance(drafts.get("team_draft"), dict) else {}
    assert team.get("available_teams") == ["Night Shift"]


def test_typo_enters_members_workflow_through_semantic_manager(monkeypatch):
    patch_llm(monkeypatch, AdvancedFakeLLM(route_mode="heuristic"))
    live = {
        "success": True,
        "payload": {"data": [{"id": "t1", "queueName": "Night Shift"}]},
    }
    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_queues", return_value=live
    ):
        state = {
            "messages": [HumanMessage(content="add memeber")],
            "organization_id": "org-dynamic",
            "user_role": "admin",
            "user_id": "u1",
            "page": "Teams",
        }
        orch = workflow_manager_node(state)  # type: ignore[arg-type]
        out = complete_specialist_handoff(state, orch)  # type: ignore[arg-type]
    assert out["workflow_decision"]["action"] == "START_ADD_TEAM_MEMBERS"
    assert out["team_draft"]["awaiting"] == "members_team"
    assert "Night Shift" in out["reply"]


def test_typo_transcript_stays_in_dynamic_team_workflow():
    live = {
        "success": True,
        "payload": {
            "data": [
                {"id": "team-a", "queueName": "Customer Operations"},
                {"id": "team-b", "queueName": "Platform Engineering"},
            ]
        },
    }
    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_queues", return_value=live
    ):
        started = start_or_continue_add_team_members(
            "add memeber",
            org="org-dynamic",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            intent_confirmed=True,
        )
        assert started and started["handled"] is True
        assert started["team_draft"]["awaiting"] == "members_team"
        assert "Customer Operations" in started["reply"]
        assert "Platform Engineering" in started["reply"]

        # A generic module answer must not navigate away or start create-team.
        generic = _continue_add_team_members(
            "team",
            org="org-dynamic",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            team_draft=started["team_draft"],
            semantic_decision={
                "action": "PROVIDE_TEAM",
                "entity_name": "team",
                "values": [],
            },
        )
        assert generic["team_draft"]["awaiting"] == "members_team"
        assert "Customer Operations" in generic["reply"]

        # A repeated misspelled request remains in the same workflow.
        repeated = _continue_add_team_members(
            "add memebers",
            org="org-dynamic",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            team_draft=generic["team_draft"],
            semantic_decision={
                "action": "CONTINUE_WORKFLOW",
                "entity_name": None,
                "values": [],
            },
        )
        assert repeated["team_draft"]["awaiting"] == "members_team"
        assert "Platform Engineering" in repeated["reply"]

        selected = _continue_add_team_members(
            "Platform Engineering",
            org="org-dynamic",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            team_draft=repeated["team_draft"],
            semantic_decision={
                "action": "PROVIDE_TEAM",
                "entity_name": "Platform Engineering",
                "values": [],
            },
        )
        assert selected["team_draft"]["awaiting"] == "members_names"
        assert selected["team_draft"]["name"] == "Platform Engineering"
        assert selected["team_draft"]["id"] == "team-b"
