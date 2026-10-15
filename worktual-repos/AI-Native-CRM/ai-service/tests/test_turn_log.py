"""Agent turn observability format (portable spec)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.observability.turn_log import (
    agent_turn_log_path,
    begin_turn,
    finish_turn,
    record_llm_hop,
    record_llm_start,
    record_route,
    record_tool,
)


@pytest.fixture()
def turn_log_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr("app.observability.file_sink._DEFAULT_LOG_DIR", tmp_path)
    monkeypatch.setattr("app.observability.file_sink.log_dir", lambda: tmp_path)
    return tmp_path


def test_agent_turn_header_live_and_closer(turn_log_dir: Path) -> None:
    begin_turn(
        user_query="How many open deals?",
        session_id="cw_1",
        request_id="req_test",
        organization_id="1003",
        user_id="42",
    )
    record_route(None, "reports-analytics-agent", query="How many open deals?")
    record_llm_start("reports-analytics-agent")
    record_llm_hop(2100.0, agent="reports-analytics-agent", kind="chat", note="reply")
    record_tool(
        "run_kpi",
        {"kpi": "open_deals"},
        {"status": "ok", "rowCount": 3},
        agent="reports-analytics-agent",
    )
    finish_turn("You have 3 open deals.", final_agent="reports-analytics-agent")

    path = agent_turn_log_path()
    assert path.parent == turn_log_dir
    text = path.read_text(encoding="utf-8")
    assert "AGENT TURN" in text
    assert "USER QUERY" in text
    assert "How many open deals?" in text
    assert "LIVE" in text
    assert "ROUTE" in text and "reports-analytics-agent" in text
    assert "STEP" in text
    assert "LLM" in text and "waiting" in text
    assert "TOOL" in text and "run_kpi" in text
    assert "FINAL RESPONSE" in text
    assert "You have 3 open deals." in text
    assert "TOTAL  wall=" in text
    assert text.count("=" * 88) >= 2
