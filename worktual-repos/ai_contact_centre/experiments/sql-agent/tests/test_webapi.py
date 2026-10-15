from sql_agent.compile import last_calendar_month
from sql_agent.context import QueryContext
from sql_agent.orchestrator import OrchestratorTurn
from sql_agent.status import StatusEvent
from sql_agent.tools import SqlAgentTools
from sql_agent.webapi import period_window, resolve_period, setup_payload, turn_payload


def test_period_window_last_month_matches_helper():
    assert period_window("last_month") == last_calendar_month()
    start, end = resolve_period(
        kind="last_month",
        period_start="2026-01-01 00:00:00",
        period_end="2026-02-01 00:00:00",
    )
    assert start == "2026-01-01 00:00:00"
    assert end == "2026-02-01 00:00:00"


def test_setup_payload_has_tester_fields():
    payload = setup_payload()
    assert payload["model"]
    assert payload["organization_id"]
    assert "7d" in payload["periods"]
    assert "last_month" in payload["periods"]
    assert payload["samples"]
    assert payload["samples"][0]["question"]
    assert payload["agents"][0]["name"] == "sql_supervisor"


def test_turn_payload_exposes_logs_and_warehouse(catalog):
    ctx = QueryContext(
        organization_id="1000",
        period_start="2026-08-01 00:00:00",
        period_end="2026-09-01 00:00:00",
    )
    tools = SqlAgentTools(catalog, live=False, ctx=ctx)
    tools.last_plan = {"trust": "certified", "sql": "SELECT 1 AS n", "headline": "n=1"}
    tools.last_result = {"ok": True, "preview": [{"n": 1}], "headline": "n=1"}
    turn = OrchestratorTurn(
        reply="<p>Handled 1 conversation.</p>",
        model="worktual-minimax",
        routed_to="sql_developer",
        elapsed_ms=12,
        events=[StatusEvent(agent="sql_supervisor", state="thinking", detail="reading")],
    )
    payload = turn_payload("how many handled", ctx, turn, tools)
    assert payload["plan"]["trust"] == "certified"
    assert payload["warehouse"]["preview"] == [{"n": 1}]
    assert payload["events"][0]["agent"] == "sql_supervisor"
    assert "1" in payload["reply_text"]
    assert payload["context"]["organization_id"] == "1000"
