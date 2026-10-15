"""Full add-members transcript: which team → name → people → not filter / not create."""

from __future__ import annotations

from unittest.mock import patch

from app.tasks.catalog_commands import (
    _continue_add_team_members,
    start_or_continue_add_team_members,
)


def _phrase(**kwargs):
    ctx = kwargs.get("context") or {}
    # Surface kind so tests can assert we did not use create-team got_name
    return f"kind={kwargs.get('kind')}|{ctx.get('nextStep') or kwargs.get('fallback') or 'ok'}"


def _queues():
    return {
        "success": True,
        "payload": {
            "data": [{"id": "q-nlp", "queueName": "nlp", "name": "nlp"}],
        },
    }


def test_full_add_members_transcript_not_filter_not_create():
    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
        "app.tasks.chat_commands._llm_phrase", side_effect=_phrase
    ), patch("app.tools.catalog_tools.list_queues", return_value=_queues()), patch(
        "app.tools.catalog_tools.list_agents",
        return_value={
            "success": True,
            "payload": {
                "data": [
                    {"id": "u1", "name": "Deva"},
                    {"id": "u2", "name": "Fazil"},
                    {"id": "u3", "name": "raghu"},
                ]
            },
        },
    ), patch(
        "app.tools.catalog_tools.update_queue",
        return_value={"success": True, "payload": {"id": "q-nlp"}},
    ):
        ask = start_or_continue_add_team_members(
            "add members",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            intent_confirmed=True,
        )
        assert ask["team_draft"]["awaiting"] == "members_team"

        named = _continue_add_team_members(
            "nlp",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            team_draft=ask["team_draft"],
            semantic_decision={
                "action": "PROVIDE_TEAM",
                "entity_name": "nlp",
                "values": [],
            },
        )
        assert named["team_draft"]["awaiting"] == "members_names"
        assert named["team_draft"]["id"] == "q-nlp"
        assert "got_name" not in (named.get("reply") or "")
        assert "members_prompt" in (named.get("reply") or "")
        assert named.get("last_entity", {}).get("name") == "nlp"

        people = _continue_add_team_members(
            "deva, Fazil, raghu",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            team_draft=named["team_draft"],
            semantic_decision={
                "action": "PROVIDE_MEMBERS",
                "entity_name": "nlp",
                "values": ["deva", "Fazil", "raghu"],
            },
        )
        assert people.get("handled") is True
        assert people["team_draft"]["awaiting"] == "confirm"
        actions = people.get("actions") or []
        # Teams highlight filter is OK; never apply ticket/list filters from a name list.
        assert not any(
            a.get("type") == "set_filter" and a.get("module") != "teams"
            for a in actions
            if isinstance(a, dict)
        )
        assert any(
            a.get("type") == "update_team" and a.get("step") == "confirm"
            for a in actions
            if isinstance(a, dict)
        )
        assert not any(a.get("type") == "refresh_teams" for a in actions if isinstance(a, dict))

        # A follow-up remains a membership operation because semantic NLU said so.
        again = start_or_continue_add_team_members(
            "add these to nlp team",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            intent_confirmed=True,
            resolved_team_name="nlp",
        )
        assert again.get("handled") is True
        assert not any(
            a.get("type") == "create_team" and not a.get("done")
            for a in (again.get("actions") or [])
            if isinstance(a, dict)
        )
        # Should be add-members flow (ask names or update), not "name this team"
        reply = (again.get("reply") or "").lower()
        assert "what should we name" not in reply
