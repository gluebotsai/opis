"""collect_ui_events — MAS panel events bubble up to socket layer."""

from __future__ import annotations

from app.mas.socket_bridge import collect_ui_events


def test_collect_from_nested_executor_result():
    draft_ev = {
        "type": "draft_updated",
        "payload": {"draft_contact": {"first_name": "Ada"}, "mode": "create"},
    }
    out = {
        "domain_result": {
            "result": {
                "tool_results": [
                    ("SET_DRAFT_FIELDS", {"ok": True, "ui_event": draft_ev}),
                ],
            },
        },
    }
    events = collect_ui_events(out, out["domain_result"])
    assert len(events) == 1
    assert events[0]["type"] == "draft_updated"
    assert events[0]["payload"]["draft_contact"]["first_name"] == "Ada"
