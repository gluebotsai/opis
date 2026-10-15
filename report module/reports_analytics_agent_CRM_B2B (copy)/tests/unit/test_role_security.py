import pytest
from reports_analytics_agent_CRM_B2B.core.run_sql import run_sql
from reports_analytics_agent_CRM_B2B.core.sql_guard import guard_sql, GuardError


def test_admin_full_org_access():
    """Admin can query rpt.deals and see all tenant records."""
    res = run_sql(
        "SELECT COUNT(*)::bigint AS cnt FROM rpt.deals",
        organization_id=1003,
        user_id=1017,
        role="admin",
    )
    assert res["status"] == "ok"
    assert len(res["rows"]) == 1
    assert res["rows"][0]["cnt"] == 14


def test_sales_manager_full_org_access():
    """Sales manager can query rpt.deals and see all tenant records."""
    res = run_sql(
        "SELECT COUNT(*)::bigint AS cnt FROM rpt.deals",
        organization_id=1003,
        user_id=1017,
        role="sales_manager",
    )
    assert res["status"] == "ok"
    assert len(res["rows"]) == 1
    assert res["rows"][0]["cnt"] == 14


def test_sales_rep_owner_scoped_access():
    """Sales rep 1017 can only see deals they own (3 deals in Org 1003)."""
    res = run_sql(
        "SELECT COUNT(*)::bigint AS cnt FROM rpt.deals",
        organization_id=1003,
        user_id=1017,
        role="sales_rep",
    )
    assert res["status"] == "ok"
    assert len(res["rows"]) == 1
    assert res["rows"][0]["cnt"] == 3


def test_sales_rep_fail_closed_sentinel():
    """When user_id is 0, sales_rep query must return 0 rows."""
    res = run_sql(
        "SELECT COUNT(*)::bigint AS cnt FROM rpt.deals",
        organization_id=1003,
        user_id=0,
        role="sales_rep",
    )
    assert res["status"] == "ok"
    assert len(res["rows"]) == 1
    assert res["rows"][0]["cnt"] == 0


def test_marketing_role_deal_denial():
    """Marketing role querying rpt.deals returns 0 rows (1=0 scope)."""
    res = run_sql(
        "SELECT COUNT(*)::bigint AS cnt FROM rpt.deals",
        organization_id=1003,
        user_id=1017,
        role="marketing",
    )
    assert res["status"] == "ok"
    assert len(res["rows"]) == 1
    assert res["rows"][0]["cnt"] == 0


def test_marketing_role_invoice_denial():
    """Marketing role querying rpt.invoices returns 0 rows (1=0 scope)."""
    res = run_sql(
        "SELECT COUNT(*)::bigint AS cnt FROM rpt.invoices",
        organization_id=1003,
        user_id=1017,
        role="marketing",
    )
    assert res["status"] == "ok"
    assert len(res["rows"]) == 1
    assert res["rows"][0]["cnt"] == 0


def test_finance_role_invoices_access():
    """Finance role can query all invoices across organization (3 invoices in Org 1003)."""
    res = run_sql(
        "SELECT COUNT(*)::bigint AS cnt FROM rpt.invoices",
        organization_id=1003,
        user_id=1017,
        role="finance",
    )
    assert res["status"] == "ok"
    assert len(res["rows"]) == 1
    assert res["rows"][0]["cnt"] == 3


def test_finance_role_agent_jobs_denial():
    """Finance role cannot access agent operations jobs (1=0 scope)."""
    res = run_sql(
        "SELECT COUNT(*)::bigint AS cnt FROM rpt.agent_jobs",
        organization_id=1003,
        user_id=1017,
        role="finance",
    )
    assert res["status"] == "ok"
    assert len(res["rows"]) == 1
    assert res["rows"][0]["cnt"] == 0


def test_viewer_role_read_only_own_records():
    """Viewer can only see own records, not invoices or contracts."""
    res_deals = run_sql(
        "SELECT COUNT(*)::bigint AS cnt FROM rpt.deals",
        organization_id=1003,
        user_id=1017,
        role="viewer",
    )
    assert res_deals["status"] == "ok"
    assert res_deals["rows"][0]["cnt"] == 3

    res_inv = run_sql(
        "SELECT COUNT(*)::bigint AS cnt FROM rpt.invoices",
        organization_id=1003,
        user_id=1017,
        role="viewer",
    )
    assert res_inv["status"] == "ok"
    assert res_inv["rows"][0]["cnt"] == 0
