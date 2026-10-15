#!/usr/bin/env python3
"""Tests: short policy dim names resolve to MetricFlow group-by ids."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.metricflow.dimension_resolver import (
    DimensionResolveError,
    resolve_group_by_for_metrics,
)
from semantic.metricflow.manifest_resolver import resolve_manifest_dir
from semantic.metricflow.engine import build_execution_where
from semantic.query import (
    QueryValidationError,
    SemanticQuery,
    _classify_metricflow_error,
    validate_and_prepare,
)
from semantic.scope import UserScope, row_scope_filter_clauses


def _manifest(product: str) -> str:
    return resolve_manifest_dir(product, "1000")


def test_crm_stage() -> None:
    md = _manifest("crm")
    out = resolve_group_by_for_metrics(md, ["won_deal_rate"], ["stage"])
    assert out == ["deal__stage"], out


def test_ticketing_priority() -> None:
    md = _manifest("ticketing")
    out = resolve_group_by_for_metrics(md, ["open_tickets_metric"], ["priority"])
    assert out == ["ticket__priority"], out


def test_ccaas_channel_assignment() -> None:
    md = _manifest("ccaas")
    out = resolve_group_by_for_metrics(
        md, ["missed_contact_rate"], ["channel"], hint_entity="conversation"
    )
    assert out == ["assignment__channel"], out


def test_ccaas_channel_conversation() -> None:
    md = _manifest("ccaas")
    out = resolve_group_by_for_metrics(
        md, ["total_conversations"], ["channel"], hint_entity="conversation"
    )
    assert out == ["conversation__channel"], out


def test_ccaas_direction() -> None:
    md = _manifest("ccaas")
    out = resolve_group_by_for_metrics(
        md, ["total_conversations"], ["direction"], hint_entity="conversation"
    )
    assert out == ["conversation__direction"], out


def test_ccaas_aht_direction() -> None:
    md = _manifest("ccaas")
    out = resolve_group_by_for_metrics(
        md, ["average_handle_time"], ["direction"], hint_entity="conversation"
    )
    assert out == ["assignment__direction"], out


def test_ccaas_missed_contact_agent_name() -> None:
    md = _manifest("ccaas")
    out = resolve_group_by_for_metrics(
        md, ["missed_contact_rate"], ["agent_name"], hint_entity="conversation"
    )
    assert out == ["assignment__agent_name"], out


def test_ccaas_callback_tasks_channel() -> None:
    md = _manifest("ccaas")
    out = resolve_group_by_for_metrics(
        md, ["callback_tasks"], ["channel"], hint_entity="task"
    )
    assert out == ["task__channel"], out


def test_ccaas_callback_tasks_status() -> None:
    md = _manifest("ccaas")
    out = resolve_group_by_for_metrics(
        md, ["callback_tasks"], ["status"], hint_entity="task"
    )
    assert out == ["task__status"], out


def test_validate_prepare_inbound_filter() -> None:
    q = SemanticQuery(
        organization_id=1000,
        user_id=1000,
        product="ccaas",
        agent="cc.reporting",
        metrics=["total_conversations"],
        filters=[{"dimension": "direction", "op": "eq", "values": ["inbound"]}],
        time={"start": "2026-01-01", "end": "2026-09-09", "grain": "day"},
    )
    prep = validate_and_prepare(q)
    assert "metric_time__day" in prep["group_by"]
    assert any(
        "Dimension('conversation__direction')" in w and "inbound" in w
        for w in prep["where"]
    )


def test_ccaas_queue_name() -> None:
    md = _manifest("ccaas")
    out = resolve_group_by_for_metrics(
        md, ["total_conversations"], ["queue_name"], hint_entity="conversation"
    )
    assert out == ["conversation__queue_name"], out


def test_ccaas_sla_breach_channel_hint() -> None:
    md = _manifest("ccaas")
    out = resolve_group_by_for_metrics(
        md, ["sla_breach_rate"], ["channel"], hint_entity="conversation"
    )
    assert out == ["sla_state__channel"], out
    assert not any(x.startswith("ticket__") for x in out)


def test_ccaas_cross_model_queue_name() -> None:
    md = _manifest("ccaas")
    out = resolve_group_by_for_metrics(
        md,
        ["open_conversations", "sla_breach_rate"],
        ["queue_name"],
        hint_entity="conversation",
    )
    assert out == ["conversation__queue_name"], out


def test_metric_time_grain_passthrough() -> None:
    md = _manifest("ccaas")
    out = resolve_group_by_for_metrics(
        md, ["total_conversations"], ["metric_time__day"]
    )
    assert out == ["metric_time__day"], out


def test_validate_prepare_time_grain_only() -> None:
    q = SemanticQuery(
        organization_id=1000,
        user_id=1000,
        product="ccaas",
        agent="cc.reporting",
        metrics=["total_conversations"],
        time={"grain": "day"},
    )
    prep = validate_and_prepare(q)
    assert "metric_time__day" in prep["group_by"]
    assert prep["time"] == {"start": None, "end": None, "grain": "day"}


def test_validate_prepare_whatsapp_filter() -> None:
    q = SemanticQuery(
        organization_id=1000,
        user_id=1000,
        product="ccaas",
        agent="cc.reporting",
        metrics=["total_conversations"],
        filters=[{"dimension": "channel", "op": "eq", "values": ["whatsapp"]}],
        time={"start": "2026-09-07", "end": "2026-09-13", "grain": "day"},
    )
    prep = validate_and_prepare(q)
    assert "metric_time__day" in prep["group_by"]
    assert any(
        "Dimension('conversation__channel')" in w and "whatsapp" in w
        for w in prep["where"]
    )


def test_campaign_channel_alias() -> None:
    md = _manifest("campaign")
    out = resolve_group_by_for_metrics(
        md, ["delivery_rate"], ["channel"], hint_entity="campaign"
    )
    assert out == ["campaign__source_channel"], out


def test_already_qualified_passthrough() -> None:
    md = _manifest("crm")
    out = resolve_group_by_for_metrics(md, ["won_deal_rate"], ["deal__stage"])
    assert out == ["deal__stage"], out


def test_unknown_dim_raises() -> None:
    md = _manifest("crm")
    try:
        resolve_group_by_for_metrics(md, ["won_deal_rate"], ["not_a_real_dim"])
        raise AssertionError("expected DimensionResolveError")
    except DimensionResolveError as exc:
        assert exc.short_name == "not_a_real_dim"


def test_validate_prepare_short_names() -> None:
    q = SemanticQuery(
        organization_id=1000,
        user_id=1000,
        product="crm",
        agent="crm.deals",
        metrics=["won_deal_rate"],
        group_by=["stage"],
    )
    prep = validate_and_prepare(q)
    assert prep["group_by"] == ["deal__stage"]
    assert prep["group_by_requested"] == ["stage"]


def test_execution_where_includes_org() -> None:
    q = SemanticQuery(
        organization_id=1000,
        user_id=1000,
        product="crm",
        agent="crm.deals",
        metrics=["won_deal_rate"],
    )
    prep = validate_and_prepare(q)
    md = _manifest("crm")
    where = build_execution_where(prep, md)
    assert any("organization_id" in clause and "'1000'" in clause for clause in where), where


def test_agent_ticketing_assignee_scope() -> None:
    scope = UserScope(user_id="42", organization_id="1000", role="agent", visible_user_ids=["42"])
    clauses = row_scope_filter_clauses(
        scope, metric_id="open_tickets_metric", product="ticketing"
    )
    assert len(clauses) == 1
    assert "ticket__assignee" in clauses[0]
    assert "'42'" in clauses[0]


def test_crm_agent_owner_scope() -> None:
    scope = UserScope(user_id="42", organization_id="1000", role="agent", visible_user_ids=["42"])
    clauses = row_scope_filter_clauses(scope, metric_id="won_deal_rate", product="crm")
    assert len(clauses) == 1
    assert "deal__owner" in clauses[0]
    assert "'42'" in clauses[0]


def test_ccaas_aht_assignment_scope() -> None:
    scope = UserScope(user_id="99", organization_id="1000", role="agent", visible_user_ids=["99"])
    clauses = row_scope_filter_clauses(
        scope, metric_id="average_handle_time", product="ccaas"
    )
    assert len(clauses) == 1
    assert "assignment__agent" in clauses[0]
    assert "'99'" in clauses[0]


def test_org_scope_metrics_have_no_row_filter() -> None:
    scope = UserScope(user_id="1000", organization_id="1000", role="agent", visible_user_ids=["1000"])
    clauses = row_scope_filter_clauses(scope, metric_id="delivery_rate", product="campaign")
    assert clauses == []


def test_ccaas_sla_breach_org_only() -> None:
    scope = UserScope(user_id="99", organization_id="1000", role="agent", visible_user_ids=["99"])
    clauses = row_scope_filter_clauses(scope, metric_id="sla_breach_rate", product="ccaas")
    assert clauses == []


def test_ticketing_sla_breach_assignee_scope() -> None:
    scope = UserScope(user_id="55", organization_id="1000", role="agent", visible_user_ids=["55"])
    clauses = row_scope_filter_clauses(
        scope, metric_id="sla_breach_rate", product="ticketing"
    )
    assert len(clauses) == 1
    assert "ticket__assignee" in clauses[0]


def test_validate_prepare_includes_assignee_for_agent() -> None:
    q = SemanticQuery(
        organization_id=1000,
        user_id=42,
        product="ticketing",
        agent="tk.tickets",
        metrics=["open_tickets_metric"],
    )
    prep = validate_and_prepare(q)
    assert any("ticket__assignee" in w and "'42'" in w for w in prep["where"])


def test_classify_invalid_query() -> None:
    class InvalidQueryException(Exception):
        pass

    exc = InvalidQueryException(
        "Got error(s)\n\nSuggestions:\n      [\n        'deal__stage',\n      ]"
    )
    mapped = _classify_metricflow_error(exc)
    assert isinstance(mapped, QueryValidationError)
    assert "deal__stage" in mapped.suggestions


def main() -> int:
    tests = [
        test_crm_stage,
        test_ticketing_priority,
        test_ccaas_channel_assignment,
        test_ccaas_channel_conversation,
        test_ccaas_direction,
        test_ccaas_aht_direction,
        test_ccaas_missed_contact_agent_name,
        test_ccaas_callback_tasks_channel,
        test_ccaas_callback_tasks_status,
        test_validate_prepare_inbound_filter,
        test_ccaas_queue_name,
        test_ccaas_sla_breach_channel_hint,
        test_ccaas_cross_model_queue_name,
        test_metric_time_grain_passthrough,
        test_validate_prepare_time_grain_only,
        test_validate_prepare_whatsapp_filter,
        test_campaign_channel_alias,
        test_already_qualified_passthrough,
        test_unknown_dim_raises,
        test_validate_prepare_short_names,
        test_execution_where_includes_org,
        test_agent_ticketing_assignee_scope,
        test_crm_agent_owner_scope,
        test_ccaas_aht_assignment_scope,
        test_org_scope_metrics_have_no_row_filter,
        test_ccaas_sla_breach_org_only,
        test_ticketing_sla_breach_assignee_scope,
        test_validate_prepare_includes_assignee_for_agent,
        test_classify_invalid_query,
    ]
    for fn in tests:
        fn()
        print(f"PASS  {fn.__name__}")
    print(f"\n{len(tests)}/{len(tests)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
