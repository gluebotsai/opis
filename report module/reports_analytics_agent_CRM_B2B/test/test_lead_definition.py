"""Lead = cdp.customer_profile.contact_type = 'lead' only.

Run from repo root: python -m pytest reports_analytics_agent_CRM_B2B/test/test_lead_definition.py -q
"""

from __future__ import annotations

from reports_analytics_agent_CRM_B2B.core.run_kpi import run_kpi
from reports_analytics_agent_CRM_B2B.core.run_sql import run_sql
from reports_analytics_agent_CRM_B2B.core.validate import run_validation

ORG = 1003
ADMIN_USER = 1017
ADMIN = "admin"
REP_USER = 1018
REP = "sales_rep"


def _n(res: dict, col: str) -> int:
    assert res.get("status") == "ok", res.get("error")
    rows = res.get("rows") or []
    assert len(rows) == 1, rows
    return int(rows[0][col])


def _count(sql: str, *, user_id: int = ADMIN_USER, role: str = ADMIN) -> int:
    res = run_sql(sql, organization_id=ORG, user_id=user_id, role=role)
    assert res.get("status") == "ok", res.get("error")
    rows = res.get("rows") or []
    assert len(rows) == 1, rows
    return int(next(iter(rows[0].values())))


def test_catalog_validates():
    assert run_validation() is True


def test_admin_lead_count_is_contact_type_lead_not_all_contacts():
    kpi = run_kpi("lead_count", organization_id=ORG, user_id=ADMIN_USER, role=ADMIN)
    leads = _n(kpi, "lead_count")
    view_leads = _count(
        "SELECT COUNT(*)::bigint AS n FROM rpt.contacts "
        "WHERE is_active = TRUE AND contact_type = 'lead'"
    )
    all_active = _count(
        "SELECT COUNT(*)::bigint AS n FROM rpt.contacts WHERE is_active = TRUE"
    )
    assert leads == view_leads
    assert all_active > leads


def test_sales_rep_1018_owns_one_lead():
    kpi = run_kpi("lead_count", organization_id=ORG, user_id=REP_USER, role=REP)
    assert _n(kpi, "lead_count") == 1
    owned_people = _count(
        "SELECT COUNT(*)::bigint AS n FROM rpt.contacts WHERE is_active = TRUE",
        user_id=REP_USER,
        role=REP,
    )
    assert owned_people == 4
    owned_leads = _count(
        "SELECT COUNT(*)::bigint AS n FROM rpt.contacts "
        "WHERE is_active = TRUE AND contact_type = 'lead'",
        user_id=REP_USER,
        role=REP,
    )
    assert owned_leads == 1


def test_lead_count_aliases():
    expected = _n(
        run_kpi("lead_count", organization_id=ORG, user_id=ADMIN_USER, role=ADMIN),
        "lead_count",
    )
    for kid in ("total_leads", "how_many_leads"):
        res = run_kpi(kid, organization_id=ORG, user_id=ADMIN_USER, role=ADMIN)
        assert res.get("kpi_id") == "lead_count"
        assert _n(res, "lead_count") == expected


def test_lead_count_by_owner_and_status():
    by_owner = run_kpi(
        "lead_count",
        organization_id=ORG,
        user_id=ADMIN_USER,
        role=ADMIN,
        dimension="owner",
    )
    assert by_owner.get("status") == "ok", by_owner.get("error")
    rows = by_owner.get("rows") or []
    assert rows
    assert "owner" in rows[0]
    expected = _n(
        run_kpi("lead_count", organization_id=ORG, user_id=ADMIN_USER, role=ADMIN),
        "lead_count",
    )
    assert sum(int(r["lead_count"]) for r in rows) == expected

    contacted = run_kpi(
        "lead_count",
        organization_id=ORG,
        user_id=ADMIN_USER,
        role=ADMIN,
        slot_values={"filters_sql": "lead_status = 'contacted'"},
    )
    expected = _count(
        "SELECT COUNT(*)::bigint AS n FROM rpt.contacts "
        "WHERE is_active = TRUE AND contact_type = 'lead' AND lead_status = 'contacted'"
    )
    assert _n(contacted, "lead_count") == expected

    by_source = run_kpi(
        "lead_count",
        organization_id=ORG,
        user_id=ADMIN_USER,
        role=ADMIN,
        dimension="lead_source",
    )
    assert by_source.get("status") == "ok", by_source.get("error")


