"""PR2 intent_gate + INSTRUCTION_FIRST flag/shadow tests."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sql_agent.errors import SqlAgentError
from sql_agent.job import SqlQueryRequest
from sql_agent.mas.dimensions import normalize_priority, normalize_status, resolve_dimension
from sql_agent.mas.feature_flags import instruction_first_enabled
from sql_agent.mas.intent_gate import hint_intent, normalize_filters, run_intent_gate
from sql_agent.mas.plan_schema import SqlPlan
from sql_agent.mas.super_planner import _gemma_plan
from sql_agent.mas.telemetry import reset_counters, counters_snapshot


def test_closed_dimensions():
    assert resolve_dimension("status") == "status"
    assert resolve_dimension("team") == "queue_name"
    assert resolve_dimension("foobar") is None
    assert normalize_status("open") == "open"
    assert normalize_priority("p1") == "high"
    assert normalize_priority("urgent") == "urgent"


def test_hint_intent_kinds():
    assert hint_intent("list open tickets") == "list"
    assert hint_intent("how many open tickets") == "count_scalar"
    assert hint_intent("tickets by queue") == "count_grouped"
    assert hint_intent("what is the SLA breach rate") == "kpi"


def test_unknown_dimension_needs_clarification():
    try:
        normalize_filters([{"column": "mood", "op": "eq", "values": ["happy"]}])
        raise AssertionError("expected needs_clarification")
    except SqlAgentError as exc:
        assert exc.code == "needs_clarification"
        assert exc.reason == "unknown_dimension"
        detail = exc.to_detail()
        assert detail["code"] == "needs_clarification"
        assert "candidates" in detail


def test_gate_normalizes_status_priority():
    gate = run_intent_gate(
        "how many high priority open tickets",
        product="ticketing",
        organization_id=None,
    )
    assert gate.hint == "count_scalar"
    cols = {f["column"]: f["values"] for f in gate.filters}
    assert cols.get("status") == ["open"]
    assert cols.get("priority") == ["high"]


def test_metric_request_force_skipped_when_flag_on():
    req = SqlQueryRequest(
        organization_id=1000,
        user_id=1,
        origin_product="ticketing",
        origin_agent="tk.reporting",
        instruction="list tickets",
        limit=20,
        metric_request={"metrics": ["open_tickets_metric"]},
    )
    policy = {"list_only": False, "allowed_metrics": None}

    # Flag off → force kpi
    os.environ.pop("INSTRUCTION_FIRST", None)
    assert instruction_first_enabled() is False
    forced = _gemma_plan(req, policy, "ticketing")
    assert forced.intent == "kpi"
    assert forced.metric_id == "open_tickets_metric"

    # Flag on → no early force; goes to Gemma
    os.environ["INSTRUCTION_FIRST"] = "1"
    try:
        assert instruction_first_enabled() is True
        with patch(
            "sql_agent.mas.super_planner.chat_json",
            return_value={
                "intent": "list",
                "preset_id": "tk.tickets",
                "product": "ticketing",
                "table": "tickets",
                "select": ["ticket_number", "status"],
                "limit": 20,
            },
        ):
            plan = _gemma_plan(req, policy, "ticketing")
        assert plan.intent == "list"
        assert plan.metric_id is None
    finally:
        os.environ.pop("INSTRUCTION_FIRST", None)


def test_shadow_logs_diff():
    from sql_agent.super import _shadow_instruction_first

    reset_counters()
    req = SqlQueryRequest(
        organization_id=1000,
        user_id=1,
        origin_product="ticketing",
        origin_agent="tk.tickets",
        instruction="list tickets",
        metric_request={"metrics": ["open_tickets_metric"]},
    )
    legacy = SqlPlan(
        plan_id="x",
        preset_id="metric.certified",
        intent="kpi",
        product="ticketing",
        metric_id="open_tickets_metric",
    )
    _shadow_instruction_first(req, legacy, {"source": "metric_fallback"})
    snap = counters_snapshot()
    assert snap["instruction_first_diff"] >= 1


if __name__ == "__main__":
    tests = [
        test_closed_dimensions,
        test_hint_intent_kinds,
        test_unknown_dimension_needs_clarification,
        test_gate_normalizes_status_priority,
        test_metric_request_force_skipped_when_flag_on,
        test_shadow_logs_diff,
    ]
    for fn in tests:
        fn()
        print(f"PASS {fn.__name__}")
    print(f"\n{len(tests)}/{len(tests)} passed")
