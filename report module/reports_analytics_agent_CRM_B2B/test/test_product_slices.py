"""Live checks for product slices. Run from repo root with myenv python -m pytest reports_analytics_agent_CRM_B2B/test -q"""

from __future__ import annotations

from reports_analytics_agent_CRM_B2B.core.run_kpi import run_kpi
from reports_analytics_agent_CRM_B2B.core.run_sql import run_sql
from reports_analytics_agent_CRM_B2B.core.validate import run_validation

ORG, USER, ROLE = 1003, 1017, "admin"


def test_catalog_still_validates():
    assert run_validation() is True


def test_existing_deal_count_unchanged():
    res = run_kpi("total_opportunities", organization_id=ORG, user_id=USER, role=ROLE)
    assert res.get("status") == "ok"
    assert res.get("kpi_id") == "total_opportunities"
    rows = res.get("rows") or []
    assert len(rows) == 1
    assert int(rows[0]["total_opportunities"]) >= 0


def test_existing_product_revenue_still_runs():
    res = run_kpi("product_revenue", organization_id=ORG, user_id=USER, role=ROLE)
    assert res.get("kpi_id") == "product_revenue"
    assert res.get("status") in {"ok", "success"}
    assert "ambiguous" not in (res.get("error") or "").lower()


def test_deals_by_product():
    res = run_kpi("deals_by_product", organization_id=ORG, user_id=USER, role=ROLE)
    assert res.get("status") == "ok", res.get("error")
    rows = res.get("rows") or []
    assert isinstance(rows, list)
    if rows:
        assert "product_name" in rows[0]
        assert "deal_count" in rows[0]


def test_deals_by_product_owner():
    res = run_kpi(
        "deals_by_product",
        organization_id=ORG,
        user_id=USER,
        role=ROLE,
        dimension="owner",
    )
    assert res.get("status") == "ok", res.get("error")
    assert "ambiguous" not in (res.get("error") or "").lower()


def test_invoice_amount_by_product():
    res = run_kpi("invoice_amount_by_product", organization_id=ORG, user_id=USER, role=ROLE)
    assert res.get("status") == "ok", res.get("error")
    rows = res.get("rows") or []
    if rows:
        assert "product_name" in rows[0]
        assert "invoice_amount" in rows[0]


def test_invoice_amount_by_product_owner_and_time():
    res = run_kpi(
        "invoice_amount_by_product",
        organization_id=ORG,
        user_id=USER,
        role=ROLE,
        dimension="owner",
        time_window="last 30 days",
    )
    assert res.get("status") == "ok", res.get("error")
    assert "ambiguous" not in (res.get("error") or "").lower()


def test_free_sql_list_products():
    res = run_sql(
        "SELECT id, name, sku, billing_type, is_active FROM rpt.products ORDER BY name LIMIT 50",
        organization_id=ORG,
        user_id=USER,
        role=ROLE,
    )
    assert res.get("status") == "ok", res.get("error")
    assert isinstance(res.get("rows"), list)
