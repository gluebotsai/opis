"""Unit tests for ticketing time aliases and org-param binding."""

from __future__ import annotations

from semantic.sql.metric_fallback import _replace_org_where_params
from semantic.time_resolver import resolve_time_window


def test_last_7d_alias_resolves_dates() -> None:
    out = resolve_time_window({"period": "last_7d"})
    assert out.get("start")
    assert out.get("end")
    assert out["start"] <= out["end"]


def test_last_30d_alias_resolves_dates() -> None:
    out = resolve_time_window({"period": "last_30d"})
    assert out.get("start")
    assert out.get("end")


def test_all_time_clears_bounds() -> None:
    out = resolve_time_window({"period": "all_time", "start": "2020-01-01"})
    assert out.get("period") == "overall"
    assert "start" not in out


def test_org_where_glued_extra_where_params() -> None:
    sql = "SELECT 1 FROM t WHERE organization_id = %s{{extra_where}}"
    where = " AND created_at >= %s AND created_at <= %s"
    params_extra = ["2026-09-01", "2026-09-07 23:59:59"]
    out_sql, params = _replace_org_where_params(
        sql,
        org="1012",
        where_default=where,
        params_default=params_extra,
        where_sessions=where,
        params_sessions=params_extra,
        where_events=where,
        params_events=params_extra,
    )
    assert out_sql.count("%s") == 3
    assert params == ["1012", "2026-09-01", "2026-09-07 23:59:59"]
    assert "{{extra_where}}" not in out_sql


def test_org_where_orphan_extra_where_param_order() -> None:
    sql = (
        "SELECT 1 FROM t WHERE organization_id = %s "
        "AND csat_score IS NOT NULL{{extra_where}}"
    )
    where = " AND created_at >= %s AND created_at <= %s"
    params_extra = ["2026-09-14", "2026-09-20 23:59:59"]
    out_sql, params = _replace_org_where_params(
        sql,
        org="1012",
        where_default=where,
        params_default=params_extra,
        where_sessions="",
        params_sessions=[],
        where_events="",
        params_events=[],
    )
    assert params == ["1012", "2026-09-14", "2026-09-20 23:59:59"]
    assert out_sql.count("%s") == 3
    assert "{{extra_where}}" not in out_sql


def test_org_where_no_double_org_param() -> None:
    sql = "SELECT 1 FROM t WHERE organization_id = %s{{extra_where}}"
    out_sql, params = _replace_org_where_params(
        sql,
        org="1012",
        where_default="",
        params_default=[],
        where_sessions="",
        params_sessions=[],
        where_events="",
        params_events=[],
    )
    assert params == ["1012"]
    assert out_sql.count("%s") == 1
