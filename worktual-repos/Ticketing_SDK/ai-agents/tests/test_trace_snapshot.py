"""Debug snapshots keep route endpoints and drop the user query."""

from app.observability.turn_log import begin_turn, finish_turn, record_route, trace_snapshot


def test_trace_snapshot_omits_query_and_clears_after_finish():
    begin_turn(
        user_query="secret question",
        session_id="s",
        request_id="r",
        organization_id="1",
        user_id="2",
        start_agent="ticket_lifecycle_executor",
    )
    record_route("ticket_lifecycle_executor", "classification_priority_executor", "secret question")
    snap = trace_snapshot()
    assert snap == {
        "agents": ["ticket_lifecycle_executor", "classification_priority_executor"],
        "routes": [
            {"from": "ticket_lifecycle_executor", "to": "classification_priority_executor"}
        ],
    }
    assert "secret" not in str(snap)
    finish_turn(final_response="ok", final_agent="classification_priority_executor")
    assert trace_snapshot() is None
