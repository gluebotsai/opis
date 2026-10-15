"""
Layer 8 — Chaos: Express RETRYABLE/timeout mid-workflow; no silent fake success.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.contracts import tool_err
from app.tasks.catalog_commands import _apply_add_team_members, continue_team_draft
from app.tools.catalog_tools import create_queue, update_queue
from app.tools.express_client import ToolActor, tool_actor_scope


def _phrase(**kwargs):
    return str((kwargs.get("context") or {}).get("nextStep") or kwargs.get("fallback") or "err")


@pytest.mark.chaos
class TestExpressFailureMidWorkflow:
    def test_create_queue_timeout_no_done_action(self):
        with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
            "app.tools.catalog_tools.create_queue",
            return_value=tool_err("TIMEOUT", "upstream timeout", http_status=504),
        ):
            out = continue_team_draft(
                "skip",
                org="org-1",
                role="admin",
                user_id="u1",
                user_name="A",
                page="Teams",
                team_draft={
                    "awaiting": "create_members",
                    "name": "nlp",
                    "description": "routes nlp work for the org",
                },
            )
        actions = out.get("actions") or []
        assert not any(
            isinstance(a, dict) and a.get("type") == "create_team" and a.get("done")
            for a in actions
        )
        # Draft retained or UI fallback — never silent invent id
        if out.get("team_draft") is None:
            # UI save fallback path must not invent DB id
            assert not any(
                isinstance(a, dict) and a.get("id") and a.get("done") for a in actions
            )

    def test_update_members_retryable_keeps_draft(self):
        with patch("app.tasks.catalog_commands._phrase", side_effect=_phrase), patch(
            "app.tools.catalog_tools.update_queue",
            return_value=tool_err("RETRYABLE", "try again", http_status=503),
        ):
            out = _apply_add_team_members(
                ["Deva"],
                org="org-1",
                role="admin",
                user_id="u1",
                user_name="A",
                page="Teams",
                user_text="Deva",
                team_name="nlp",
                qid="q1",
            )
        assert out["handled"] is True
        assert out.get("team_draft", {}).get("awaiting") == "members_names"
        assert not any(
            isinstance(a, dict) and a.get("done") for a in (out.get("actions") or [])
        )

    def test_tool_layer_timeout_shape(self):
        actor = ToolActor(user_id="u1", organization_id="org-1", user_role="admin")
        with tool_actor_scope(actor), patch(
            "app.tools.catalog_tools.express_request",
            return_value=tool_err("TIMEOUT", "timed out", http_status=504),
        ):
            out = create_queue(name="x")
            out2 = update_queue("1901", members=["A"], add_members=True)
        assert out["success"] is False and out["error_code"] == "RETRYABLE"
        assert out2["success"] is False and out2["error_code"] == "RETRYABLE"
