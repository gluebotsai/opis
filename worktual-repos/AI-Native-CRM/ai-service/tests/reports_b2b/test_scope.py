from app.agents.reports_b2b.core.scope import (
    default_scope_for_role,
    resolve_scope_level,
)


def test_default_scope_sales_rep_is_own():
    assert default_scope_for_role("sales_rep") == "own"
    assert default_scope_for_role("admin") == "org"


def test_sales_rep_org_clamps_to_own():
    scope, err = resolve_scope_level(role="sales_rep", requested="org", kpi_id="lead_count")
    assert err is None
    assert scope == "own"


def test_viewer_team_scope_denied():
    scope, err = resolve_scope_level(role="viewer", requested="team", kpi_id="lead_count")
    assert err is not None
    assert err.get("error_type") == "ACCESS_DENIED"
