import pytest
from reports_analytics_agent_CRM_B2B.core.run_kpi import run_kpi
from reports_analytics_agent_CRM_B2B.core.errors import UnavailableKPIError, AccessDeniedError


def test_run_total_pipeline_admin():
    res = run_kpi("total_pipeline", organization_id=1003, user_id=1017, role="admin")
    assert res["kpi_id"] == "total_pipeline"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_total_pipeline_by_industry():
    res = run_kpi("total_pipeline", organization_id=1003, user_id=1017, role="admin", dimension="industry")
    assert res["kpi_id"] == "total_pipeline"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_total_pipeline_by_owner():
    res = run_kpi("total_pipeline", organization_id=1003, user_id=1017, role="sales_manager", dimension="owner")
    assert res["kpi_id"] == "total_pipeline"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_won_revenue_by_industry():
    res = run_kpi("won_revenue", organization_id=1003, user_id=1017, role="admin", dimension="industry")
    assert res["kpi_id"] == "won_revenue"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_win_rate_by_owner():
    res = run_kpi("win_rate", organization_id=1003, user_id=1017, role="sales_manager", dimension="owner")
    assert res["kpi_id"] == "win_rate"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_win_rate_manager():
    res = run_kpi("win_rate", organization_id=1003, user_id=1017, role="sales_manager")
    assert res["kpi_id"] == "win_rate"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_sales_velocity():
    res = run_kpi("sales_velocity", organization_id=1003, user_id=1017, role="admin")
    assert res["kpi_id"] == "sales_velocity"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_pipeline_by_owner():
    res = run_kpi("pipeline_by_owner", organization_id=1003, user_id=1017, role="sales_manager")
    assert res["kpi_id"] == "pipeline_by_owner"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_aging_bands():
    res = run_kpi("aging_bands", organization_id=1003, user_id=1017, role="admin")
    assert res["kpi_id"] == "aging_bands"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_deal_size_bands():
    res = run_kpi("deal_size_bands", organization_id=1003, user_id=1017, role="admin")
    assert res["kpi_id"] == "deal_size_bands"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_invoice_outstanding():
    res = run_kpi("invoice_outstanding", organization_id=1003, user_id=1017, role="finance")
    assert res["kpi_id"] == "invoice_outstanding"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_overdue_amount():
    res = run_kpi("overdue_amount", organization_id=1003, user_id=1017, role="finance")
    assert res["kpi_id"] == "overdue_amount"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_collected_revenue():
    res = run_kpi("collected_revenue", organization_id=1003, user_id=1017, role="finance")
    assert res["kpi_id"] == "collected_revenue"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_contract_arr():
    res = run_kpi("contract_arr", organization_id=1003, user_id=1017, role="finance")
    assert res["kpi_id"] == "contract_arr"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_product_revenue():
    res = run_kpi("product_revenue", organization_id=1003, user_id=1017, role="admin")
    assert res["kpi_id"] == "product_revenue"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_activity_volume():
    res = run_kpi("activity_volume", organization_id=1003, user_id=1017, role="sales_manager")
    assert res["kpi_id"] == "activity_volume"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_activity_volume_by_owner():
    res = run_kpi(
        "activity_volume",
        organization_id=1003,
        user_id=1017,
        role="admin",
        dimension="owner",
    )
    assert res["kpi_id"] == "activity_volume"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_activity_volume_by_activity_source():
    res = run_kpi(
        "activity_volume",
        organization_id=1003,
        user_id=1017,
        role="admin",
        dimension="activity_source",
    )
    assert res["kpi_id"] == "activity_volume"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_meeting_completion_by_host():
    res = run_kpi(
        "meeting_completion",
        organization_id=1003,
        user_id=1017,
        role="admin",
        dimension="host",
    )
    assert res["kpi_id"] == "meeting_completion"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_lead_status_mix():
    res = run_kpi("lead_status_mix", organization_id=1003, user_id=1017, role="sales_manager")
    assert res["kpi_id"] == "lead_status_mix"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_territory_performance():
    res = run_kpi("territory_performance", organization_id=1003, user_id=1017, role="admin")
    assert res["kpi_id"] == "territory_performance"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_lead_source_conversion():
    res = run_kpi("lead_source_conversion", organization_id=1003, user_id=1017, role="admin")
    assert res["kpi_id"] == "lead_source_conversion"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_attach_rate():
    res = run_kpi("attach_rate", organization_id=1003, user_id=1017, role="admin")
    assert res["kpi_id"] == "attach_rate"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_customer_retention():
    res = run_kpi("customer_retention", organization_id=1003, user_id=1017, role="admin")
    assert res["kpi_id"] == "customer_retention"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_meeting_completion():
    res = run_kpi("meeting_completion", organization_id=1003, user_id=1017, role="sales_manager")
    assert res["kpi_id"] == "meeting_completion"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_agent_operations():
    res = run_kpi("agent_operations", organization_id=1003, user_id=1017, role="admin")
    assert res["kpi_id"] == "agent_operations"
    assert res["status"] == "ok"
    assert isinstance(res.get("rows"), list)


def test_run_product_revenue_last_30_days():
    res = run_kpi(
        "product_revenue",
        organization_id=1003,
        user_id=1017,
        role="admin",
        time_window="last 30 days",
    )
    assert res.get("error_type") != "REPAIR"
    assert res["status"] in {"ok", "success"}
    assert "ambiguous" not in (res.get("error") or "").lower()


def test_run_territory_performance_this_month():
    res = run_kpi(
        "territory_performance",
        organization_id=1003,
        user_id=1017,
        role="admin",
        time_window="this month",
    )
    assert res.get("error_type") != "REPAIR"
    assert res["status"] in {"ok", "success"}
    assert "ambiguous" not in (res.get("error") or "").lower()


def test_run_invoice_outstanding_zero_row():
    res = run_kpi("invoice_outstanding", organization_id=1003, user_id=1017, role="finance")
    assert res["status"] == "ok"
    assert len(res.get("rows") or []) == 1
    assert float(res["rows"][0]["outstanding_amount"]) == 0.0


def test_run_unavailable_kpi_refusal():
    res = run_kpi("quota_attainment", organization_id=1003, user_id=1017, role="sales_manager")
    assert res["status"] == "error"
    assert res["error_type"] == "UNAVAILABLE_KPI"
    assert "CRM does not store monthly sales targets" in res["error"]

