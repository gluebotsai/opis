"""Escalate ask must not swallow filter / list commands."""

from __future__ import annotations

import re
from unittest.mock import patch

from app.tasks.chat_commands import (
    _looks_like_assignee_choice,
    resolve_chat_command,
)


def test_filter_phrase_is_not_assignee_choice():
    draft = {
        "ticket_number": "#12813",
        "awaiting": "assignee",
        "candidates": ["Yaswanth mg"],
    }
    assert not _looks_like_assignee_choice("show high priorty tickets", draft)
    assert not _looks_like_assignee_choice("show high priority tickets", draft)
    assert _looks_like_assignee_choice("Yaswanth mg", draft)
    # Semantic preferences are interpreted by the Executor LLM, not this
    # deterministic roster-value validator.
    assert not _looks_like_assignee_choice("best resolver", draft)


def test_pending_escalate_allows_high_priority_filter():
    draft = {
        "ticket_number": "#12813",
        "awaiting": "assignee",
        "candidates": ["Yaswanth mg"],
    }
    with patch("app.tasks.chat_commands.resolve_ui_actions") as ui:
        ui.return_value = {
            "reply_hint": "Filtering tickets.",
            "actions": [
                {
                    "type": "set_filter",
                    "module": "tickets",
                    "query": "",
                    "priority": "high",
                }
            ],
        }
        result = resolve_chat_command(
            "show high priorty tickets",
            page="Tickets",
            organization_id="org-1",
            user_role="resolver",
            escalate_draft=draft,
            workflow_decision={
                "action": "SIDE_QUEST",
                "intent": "TICKET",
                "operation": "LIST_TICKETS",
                "filters": {"priority": "high"},
            },
            session_history=[
                {"role": "user", "text": "escalate ticket #12813"},
                {
                    "role": "assistant",
                    "text": (
                        "I can escalate **#12813**.\n\n"
                        "**Who should I escalate it to?** Available resolvers:\n"
                        "* **Yaswanth mg**"
                    ),
                },
            ],
        )
    assert result["handled"] is True
    assert not re.search(r"could not find resolver", result.get("reply") or "", re.I)
    types = [a.get("type") for a in result.get("actions") or []]
    assert "set_filter" in types
    # Escalate draft is parked so the assignee step can resume after the side quest.
    assert result.get("escalate_draft") is None
    parked = next(
        item["draft"]
        for item in result.get("parked_drafts") or []
        if item.get("flow") == "escalate"
    )
    assert parked.get("awaiting") == "assignee"
    assert parked.get("ticket_number") == "#12813"
