"""Region slices/lists and remaining = total − follow-up.

Run: python -m pytest reports_analytics_agent_CRM_B2B/test/test_region_and_remaining.py -q
"""

from __future__ import annotations

from reports_analytics_agent_CRM_B2B.core.analysis import remaining_after_followup
from reports_analytics_agent_CRM_B2B.core.run_kpi import run_kpi
from reports_analytics_agent_CRM_B2B.core.run_sql import run_sql
from reports_analytics_agent_CRM_B2B.core.validate import run_validation

ORG, USER, ROLE = 1003, 1017, "admin"


def _n(res: dict, col: str) -> int:
    assert res.get("status") == "ok", res.get("error")
    rows = res.get("rows") or []
    assert len(rows) == 1, rows
    return int(rows[0][col])


def test_catalog_validates_with_region():
    assert run_validation() is True


def test_lead_count_by_region():
    res = run_kpi("lead_count", organization_id=ORG, user_id=USER, role=ROLE, dimension="region")
    assert res.get("status") == "ok", res.get("error")
    rows = res.get("rows") or []
    assert rows
    assert "region" in rows[0]
    total = sum(int(r["lead_count"]) for r in rows)
    overall = _n(run_kpi("lead_count", organization_id=ORG, user_id=USER, role=ROLE), "lead_count")
    assert total == overall


def test_named_region_count_and_list():
    counted = run_kpi(
        "lead_count",
        organization_id=ORG,
        user_id=USER,
        role=ROLE,
        slot_values={"filters_sql": "region ILIKE '%TN%' ESCAPE '\\'"},
    )
    n = _n(counted, "lead_count")
    listed = run_sql(
        "SELECT id, full_name, company_name, region, lead_status, owner_name "
        "FROM rpt.contacts "
        "WHERE is_active = TRUE AND contact_type = 'lead' "
        "AND region ILIKE '%TN%' ESCAPE '\\' "
        "LIMIT 50",
        organization_id=ORG,
        user_id=USER,
        role=ROLE,
    )
    assert listed.get("status") == "ok", listed.get("error")
    rows = listed.get("rows") or []
    assert n == len(rows) or n > 50  # list is capped
    for row in rows:
        assert "TN" in str(row.get("region") or "").upper()


def test_remaining_plus_followup_equals_total():
    total = _n(run_kpi("lead_count", organization_id=ORG, user_id=USER, role=ROLE), "lead_count")
    follow = _n(
        run_kpi("follow_up_leads", organization_id=ORG, user_id=USER, role=ROLE),
        "follow_up_leads",
    )
    remaining = _n(
        run_kpi("remaining_leads", organization_id=ORG, user_id=USER, role=ROLE),
        "remaining_leads",
    )
    assert remaining_after_followup(20, 19) == 1
    assert remaining_after_followup(total, follow) == remaining
    assert remaining + follow == total
    assert remaining != 0 or follow == total


def test_remaining_is_not_the_followup_set():
    follow_as_remaining = run_kpi(
        "remaining_leads",
        organization_id=ORG,
        user_id=USER,
        role=ROLE,
        slot_values={"filters_sql": "needs_followup = TRUE"},
    )
    # If someone reuses the follow-up filter, remaining is empty — that is the bug.
    # Certified remaining_leads without that filter must not match it when both groups exist.
    remaining = _n(
        run_kpi("remaining_leads", organization_id=ORG, user_id=USER, role=ROLE),
        "remaining_leads",
    )
    follow = _n(
        run_kpi("follow_up_leads", organization_id=ORG, user_id=USER, role=ROLE),
        "follow_up_leads",
    )
    if follow > 0 and remaining > 0:
        assert _n(follow_as_remaining, "remaining_leads") == 0
        assert remaining != follow