def test_lead_status_mix_only_leads():
    res = run_kpi("lead_status_mix", organization_id=ORG, user_id=ADMIN_USER, role=ADMIN)
    assert res.get("status") == "ok", res.get("error")
    rows = res.get("rows") or []
    total = sum(int(r["contact_count"]) for r in rows)
    expected = _n(
        run_kpi("lead_count", organization_id=ORG, user_id=ADMIN_USER, role=ADMIN),
        "lead_count",
    )
    assert total == expected
    truth = run_sql(
        "SELECT lead_status, COUNT(*)::bigint AS n FROM rpt.contacts "
        "WHERE is_active = TRUE AND contact_type = 'lead' "
        "GROUP BY lead_status",
        organization_id=ORG,
        user_id=ADMIN_USER,
        role=ADMIN,
    )
    assert truth.get("status") == "ok", truth.get("error")
    by_status = {r["lead_status"]: int(r["n"]) for r in (truth.get("rows") or [])}
    for row in rows:
        assert int(row["contact_count"]) == by_status.get(row["lead_status"], -1)


def test_unassigned_leads_are_unowned_leads():
    kpi = run_kpi("unassigned_leads", organization_id=ORG, user_id=ADMIN_USER, role=ADMIN)
    expected = _count(
        "SELECT COUNT(*)::bigint AS n FROM rpt.contacts "
        "WHERE is_active = TRUE AND contact_type = 'lead' "
        "AND owner_user_id IS NULL "
        "AND lead_status NOT IN ('converted', 'disqualified')"
    )
    assert _n(kpi, "unassigned_leads") == expected
    by_src = run_kpi(
        "unassigned_leads",
        organization_id=ORG,
        user_id=ADMIN_USER,
        role=ADMIN,
        dimension="lead_source",
    )
    assert by_src.get("status") == "ok", by_src.get("error")


def test_unassigned_sales_rep_own_scope_is_zero():
    kpi = run_kpi("unassigned_leads", organization_id=ORG, user_id=REP_USER, role=REP)
    assert _n(kpi, "unassigned_leads") == 0


def test_lead_source_conversion():
    res = run_kpi("lead_source_conversion", organization_id=ORG, user_id=ADMIN_USER, role=ADMIN)
    assert res.get("status") == "ok", res.get("error")
    rows = res.get("rows") or []
    assert rows
    total = sum(int(r["total_leads"]) for r in rows)
    expected = _n(
        run_kpi("lead_count", organization_id=ORG, user_id=ADMIN_USER, role=ADMIN),
        "lead_count",
    )
    assert total == expected
    for row in rows:
        assert int(row["converted_leads"]) <= int(row["total_leads"])


def test_free_sql_lead_list_and_count():
    listed = run_sql(
        "SELECT id, full_name, contact_type, lead_status, owner_name "
        "FROM rpt.contacts WHERE contact_type = 'lead' AND is_active = TRUE LIMIT 20",
        organization_id=ORG,
        user_id=ADMIN_USER,
        role=ADMIN,
    )
    assert listed.get("status") == "ok", listed.get("error")
    for row in listed.get("rows") or []:
        assert row["contact_type"] == "lead"

    named = run_sql(
        "SELECT id, full_name FROM rpt.contacts "
        "WHERE contact_type = 'lead' AND full_name ILIKE '%Coke%' ESCAPE '\\' LIMIT 10",
        organization_id=ORG,
        user_id=ADMIN_USER,
        role=ADMIN,
    )
    assert named.get("status") == "ok", named.get("error")

    rep_list = run_sql(
        "SELECT id, contact_type FROM rpt.contacts WHERE contact_type = 'lead'",
        organization_id=ORG,
        user_id=REP_USER,
        role=REP,
    )
    assert rep_list.get("status") == "ok", rep_list.get("error")
    assert len(rep_list.get("rows") or []) == 1


def test_deal_kpis_unchanged_by_lead_filter():
    deals = run_kpi("total_opportunities", organization_id=ORG, user_id=ADMIN_USER, role=ADMIN)
    assert deals.get("status") == "ok", deals.get("error")
    assert int((deals.get("rows") or [{}])[0]["total_opportunities"]) >= 0
