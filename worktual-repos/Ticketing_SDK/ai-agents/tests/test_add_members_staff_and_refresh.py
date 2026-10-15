"""Add-members should list live staff and emit UI refresh actions."""

from __future__ import annotations

from unittest.mock import patch

from app.tasks.catalog_commands import (
    _available_staff_context,
    start_or_continue_add_team_members,
)


def _phrase(**kwargs):
    ctx = kwargs.get("context") or {}
    members = ctx.get("availableMembers")
    return f"kind={kwargs.get('kind')}|members={members}|{ctx.get('nextStep')}"


def test_available_staff_context_only_from_rows():
    ctx = _available_staff_context(
        team_name="nlp",
        staff=["Deva", "Raghu", "Fazil"],
    )
    assert ctx["availableMembers"] == ["Deva", "Raghu", "Fazil"]
    assert "Deva" in ctx["nextStep"] and "Raghu" in ctx["nextStep"] and "Fazil" in ctx["nextStep"]
    assert "enter a member name" in ctx["nextStep"]
    assert "nlp" in ctx["nextStep"] or ctx["teamName"] == "nlp"


def test_members_prompt_lists_live_staff_and_opens_form():
    queues = {
        "success": True,
        "payload": {"data": [{"id": "q-nlp", "queueName": "nlp"}]},
    }
    agents = {
        "success": True,
        "payload": {
            "data": [
                {"id": "u1", "name": "Deva"},
                {"id": "u2", "name": "Raghu"},
            ]
        },
    }
    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_queues", return_value=queues
    ), patch("app.tools.catalog_tools.list_agents", return_value=agents):
        out = start_or_continue_add_team_members(
            "add members to nlp",
            org="org-1",
            role="admin",
            user_id="admin-1",
            user_name="Admin",
            page="Teams",
            intent_confirmed=True,
            resolved_team_name="nlp",
        )
    assert out["handled"] is True
    assert out["team_draft"]["awaiting"] == "members_names"
    assert "Deva" in out["reply"] and "Raghu" in out["reply"]
    actions = out.get("actions") or []
    open_act = next(
        a for a in actions if isinstance(a, dict) and a.get("type") == "update_team"
    )
    assert open_act.get("step") == "members"
    assert open_act.get("open") is True
    assert open_act.get("availableMembers") == ["Deva", "Raghu"]


def test_members_added_asks_confirm_without_writing():
    agents = {
        "success": True,
        "payload": {"data": [{"id": "u1", "name": "Deva"}, {"id": "u2", "name": "Raghu"}]},
    }
    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_agents", return_value=agents
    ), patch(
        "app.tools.catalog_tools.update_queue",
        return_value={"success": True, "payload": {"id": "q-nlp"}},
    ) as upd:
        out = start_or_continue_add_team_members(
            "deva, raghu",
            org="org-1",
            role="admin",
            user_id="admin-1",
            user_name="Admin",
            page="Teams",
            team_draft={"awaiting": "members_names", "name": "nlp", "id": "q-nlp"},
            intent_confirmed=True,
            resolved_member_names=["deva", "raghu"],
        )
    upd.assert_not_called()
    assert out["handled"] is True
    assert out["team_draft"]["awaiting"] == "confirm"
    assert out["team_draft"]["members"] == ["Deva", "Raghu"]
    actions = out.get("actions") or []
    assert not any(a.get("type") == "refresh_teams" for a in actions if isinstance(a, dict))
    confirm = next(
        a
        for a in actions
        if isinstance(a, dict) and a.get("type") == "update_team" and a.get("step") == "confirm"
    )
    assert confirm.get("members") == ["Deva", "Raghu"]


def test_unmatched_members_keeps_draft_and_relists_staff():
    agents = {
        "success": True,
        "payload": {"data": [{"id": "u1", "name": "Deva"}, {"id": "u2", "name": "Raghu"}]},
    }
    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_agents", return_value=agents
    ), patch(
        "app.tools.catalog_tools.update_queue",
        return_value={
            "success": False,
            "message": "Could not match staff: Nobody",
            "payload": {
                "unresolved": ["Nobody"],
                "availableStaff": ["Deva", "Raghu"],
            },
        },
    ):
        out = start_or_continue_add_team_members(
            "Nobody",
            org="org-1",
            role="admin",
            user_id="admin-1",
            user_name="Admin",
            page="Teams",
            team_draft={"awaiting": "members_names", "name": "nlp", "id": "q-nlp"},
            intent_confirmed=True,
            resolved_member_names=["Nobody"],
        )
    assert out["team_draft"]["awaiting"] == "members_names"
    assert "Deva" in out["reply"]
    assert out["team_draft"] is not None


def test_strict_remove_unknown_member_keeps_draft():
    from app.tasks.catalog_commands import start_or_continue_remove_team_members

    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.update_queue"
    ) as upd:
        out = start_or_continue_remove_team_members(
            "Nobody",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            team_draft={
                "awaiting": "remove_names",
                "name": "nlp",
                "id": "q-nlp",
                "members": ["Deva", "Fazil"],
            },
        )
    assert out["team_draft"]["awaiting"] == "remove_names"
    assert "Deva" in (out.get("reply") or "")
    upd.assert_not_called()
