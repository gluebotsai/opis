from __future__ import annotations

import importlib
from datetime import datetime


def _product(tmp_path):
    sql_dir = tmp_path / "sql"
    sql_dir.mkdir()
    (sql_dir / "total_pipeline.sql").write_text(
        "SELECT COALESCE(SUM(amount), 0) AS total_pipeline "
        "FROM rpt.deals WHERE {{filters_sql}}"
    )
    (sql_dir / "lead_count.sql").write_text(
        "SELECT COUNT(*) AS lead_count FROM rpt.contacts WHERE {{filters_sql}}"
    )
    return tmp_path


def test_run_kpi_binds_named_owner_filter(monkeypatch, tmp_path):
    mod = importlib.import_module("app.agents.reports_b2b.core.run_kpi")
    captured = {}

    monkeypatch.setattr(
        mod,
        "load_kpis",
        lambda: {
            "total_pipeline": {
                "allowed_dimensions": ["owner"],
                "default_time_column": "created_at",
            }
        },
    )

    def fake_run_sql(sql, **kwargs):
        captured.update(sql=sql, params=kwargs["params"])
        return {"status": "ok", "rows": [{"total_pipeline": 325000}]}

    monkeypatch.setattr(mod, "run_sql", fake_run_sql)
    mod.run_kpi(
        "total_pipeline",
        owner_name="Raghuram M",
        product_dir=_product(tmp_path),
    )

    assert "owner_name ILIKE :owner_name" in captured["sql"]
    assert captured["params"]["owner_name"] == "%Raghuram M%"


def test_run_kpi_binds_lead_status_filter(monkeypatch, tmp_path):
    mod = importlib.import_module("app.agents.reports_b2b.core.run_kpi")
    captured = {}

    monkeypatch.setattr(
        mod,
        "load_kpis",
        lambda: {
            "lead_count": {
                "allowed_dimensions": ["owner"],
                "default_time_column": "created_at",
            }
        },
    )

    def fake_run_sql(sql, **kwargs):
        captured.update(sql=sql, params=kwargs["params"])
        return {"status": "ok", "rows": [{"lead_count": 5}]}

    monkeypatch.setattr(mod, "run_sql", fake_run_sql)
    mod.run_kpi(
        "lead_count",
        status_filter="contacted",
        product_dir=_product(tmp_path),
    )

    assert "LOWER(lead_status) = LOWER(:status_filter)" in captured["sql"]
    assert captured["params"]["status_filter"] == "contacted"


def test_run_kpi_binds_multiple_named_owners(monkeypatch, tmp_path):
    mod = importlib.import_module("app.agents.reports_b2b.core.run_kpi")
    captured = {}
    monkeypatch.setattr(
        mod,
        "load_kpis",
        lambda: {
            "total_pipeline": {
                "allowed_dimensions": ["owner"],
                "default_time_column": "created_at",
            }
        },
    )

    def fake_run_sql(sql, **kwargs):
        captured.update(sql=sql, params=kwargs["params"])
        return {"status": "ok", "rows": []}

    monkeypatch.setattr(mod, "run_sql", fake_run_sql)
    mod.run_kpi(
        "total_pipeline",
        owner_names=["Raghuram M", "Manoj M"],
        product_dir=_product(tmp_path),
    )

    assert "owner_name ILIKE :owner_name_0" in captured["sql"]
    assert "owner_name ILIKE :owner_name_1" in captured["sql"]
    assert captured["params"]["owner_name_0"] == "%Raghuram M%"
    assert captured["params"]["owner_name_1"] == "%Manoj M%"


def test_run_kpi_passes_naive_datetime_bounds_to_warehouse(monkeypatch, tmp_path):
    mod = importlib.import_module("app.agents.reports_b2b.core.run_kpi")
    captured = {}
    monkeypatch.setattr(
        mod,
        "load_kpis",
        lambda: {
            "lead_count": {
                "allowed_dimensions": ["owner"],
                "default_time_column": "created_at",
            }
        },
    )
    monkeypatch.setattr(
        mod,
        "resolve_expression",
        lambda _phrase: type(
            "Bounds",
            (),
            {
                "status": "bounded",
                "start": datetime.fromisoformat("2026-10-05T00:00:00+00:00"),
                "end": datetime.fromisoformat("2026-10-06T00:00:00+00:00"),
                "echo": "yesterday (UTC)",
            },
        )(),
    )

    def fake_run_sql(sql, **kwargs):
        captured.update(sql=sql, params=kwargs["params"])
        return {"status": "ok", "rows": [{"lead_count": 0}]}

    monkeypatch.setattr(mod, "run_sql", fake_run_sql)
    mod.run_kpi(
        "lead_count",
        time_window="yesterday",
        product_dir=_product(tmp_path),
    )

    assert captured["params"]["start"].tzinfo is None
    assert captured["params"]["end"].tzinfo is None


def test_sales_lead_count_scope_is_owner_or_creator(monkeypatch, tmp_path):
    mod = importlib.import_module("app.agents.reports_b2b.core.run_kpi")
    captured = {}
    monkeypatch.setattr(
        mod,
        "load_kpis",
        lambda: {
            "lead_count": {
                "allowed_dimensions": ["owner", "region"],
                "default_time_column": "created_at",
                "aggregation": "count",
            }
        },
    )

    def fake_run_sql(sql, **kwargs):
        captured["overrides"] = kwargs.get("view_scope_overrides")
        return {"status": "ok", "rows": [{"lead_count": 1}]}

    monkeypatch.setattr(mod, "run_sql", fake_run_sql)
    product = _product(tmp_path)
    mod.run_kpi("lead_count", role="sales_rep", product_dir=product)
    assert "created_by_user_id" in captured["overrides"]["contacts"]

    mod.run_kpi("lead_count", role="admin", product_dir=product)
    assert captured["overrides"] is None


def test_not_high_compiles_the_complement(monkeypatch):
    mod = importlib.import_module("app.agents.reports_b2b.core.run_kpi")
    captured = {}
    monkeypatch.setattr(
        mod,
        "load_kpis",
        lambda: {
            "high_probability_deals": {
                "allowed_dimensions": [],
                "default_time_column": "created_at",
                "aggregation": "count",
            }
        },
    )

    def fake_run_sql(sql, **kwargs):
        captured["sql"] = sql
        return {"status": "ok", "rows": [{"high_probability_deals": 2}]}

    monkeypatch.setattr(mod, "run_sql", fake_run_sql)
    mod.run_kpi("high_probability_deals", term="not_high", role="admin")
    assert "stage_weight < 0.75" in captured["sql"]
