#!/usr/bin/env python3
"""Gate: semantic template fast path, SQL cache, SQL no MetricFlow-first."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.context_cache import clear_context_cache
from semantic.metricflow.sql_cache import (
    cache_key_for_prepared,
    clear_sql_cache,
    get_cached_sql,
    set_cached_sql,
)
from semantic.query import QueryValidationError, SemanticQuery, _allowlisted_metrics, execute
from semantic.runtime_reload import reload_runtime
from semantic.scope import UserScope
from semantic.sql.job import SqlQueryRequest
from semantic.sql.super import execute_sql_query
from semantic.sql.template_execute import can_use_sql_template


def _simple_prepared(**overrides) -> dict:
    base = {
        "organizationId": 1000,
        "userId": 1001,
        "product": "ticketing",
        "execution_product": "ticketing",
        "agent": "analytics_audit_query_executor",
        "metrics": ["open_tickets_metric"],
        "group_by": [],
        "group_by_requested": [],
        "where": [],
        "time": None,
        "scope": {},
        "user_filters": [],
    }
    base.update(overrides)
    return base


def test_can_use_sql_template_scalar() -> None:
    assert can_use_sql_template(_simple_prepared()) is True


def test_can_use_sql_template_contact_centre_alias() -> None:
    assert can_use_sql_template(
        _simple_prepared(
            product="contact_centre",
            execution_product="contact_centre",
            metrics=["total_conversations"],
        )
    ) is True


def test_can_use_sql_template_rejects_group_by() -> None:
    assert can_use_sql_template(_simple_prepared(group_by_requested=["priority"])) is False


def test_can_use_sql_template_rejects_grain() -> None:
    assert can_use_sql_template(
        _simple_prepared(time={"start": "2026-01-01", "end": "2026-02-01", "grain": "day"})
    ) is False


def test_execute_sql_template_path() -> None:
    query = SemanticQuery(
        organization_id=1000,
        user_id=1001,
        product="ticketing",
        agent="analytics_audit_query_executor",
        metrics=["open_tickets_metric"],
    )
    with patch("semantic.query.validate_and_prepare", return_value=_simple_prepared()):
        with patch(
            "semantic.sql.template_execute.execute_prepared_templates",
            return_value={"rows": [{"open_tickets_metric": 3}], "sql": "SELECT 3"},
        ):
            with patch("semantic.metricflow.engine.run_metricflow_query") as mf:
                result = execute(query)
    assert result["source"] == "sql_template"
    assert result["_timing"]["path"] == "sql_template"
    mf.assert_not_called()


def test_execute_denies_non_reporting_agent() -> None:
    query = SemanticQuery(
        organization_id=1000,
        user_id=1001,
        product="ticketing",
        agent="tk.tickets",
        metrics=["open_tickets_metric"],
    )
    try:
        execute(query)
        raise AssertionError("expected QueryValidationError")
    except QueryValidationError:
        pass


def test_sql_cache_roundtrip() -> None:
    clear_sql_cache()
    prepared = _simple_prepared()
    key = cache_key_for_prepared(prepared)
    set_cached_sql(key, "SELECT 1")
    assert get_cached_sql(key) == "SELECT 1"
    clear_sql_cache()
    assert get_cached_sql(key) is None


def test_pg_pool_checkout_release() -> None:
    from semantic.pg_pool import (
        checkout_connection,
        close_pool,
        is_pooled_connection,
        release_connection,
    )

    close_pool()
    try:
        conn = checkout_connection()
        assert is_pooled_connection(conn)
        release_connection(conn)
        assert not is_pooled_connection(conn)
    except RuntimeError as exc:
        if "pg_host not configured" in str(exc):
            return
        raise


def test_reload_clears_sql_cache() -> None:
    prepared = _simple_prepared()
    key = cache_key_for_prepared(prepared)
    set_cached_sql(key, "SELECT 1")
    result = reload_runtime(warm_metricflow=False)
    assert "sql_cache" in result["reloaded"]
    assert "context_cache" in result["reloaded"]
    assert "pg_pool" in result["reloaded"]
    assert "runtime" in result
    assert get_cached_sql(key) is None


def test_allowlist_uses_resolve_context() -> None:
    clear_context_cache()
    with patch("semantic.query.resolve_context") as resolve_ctx:
        mock_ctx = MagicMock()
        mock_ctx.visible_set.return_value = {"open_tickets_metric"}
        resolve_ctx.return_value = mock_ctx
        visible = _allowlisted_metrics(
            "analytics_audit_query_executor", "ticketing", 1000, 1001
        )
    resolve_ctx.assert_called_once()
    assert visible == {"open_tickets_metric"}


def test_template_execute_reuses_prepared_scope() -> None:
    from semantic.sql.template_execute import _build_template_job

    scope = UserScope(user_id="1001", organization_id="1000", visible_user_ids=["1001"])
    prepared = _simple_prepared(user_scope=scope)
    with patch("semantic.sql.template_execute.lookup_user_scope") as lookup:
        job = _build_template_job(prepared, "open_tickets_metric")
    lookup.assert_not_called()
    assert job.visible_user_ids == ["1001"]


def test_execute_includes_prepare_ms() -> None:
    query = SemanticQuery(
        organization_id=1000,
        user_id=1001,
        product="ticketing",
        agent="analytics_audit_query_executor",
        metrics=["open_tickets_metric"],
    )
    with patch("semantic.query.validate_and_prepare", return_value=_simple_prepared()):
        with patch(
            "semantic.sql.template_execute.execute_prepared_templates",
            return_value={"rows": [{"open_tickets_metric": 3}], "sql": "SELECT 3"},
        ):
            result = execute(query)
    assert "prepare_ms" in result["_timing"]


def test_all_ticketing_templates_present() -> None:
    import yaml

    path = ROOT / "semantic/metrics/ticketing.yml"
    if not path.is_file():
        path = ROOT / "semantic/sql/metric_templates/ticketing.yml"
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    metrics = set((data.get("metrics") or {}).keys())
    semantic_path = (
        ROOT
        / "semantic/dbt/ticketing/default/dbt/models/semantic_layer/semantic_layer.yml"
    )
    sem = yaml.safe_load(semantic_path.read_text(encoding="utf-8"))
    certified = {str(m["name"]) for m in sem.get("metrics") or []}
    missing = certified - metrics
    assert not missing, f"missing templates: {sorted(missing)[:5]}"
    for mid, spec in (data.get("metrics") or {}).items():
        sql = str(spec.get("sql") or "")
        assert "{{extra_where}}" in sql or "%s" not in sql, mid


def test_mf_cache_hit_skips_engine() -> None:
    from semantic.metricflow.engine import run_metricflow_query

    clear_sql_cache()
    prepared = _simple_prepared(
        group_by_requested=["priority"],
        group_by=["ticket__priority"],
        metrics=["ticket_volume"],
    )
    key = cache_key_for_prepared(prepared)
    set_cached_sql(key, "SELECT 1 AS ticket_volume")
    with patch(
        "semantic.metricflow.engine._execute_rendered_sql",
        return_value=[{"ticket_volume": 1}],
    ) as exec_sql:
        with patch("semantic.metricflow.engine._get_engine") as get_engine:
            result = run_metricflow_query(prepared)
    get_engine.assert_not_called()
    exec_sql.assert_called_once()
    assert result["path"] == "cache_hit"


def test_sql_metric_request_template_only() -> None:
    req = SqlQueryRequest(
        organization_id=1000,
        user_id=1001,
        origin_product="ticketing",
        origin_agent="analytics_audit_query_executor",
        instruction="how many open tickets",
        metric_request={
            "organizationId": 1000,
            "userId": 1001,
            "product": "ticketing",
            "agent": "analytics_audit_query_executor",
            "metrics": ["open_tickets_metric"],
        },
    )
    with patch(
        "semantic.sql.mas.orchestrator.semantic_execute",
        return_value={"rows": [{"open_tickets_metric": 2}], "source": "sql_template", "sql": "SELECT 2"},
    ) as sem_exec:
        with patch("semantic.sql.super._metric_template_query") as tpl:
            result = execute_sql_query(req)
    assert result["source"] == "sql_template"
    sem_exec.assert_called_once()
    tpl.assert_not_called()


def test_sql_list_no_kpi_inference() -> None:
    from semantic.sql.super import SqlAgentError

    req = SqlQueryRequest(
        organization_id=1000,
        user_id=1001,
        origin_product="ticketing",
        origin_agent="ticket_lifecycle_executor",
        instruction="how many open tickets",
        entity_hint="wt:Ticket",
    )
    with patch("semantic.sql.mas.super_planner.resolve_agent_policy") as pol:
        pol.return_value = {
            "list_only": True,
            "agent": "ticket_lifecycle_executor",
            "allowed_metrics": set(),
        }
        try:
            execute_sql_query(req)
            raise AssertionError("expected SqlAgentError for lifecycle KPI")
        except SqlAgentError:
            pass


def test_sql_count_total_tickets() -> None:
    from semantic.sql.agent_policy import detect_count_metrics

    policy = {"list_only": True, "allowed_metrics": set()}
    mids = detect_count_metrics(
        "what is the count of total tickets available",
        policy,
        "ticketing",
    )
    assert mids == []

    hp = detect_count_metrics(
        "how many high priority open tickets",
        policy,
        "ticketing",
    )
    assert hp == []

    from semantic.sql.super import SqlAgentError

    req = SqlQueryRequest(
        organization_id=1000,
        user_id=1001,
        origin_product="ticketing",
        origin_agent="ticket_lifecycle_executor",
        instruction="what is the count of total tickets available",
        entity_hint="wt:Ticket",
    )
    with patch("semantic.sql.mas.super_planner.resolve_agent_policy") as pol:
        pol.return_value = {
            "list_only": True,
            "agent": "ticket_lifecycle_executor",
            "allowed_metrics": set(),
        }
        try:
            execute_sql_query(req)
            raise AssertionError("expected SqlAgentError for lifecycle count")
        except SqlAgentError:
            pass


def main() -> int:
    tests = [
        test_can_use_sql_template_scalar,
        test_can_use_sql_template_rejects_group_by,
        test_can_use_sql_template_rejects_grain,
        test_execute_sql_template_path,
        test_execute_denies_non_reporting_agent,
        test_sql_cache_roundtrip,
        test_pg_pool_checkout_release,
        test_reload_clears_sql_cache,
        test_allowlist_uses_resolve_context,
        test_template_execute_reuses_prepared_scope,
        test_execute_includes_prepare_ms,
        test_all_ticketing_templates_present,
        test_mf_cache_hit_skips_engine,
        test_sql_metric_request_template_only,
        test_sql_list_no_kpi_inference,
        test_sql_count_total_tickets,
    ]
    # high priority count routes to volume metric, not list
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
        except Exception as exc:
            failed += 1
            print(f"  FAIL  {fn.__name__}: {exc}")
    print(f"\n{failed} failures")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
