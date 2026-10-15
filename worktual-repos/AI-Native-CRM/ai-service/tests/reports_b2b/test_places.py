from app.agents.reports_b2b.core.places import match_place
from app.agents.reports_b2b.core.templates import fill_slots


def test_region_case_folds_to_one_stored_value():
    matched = match_place("chennai", ["Chennai", "TN", "Tamil Nadu"])
    assert matched["status"] == "one"
    assert matched["value"] == "chennai"


def test_region_code_does_not_match_a_longer_name():
    missed = match_place("TN", ["Tamil Nadu"])
    assert missed["status"] == "ask"
    exact = match_place("TN", ["TN", "Tamil Nadu"])
    assert exact["status"] == "one"
    assert exact["value"] == "tn"


def test_region_group_folds_case_and_labels_empty_unassigned():
    sql = fill_slots(
        "SELECT {{dimension_select}} COUNT(*) AS lead_count FROM rpt.contacts {{group_by_sql}}",
        dimension="region",
    )
    assert "lower(btrim(COALESCE(region, '')))" in sql
    assert "Unassigned" in sql
