"""Agent-turn file log: query, attending agent, route, tools, final reply."""

from __future__ import annotations

from datetime import datetime, timezone

from app.observability.turn_log import (
    _TurnTrace,
    begin_turn,
    current_attending_agent,
    current_trace,
    finish_turn,
    format_turn,
    record_attending_agent,
    record_context_layer,
    record_llm_hop,
    record_llm_start,
    record_route,
    record_tool,
)


def test_format_turn_includes_query_route_tool_and_final(tmp_path, monkeypatch, capsys):
    from app.observability import turn_log as turn_mod

    monkeypatch.setattr(turn_mod, "LOG_DIR", tmp_path)
    monkeypatch.setattr(turn_mod, "_console_echo_enabled", lambda: True)
    begin_turn(
        user_query="which team has more members",
        session_id="sess-1",
        request_id="req-1",
        organization_id="org-1",
        user_id="u-1",
        start_agent="ticketing_coworker",
    )
    record_tool(
        "route_to_agent",
        {"agent_name": "admin", "query": "which team has more members"},
        {"success": True, "payload": {"routing": True, "agent_name": "admin"}},
        agent="ticketing_coworker",
    )
    record_route("ticketing_coworker", "admin", "which team has more members")
    record_attending_agent("admin")
    record_tool(
        "ask_semantic_layer",
        {"question": "which team has more members"},
        {"success": True, "payload": {"answer": "Sales has 12 members"}},
        agent="admin",
    )
    record_llm_start(agent="admin")
    record_llm_hop(1840, agent="admin", kind="chat", note="reply")
    text = finish_turn(
        final_response="Sales has the most members (12).",
        final_agent="admin",
    )
    assert text is not None
    assert "USER QUERY" in text
    assert "which team has more members" in text
    assert "ATTENDING AGENT" in text
    assert "ticketing_coworker" not in text
    assert "Harness entry" not in text
    assert "1. admin" in text
    assert "ROUTED TO" in text
    assert "→" in text
    assert "- → admin" in text
    assert "ask_semantic_layer" in text
    assert "Sales has 12 members" in text
    assert "FINAL RESPONSE" in text
    assert "Sales has the most members (12)." in text
    assert "LLM TIMING" in text
    assert "1.84s" in text

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    path = tmp_path / f"agent-turn-{day}.log"
    assert path.is_file()
    logged = path.read_text(encoding="utf-8")
    assert "USER QUERY" in logged
    assert "LIVE" in logged
    assert "STEP" in logged
    assert "LLM" in logged
    assert "waiting" in logged
    assert "1.84s" in logged
    assert "TOTAL" in logged
    captured = capsys.readouterr()
    assert "USER QUERY" in captured.out
    assert "LIVE" in captured.out
    assert "1.84s" in captured.out
    assert "FINAL RESPONSE" in captured.out
    assert "TOTAL" in captured.out
    assert current_trace() is None


def test_finish_turn_can_silence_console(tmp_path, monkeypatch, capsys):
    from app.observability import turn_log as turn_mod

    monkeypatch.setattr(turn_mod, "LOG_DIR", tmp_path)
    monkeypatch.setattr(turn_mod, "_console_echo_enabled", lambda: False)
    begin_turn(user_query="quiet", start_agent="general")
    finish_turn(final_response="ok", final_agent="general")
    assert "USER QUERY" not in capsys.readouterr().out


def test_record_helpers_noop_without_begin():
    record_attending_agent("admin")
    record_route("ticketing_coworker", "admin")
    record_tool("list_queues", {}, {"success": True})
    assert current_trace() is None
    assert current_attending_agent() == ""
    assert finish_turn(final_response="hi") is None


def test_current_attending_agent_follows_harness_hops():
    begin_turn(user_query="continue ticket", start_agent="ticketing_coworker")
    record_attending_agent("ticketing_super_agent")
    assert current_attending_agent() == "ticketing_super_agent"
    record_attending_agent("ticket_creation_executor")
    assert current_attending_agent() == "ticket_creation_executor"
    finish_turn(final_response="ok", final_agent="ticket_creation_executor")
    assert current_attending_agent() == ""


def test_redacts_secrets_in_tool_args():
    trace = _TurnTrace(
        user_query="show token",
        session_id="s",
        request_id="r",
        organization_id="o",
        user_id="u",
        start_agent="admin",
    )
    trace.record_tool(
        "list_audit",
        {"authorization": "Bearer secret", "ticket": "12"},
        {"success": True, "api_key": "abc"},
        agent="admin",
    )
    text = format_turn(trace, final_response="ok", final_agent="admin")
    assert "Bearer secret" not in text
    assert "[redacted]" in text
    assert "12" in text


def test_finish_turn_never_raises(monkeypatch):
    def _boom(*_a, **_k):
        raise OSError("disk full")

    monkeypatch.setattr("app.observability.turn_log._log_path", _boom)
    begin_turn(user_query="hi", start_agent="general")
    text = finish_turn(final_response="hello", final_agent="general")
    assert text is None or "hello" in text
    assert current_trace() is None


def test_ontology_slice_logs_call_and_status_without_body(tmp_path, monkeypatch, capsys):
    from app.observability import turn_log as turn_mod

    monkeypatch.setattr(turn_mod, "LOG_DIR", tmp_path)
    monkeypatch.setattr(turn_mod, "_console_echo_enabled", lambda: True)
    begin_turn(user_query="open tickets", start_agent="ticketing_super_agent")
    record_context_layer(
        endpoint="ontology_slice",
        url="http://cl.test/v1/ontology/slice",
        payload={"organizationId": 1012, "agent": "ticketing_super_agent"},
        phase="calling",
    )
    record_context_layer(
        endpoint="ontology_slice",
        url="http://cl.test/v1/ontology/slice",
        payload={"organizationId": 1012, "agent": "ticketing_super_agent"},
        status=200,
        response={"prompt": "huge slice body must not appear", "metrics": ["x"]},
        phase="received",
    )
    finish_turn(final_response="ok", final_agent="ticketing_super_agent")
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    logged = (tmp_path / f"agent-turn-{day}.log").read_text(encoding="utf-8")
    assert "ontology_slice  calling" in logged
    assert "ontology_slice  received  status=200" in logged
    assert "huge slice body must not appear" not in logged
    assert "organizationId" in logged
