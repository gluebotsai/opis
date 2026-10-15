"""Contact query memory + contact_view postflight helpers."""

from __future__ import annotations

import pytest

from app.agents.contacts.agent import (
    _contact_view_query_postflight,
    _view_tool_succeeded,
)
from app.agents.contacts.contact_query_memory import (
    build_contact_query_memory,
    build_query_user_request,
)


def test_build_query_user_request_includes_note_and_message():
    session = {
        "llm_memory": [
            {"role": "user", "content": "show people in Chennai"},
            {"role": "assistant", "content": "I'll look that up."},
        ],
        "chat_memory_note": "Prior filter city=Chennai",
    }
    req = build_query_user_request(session, "and with email")
    assert "Chennai" in req
    assert "and with email" in req
    assert "Memory note" in req


def test_build_contact_query_memory_structure():
    session = {"llm_memory": [{"role": "user", "content": "hello"}], "candidates": []}
    mem = build_contact_query_memory(session, user_text="filter by company")
    assert mem["latest_user_message"] == "filter by company"
    assert "recent_chat" in mem


def test_view_tool_succeeded():
    assert _view_tool_succeeded([("QUERY_CONTACTS", {"ok": True, "count": 2})])
    assert not _view_tool_succeeded([("QUERY_CONTACTS", {"ok": False})])
    assert not _view_tool_succeeded([])


@pytest.mark.asyncio
async def test_postflight_skips_when_view_tool_ran():
    reply, events = await _contact_view_query_postflight(
        session_id="skip",
        token="t",
        user_text="show all from Chennai",
        view_preflight_ok=False,
        tool_results=[("QUERY_CONTACTS", {"ok": True, "matched_count": 0})],
        ui_events=[{"type": "contact_candidates", "payload": {}}],
        reply="already answered",
    )
    assert reply == "already answered"
    assert len(events) == 1
