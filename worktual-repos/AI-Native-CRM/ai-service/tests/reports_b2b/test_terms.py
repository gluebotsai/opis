from pathlib import Path

from app.agents.reports_b2b.core.terms import bind_term, lead_scope_overrides


def test_recent_binds_last_hour_unless_the_user_named_a_window():
    bare = bind_term(
        "recent",
        kpi_id="lead_count",
        time_window="all time",
        aggregation="count",
        status_filter=None,
        row_limit=None,
    )
    assert bare.time_window == "last 1 hour"
    assert bare.answer_note
    named = bind_term(
        "recent",
        kpi_id="lead_count",
        time_window="last 7 days",
        aggregation="count",
        status_filter=None,
        row_limit=None,
    )
    assert named.time_window == "last 7 days"
    assert named.answer_note is None


def test_latest_does_not_cap_a_count():
    bound = bind_term(
        "latest",
        kpi_id="lead_count",
        time_window="all time",
        aggregation="count",
        status_filter=None,
        row_limit=None,
    )
    assert bound.limit is None


def test_latest_caps_a_list_and_keeps_an_explicit_number():
    default = bind_term(
        "latest",
        kpi_id="top_open_opportunities",
        time_window="all time",
        aggregation="list",
        status_filter=None,
        row_limit=None,
    )
    assert default.limit == 10
    named = bind_term(
        "latest",
        kpi_id="top_open_opportunities",
        time_window="all time",
        aggregation="list",
        status_filter=None,
        row_limit=20,
    )
    assert named.limit == 20


def test_not_high_flips_only_the_high_probability_metric():
    flipped = bind_term(
        "not_high",
        kpi_id="high_probability_deals",
        time_window="all time",
        aggregation="count",
        status_filter=None,
        row_limit=None,
    )
    assert flipped.polarity_sql == "stage_weight < 0.75"
    other = bind_term(
        "not_high",
        kpi_id="lead_count",
        time_window="all time",
        aggregation="count",
        status_filter=None,
        row_limit=None,
    )
    assert other.polarity_sql is None


def test_not_good_asks_instead_of_running_a_metric():
    bound = bind_term(
        "not_good",
        kpi_id="high_probability_deals",
        time_window="all time",
        aggregation="count",
        status_filter=None,
        row_limit=None,
    )
    assert bound.stop is not None
    assert bound.stop["error_type"] == "CLARIFY"
    assert "lost" in bound.stop["error"]


def test_own_scope_lead_metrics_use_owner_or_creator():
    overrides = lead_scope_overrides("own", "lead_count")
    assert overrides is not None
    assert "created_by_user_id" in overrides["contacts"]
    assert "user_channel_companies" not in overrides["contacts"]
    assert lead_scope_overrides("org", "lead_count") is None
    assert lead_scope_overrides("own", "total_pipeline") is None


def test_lead_sql_requires_contact_type_lead():
    sql_dir = Path(__file__).resolve().parents[2] / "app" / "agents" / "reports_b2b" / "product" / "sql"
    for name in (
        "lead_count.sql",
        "lead_status_mix.sql",
        "unassigned_leads.sql",
        "lead_source_conversion.sql",
    ):
        text = (sql_dir / name).read_text()
        assert "contact_type" in text
        assert "= 'lead'" in text
