"""Strict regression for Phase 1 escalate-via-Express tools."""

from __future__ import annotations

from unittest.mock import patch

from app.tasks.chat_commands import (
    _build_escalate,
    _is_auto_pick_phrase,
    _refers_to_same_ticket,
)
from app.contracts import tool_err, tool_ok


TICKET = {
    "ticket_number": "12935",
    "subject": "CRM messaging failure",
    "status": "Open",
    "priority": "high",
    "skill": "CRM",
    "category": "Bug",
    "description": "latency",
    "queue_name": "Bug solvers",
    "assignee_id": "agent-1",
    "assignee_name": "L1 Agent",
}


def _phrase(**kwargs):
    return str(kwargs.get("fallback") or "ok")


def _facts(**kwargs):
    return f"{kwargs.get('fallback')}\n\n{kwargs.get('facts') or ''}"


def test_auto_pick_and_same_ticket_helpers():
    assert _is_auto_pick_phrase("bets resolver")
    assert _is_auto_pick_phrase("best resolver")
    assert _refers_to_same_ticket("same tickrt")
    assert _refers_to_same_ticket("this ticket")


def test_escalate_named_calls_express_tool_not_action():
    """Named assignee path must call escalate_ticket and emit ui_actions only."""
    called = {}

    def fake_escalate(tn, **kwargs):
        called["tn"] = tn
        called["kwargs"] = kwargs
        return tool_ok(
            {
                "resolver": "annamalai",
                "agent": "L1 Agent",
                "rationale": "named",
                "unchanged": False,
            }
        )

    with (
        patch("app.tasks.chat_commands._find_ticket", return_value=TICKET),
        patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase),
        patch("app.tasks.chat_commands._phrase_plus_facts", side_effect=_facts),
        patch(
            "app.tasks.chat_commands._match_named_assignee",
            return_value={
                "assignee": "annamalai",
                "assignee_id": "u9",
                "rationale_extra": "named",
            },
        ),
        patch("app.tools.ticket_write.escalate_ticket", side_effect=fake_escalate),
    ):
        out = _build_escalate(
            "org",
            "12935",
            "annamalai",
            "",
            user_id="actor-1",
            user_name="Yaswanth",
            user_role="agent",
            user_text="assign to annamalai",
            escalate_draft={
                "ticket_number": "12935",
                "awaiting": "assignee",
                "candidates": ["annamalai"],
            },
        )

    assert out["handled"] is True
    assert (out.get("escalate_draft") or {}).get("awaiting") == "confirm"
    assert "tn" not in called
    types = [a.get("type") for a in (out.get("actions") or [])]
    assert "refresh_tickets" not in types
    assert any(
        a.get("type") == "escalate" and a.get("step") == "confirm"
        for a in (out.get("actions") or [])
        if isinstance(a, dict)
    )


def test_escalate_auto_pick_calls_skill_then_express():
    dual = {
        "agent": "A Agent",
        "agent_id": "a1",
        "resolver": "Yaswanth mg",
        "resolver_id": "r1",
        "rationale": "skill",
        "via": "test",
    }
    called = {}

    def fake_escalate(tn, **kwargs):
        called["kwargs"] = kwargs
        return tool_ok(
            {
                "resolver": "Yaswanth mg",
                "agent": "A Agent",
                "unchanged": False,
            }
        )

    with (
        patch("app.tasks.chat_commands._find_ticket", return_value=TICKET),
        patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase),
        patch("app.tasks.chat_commands._phrase_plus_facts", side_effect=_facts),
        patch(
            "app.tasks.chat_commands.skill_pick_agent_and_resolver",
            return_value=dual,
        ),
        patch("app.tools.ticket_write.escalate_ticket", side_effect=fake_escalate),
    ):
        out = _build_escalate(
            "org",
            "12935",
            "best resolver",
            "",
            user_id="actor-1",
            user_role="agent",
            user_text="bets resolver",
            escalate_draft={"ticket_number": "12935", "awaiting": "assignee"},
        )

    assert out["handled"] is True
    assert (out.get("escalate_draft") or {}).get("awaiting") == "confirm"
    assert "kwargs" not in called
    assert "refresh_tickets" not in [a.get("type") for a in (out.get("actions") or [])]


def test_escalate_tool_forbidden_keeps_draft():
    with (
        patch("app.tasks.chat_commands._find_ticket", return_value=TICKET),
        patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase),
        patch(
            "app.tasks.chat_commands._match_named_assignee",
            return_value={
                "assignee": "annamalai",
                "assignee_id": "u9",
                "rationale_extra": "named",
            },
        ),
        patch(
            "app.tools.ticket_write.escalate_ticket",
            return_value=tool_err("FORBIDDEN", "Escalate target not allowed", http_status=403),
        ),
    ):
        out = _build_escalate(
            "org",
            "12935",
            "annamalai",
            "",
            user_id="actor-1",
            user_role="agent",
            user_text="assign to annamalai",
            escalate_draft={
                "ticket_number": "12935",
                "awaiting": "confirm",
                "assignee": "annamalai",
                "assignee_id": "u9",
            },
        )

    assert out["handled"] is True
    assert out.get("escalate_draft", {}).get("awaiting") == "assignee"
    assert "escalate" not in [a.get("type") for a in (out.get("actions") or [])]


def test_escalate_without_actor_does_not_call_tool():
    called = {"n": 0}

    def boom(*_a, **_k):
        called["n"] += 1
        raise AssertionError("should not call escalate_ticket without actor")

    with (
        patch("app.tasks.chat_commands._find_ticket", return_value=TICKET),
        patch("app.tasks.chat_commands._llm_phrase", side_effect=_phrase),
        patch(
            "app.tasks.chat_commands._match_named_assignee",
            return_value={
                "assignee": "annamalai",
                "assignee_id": "u9",
                "rationale_extra": "named",
            },
        ),
        patch("app.tools.ticket_write.escalate_ticket", side_effect=boom),
    ):
        out = _build_escalate(
            "org",
            "12935",
            "annamalai",
            "",
            user_id=None,
            user_role="agent",
            user_text="assign to annamalai",
        )

    assert called["n"] == 0
    assert out["handled"] is True
    assert out.get("escalate_draft")
