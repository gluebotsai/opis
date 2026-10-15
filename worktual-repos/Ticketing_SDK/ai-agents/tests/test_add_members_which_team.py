"""Regression: after 'which team?', bare 'nlp' must resolve as team — not a member name."""

from __future__ import annotations

from unittest.mock import patch

from app.tasks.catalog_commands import _continue_add_team_members, start_or_continue_add_team_members


def _phrase(**kwargs):
    ctx = kwargs.get("context") or {}
    return str(ctx.get("nextStep") or kwargs.get("fallback") or "ok")


def test_bare_nlp_after_which_team_resolves_team_not_member():
    """
    User: add members → bot asks which team → user: nlp
    Must look up team nlp and ask for member names — NOT treat nlp as a person.
    """
    queues = {
        "success": True,
        "payload": {
            "data": [{"id": "q-nlp", "queueName": "nlp", "name": "nlp"}],
        },
    }
    with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
        "app.tools.catalog_tools.list_queues", return_value=queues
    ):
        # Step 1: add members with no team → ask which team
        ask = start_or_continue_add_team_members(
            "add members",
            org="org-1",
            role="admin",
            user_id="u1",
            user_name="Admin",
            page="Teams",
            team_draft=None,
            intent_confirmed=True,
        )
        assert ask and ask["handled"] is True
        assert ask["team_draft"]["awaiting"] == "members_team"

        # Step 2: user replies "nlp" only
        out = _continue_add_team_members(
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

    assert out["handled"] is True
    draft = out.get("team_draft") or {}
    assert draft.get("name", "").lower() == "nlp"
    assert draft.get("id") == "q-nlp"
    assert draft.get("awaiting") == "members_names"
    # Must NOT have tried to add a member named "nlp"
    actions = out.get("actions") or []
    assert not any(
        isinstance(a, dict) and a.get("done") and "nlp" in (a.get("members") or [])
        for a in actions
    )
    reply = (out.get("reply") or "").lower()
    assert "couldn" not in reply and "could not" not in reply and "locate" not in reply


def test_queues_payload_unwraps_express_array_wrapper():
    from app.tasks.catalog_commands import _queues_payload

    # express_request wraps JSON arrays as payload: { data: [...] }
    rows = _queues_payload(
        {
            "success": True,
            "payload": {"data": [{"id": "1", "queueName": "nlp"}]},
        }
    )
    assert len(rows) == 1
    assert rows[0]["queueName"] == "nlp"
