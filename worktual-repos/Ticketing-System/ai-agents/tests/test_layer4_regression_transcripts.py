"""
Layer 4 — Regression suite: fixed labeled transcripts.

Run on every deploy like unit tests. Pass rate should stay at 100% for these cases.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from app.agents.workflow_manager import resolve_active_workflow

_FIXTURE = Path(__file__).parent / "fixtures" / "regression_transcripts.json"


def _phrase(**kwargs):
    ctx = kwargs.get("context") or {}
    return str(ctx.get("nextStep") or kwargs.get("fallback") or "ok")


def _load_cases() -> list[dict]:
    return json.loads(_FIXTURE.read_text(encoding="utf-8"))


def _run_step(step: dict) -> dict | None:
    return resolve_active_workflow(
        step["user"],
        page="Teams",
        organization_id="org-reg",
        user_role="admin",
        user_id="u1",
        user_name="Admin",
        escalate_draft=step.get("escalate_draft"),
        macro_draft=step.get("macro_draft"),
        team_draft=step.get("team_draft"),
        kb_draft=step.get("kb_draft"),
        ticket_draft=step.get("ticket_draft"),
        parked_drafts=step.get("parked_drafts"),
        session_history=step.get("session_history"),
        last_entity=step.get("last_entity"),
        workflow_decision=step.get("workflow_decision"),
    )


def _assert_expect(hit: dict | None, expect: dict) -> None:
    if "handled" in expect:
        if hit is None:
            assert expect["handled"] is False
        else:
            assert hit.get("handled") is expect["handled"]

    if expect.get("kb_kept"):
        assert hit and hit.get("kb_draft") is None
        assert any(
            item.get("flow") == "kb"
            and item.get("draft", {}).get("title") == "add"
            for item in hit.get("parked_drafts") or []
        )

    if "kb_awaiting" in expect:
        assert hit and hit["kb_draft"]["awaiting"] == expect["kb_awaiting"]

    if expect.get("team_draft_cleared"):
        assert hit and hit.get("team_draft") is None

    if expect.get("escalate_draft_cleared"):
        assert hit and hit.get("escalate_draft") is None

    if expect.get("escalate_kept"):
        assert hit and hit.get("escalate_draft") is None
        assert any(
            item.get("flow") == "escalate"
            and item.get("draft", {}).get("awaiting") == "assignee"
            for item in hit.get("parked_drafts") or []
        )

    if "not_awaiting" in expect:
        assert hit and hit.get("team_draft", {}).get("awaiting") != expect["not_awaiting"]

    if "team_name" in expect:
        assert hit and hit.get("team_draft", {}).get("name") == expect["team_name"]

    if expect.get("defer"):
        assert hit and hit.get("defer_to_commands") is True

    if "parked_flow" in expect:
        parked = (hit or {}).get("parked_drafts") or []
        assert any(p.get("flow") == expect["parked_flow"] for p in parked)

    if expect.get("awaiting_members_names"):
        assert hit and hit.get("team_draft", {}).get("awaiting") == "members_names"

    if expect.get("macro_draft_cleared"):
        assert hit and hit.get("macro_draft") is None

    if expect.get("kb_draft_cleared"):
        assert hit and hit.get("kb_draft") is None

    if "macro_awaiting" in expect:
        assert hit and hit.get("macro_draft", {}).get("awaiting") == expect["macro_awaiting"]

    if "macro_title" in expect:
        assert hit and hit.get("macro_draft", {}).get("title") == expect["macro_title"]

    if expect.get("ticket_kept"):
        assert hit and hit.get("ticket_draft") is None
        assert any(
            item.get("flow") == "ticket"
            and item.get("draft", {}).get("customerName")
            == expect.get("ticket_customer")
            for item in hit.get("parked_drafts") or []
        )

    if "ticket_awaiting" in expect:
        assert hit and hit.get("ticket_draft", {}).get("awaiting") == expect["ticket_awaiting"]


@pytest.mark.regression
@pytest.mark.parametrize("case", _load_cases(), ids=lambda c: c["id"])
def test_regression_transcript(case: dict):
    with patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase), patch(
        "app.tasks.catalog_commands._phrase", side_effect=_phrase
    ), patch(
        "app.tasks.catalog_commands._live_kb_categories",
        return_value=["General", "Help"],
    ), patch(
        "app.tools.catalog_tools.list_queues",
        return_value={
            "success": True,
            "payload": [{"id": "q1", "queueName": "nlp", "name": "nlp"}],
        },
    ):
        for step in case["steps"]:
            hit = _run_step(step)
            _assert_expect(hit, step.get("expect") or {})
