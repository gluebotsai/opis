"""Session ui timeline must survive agent saves and reach public_state."""

from __future__ import annotations

from app.session_store import (
    _merge_session_ui,
    _public_create_ui,
    empty_session,
    public_state,
)


def test_public_state_includes_timeline_templates() -> None:
    session = empty_session("s1", module="create_campaign")
    session["ui"] = {
        "status": "drafting",
        "committed": True,
        "timelineTemplates": [
            {
                "id": "m1",
                "afterMessageIndex": 2,
                "pinUserMessageId": "u1",
                "cards": [{"template_id": "t1", "channel": "email"}],
            }
        ],
    }
    state = public_state(session)
    assert "ui" in state
    assert state["ui"]["committed"] is True
    assert len(state["ui"]["timelineTemplates"]) == 1
    assert state["ui"]["timelineTemplates"][0]["cards"][0]["template_id"] == "t1"


def test_merge_session_ui_keeps_richer_timeline() -> None:
    prior = {
        "status": "drafting",
        "timelineTemplates": [{"id": "a"}, {"id": "b"}],
        "committed": True,
    }
    incoming = {"status": "scheduled", "dirty": False}
    merged = _merge_session_ui(prior, incoming)
    assert merged is not None
    assert merged["status"] == "scheduled"
    assert len(merged["timelineTemplates"]) == 2
    assert merged["committed"] is True


def test_merge_session_ui_prefers_incoming_when_longer() -> None:
    prior = {"timelineTemplates": [{"id": "a"}]}
    incoming = {
        "timelineTemplates": [{"id": "a"}, {"id": "b"}, {"id": "c"}],
        "committed": True,
    }
    merged = _merge_session_ui(prior, incoming)
    assert merged is not None
    assert len(merged["timelineTemplates"]) == 3


def test_public_create_ui_empty_when_missing() -> None:
    assert _public_create_ui({}) == {}
    assert _public_create_ui({"ui": "bad"}) == {}
