"""Escalate asks which ticket, then who + lists resolvers before applying."""

from __future__ import annotations

from unittest.mock import patch

from app.tasks.chat_commands import (
    _ask_which_ticket_to_escalate,
    _build_escalate,
    _extract_assignee_hint,
    _find_ticket,
    _looks_like_ticket_choice,
    _pending_from_history,
    _wants_auto_resolver,
)


def test_to_resolver_is_not_a_named_person():
    assert _extract_assignee_hint("escalate ticket 12643 to resolver") is None
    assert _extract_assignee_hint("escalate ticket 12643 to Yaswanth mg") == "Yaswanth mg"


def test_auto_only_on_explicit_phrases():
    assert not _wants_auto_resolver("escalate ticket", None)
    assert _wants_auto_resolver("best resolver", None)
    assert _wants_auto_resolver("pick for me", "best")


def test_pending_from_history_skips_unrelated_assistant():
    history = [
        {"role": "assistant", "text": "Hello!"},
        {
            "role": "assistant",
            "text": (
                "I can escalate **12643** (“vpn”).\n\n"
                "**Who should I escalate it to?** Available resolvers:\n"
                "* **Yaswanth mg**\n\nReply with a name."
            ),
        },
    ]
    draft = _pending_from_history(history)
    assert draft == {"ticket_number": "12643", "awaiting": "assignee"}


def test_pending_from_history_which_ticket():
    history = [
        {
            "role": "assistant",
            "text": (
                "**Which ticket should I escalate?** Here are recent open tickets:\n"
                "* **#12840**: Filter…\n\nReply with a ticket number."
            ),
        }
    ]
    draft = _pending_from_history(history)
    assert draft and draft.get("awaiting") == "ticket"


def test_find_ticket_never_auto_picks_without_number():
    assert _find_ticket("org-x", None) is None
    assert _find_ticket("org-x", "") is None


def test_looks_like_ticket_choice():
    assert _looks_like_ticket_choice("#12840")
    assert _looks_like_ticket_choice("12840")
    assert not _looks_like_ticket_choice("show high priority")


def test_escalate_without_number_asks_which_ticket():
    fake = [
        {
            "ticket_number": "#12840",
            "subject": "Filter during escalate",
            "priority": "medium",
        },
        {
            "ticket_number": "#12839",
            "subject": "Chat escalate scenario",
            "priority": "high",
        },
    ]

    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "which ticket")

    def _fake_facts(**kwargs):
        return f"{kwargs.get('fallback')}\n\n{kwargs.get('facts')}"

    with (
        patch(
            "app.tasks.chat_commands._list_escalate_ticket_choices",
            return_value=fake,
        ),
        patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase),
        patch(
            "app.tasks.chat_commands._phrase_plus_facts", side_effect=_fake_facts
        ),
    ):
        out = _build_escalate(
            "org-x",
            None,
            None,
            "",
            user_role="agent",
            user_text="reassign tickets",
        )
    assert out["handled"] is True
    assert out["escalate_draft"]["awaiting"] == "ticket"
    assert "which ticket" in out["reply"].lower()
    assert "#12840" in out["reply"]
    assert not any(
        str(a.get("type")).lower() == "escalate" for a in (out.get("actions") or [])
    )


def test_ask_which_ticket_helper():
    def _fake_phrase(**kwargs):
        return str(kwargs.get("fallback") or "ticket number")

    with (
        patch(
            "app.tasks.chat_commands._list_escalate_ticket_choices",
            return_value=[],
        ),
        patch("app.tasks.chat_commands._llm_phrase", side_effect=_fake_phrase),
    ):
        out = _ask_which_ticket_to_escalate(
            "org-x", user_id="u1", user_name="A", user_role="resolver"
        )
    assert out["escalate_draft"]["awaiting"] == "ticket"
    assert "ticket number" in out["reply"].lower()


def test_strict_find_ticket_uses_get_ticket_tool_not_sql():
    from app.contracts import tool_ok

    with (
        patch("app.tools.ticket_read.get_ticket") as get_ticket,
        patch("app.db.fetch_one") as fetch_one,
        patch("app.db.fetch_all") as fetch_all,
    ):
        get_ticket.return_value = tool_ok(
            {
                "id": "#12940",
                "subject": "VPN down",
                "status": "Open",
                "priority": "high",
                "assignee": "Ada",
                "queue": "NetOps",
            }
        )
        row = _find_ticket(
            "org-1",
            "12940",
            user_id="u1",
            user_name="Agent",
            user_role="agent",
        )
    assert row is not None
    assert row["ticket_number"] in ("#12940", "12940")
    assert row["subject"] == "VPN down"
    assert row["assignee_name"] == "Ada"
    assert row["queue_name"] == "NetOps"
    assert get_ticket.call_count >= 1
    assert fetch_one.call_count == 0
    assert fetch_all.call_count == 0


def test_strict_list_escalate_choices_uses_list_tickets_tool_not_sql():
    from app.contracts import tool_ok
    from app.tasks.chat_commands import _list_escalate_ticket_choices

    with (
        patch("app.tools.ticket_read.list_tickets") as list_tickets,
        patch("app.db.fetch_one") as fetch_one,
        patch("app.db.fetch_all") as fetch_all,
    ):
        list_tickets.return_value = tool_ok(
            {
                "data": [
                    {
                        "id": "#1",
                        "subject": "A",
                        "status": "Open",
                        "priority": "low",
                    },
                    {
                        "id": "#2",
                        "subject": "B",
                        "status": "Resolved",
                        "priority": "high",
                    },
                    {
                        "id": "#3",
                        "subject": "C",
                        "status": "In Progress",
                        "priority": "medium",
                    },
                ]
            }
        )
        rows = _list_escalate_ticket_choices(
            "org-1",
            user_id="u1",
            user_name="Agent",
            user_role="agent",
            limit=5,
        )
    assert [r["ticket_number"] for r in rows] == ["#1", "#3"]
    assert list_tickets.call_count >= 1
    kwargs = list_tickets.call_args.kwargs
    assert kwargs.get("scope") == "team"
    assert fetch_one.call_count == 0
    assert fetch_all.call_count == 0


def test_strict_list_escalate_resolver_scope_is_assignee():
    from app.contracts import tool_ok
    from app.tasks.chat_commands import _list_escalate_ticket_choices

    with patch("app.tools.ticket_read.list_tickets") as list_tickets:
        list_tickets.return_value = tool_ok({"data": []})
        _list_escalate_ticket_choices(
            "org-1",
            user_id="u1",
            user_role="resolver",
        )
    assert list_tickets.call_args.kwargs.get("scope") == "assignee"
