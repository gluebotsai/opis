"""Portfolio totals normalization from Campaign API."""

from app.services.portfolio_api import period_to_query_params, resolve_report_period
from app.services.portfolio_metrics import totals_from_api_portfolio


def test_totals_from_api_portfolio_maps_rates():
    raw = {
        "campaigns": 24,
        "campaigns_ran": 24,
        "campaigns_with_send": 22,
        "campaigns_with_failure": 1,
        "live_count": 0,
        "scheduled_count": 0,
        "completed_count": 24,
        "draft_count": 11,
        "sent": 30,
        "failed": 1,
        "delivered": 30,
        "opens": 26,
        "clicks": 13,
        "open_rate_pct": 96.3,
        "click_rate_pct": 43.3,
        "open_rate_display": "96.3%",
        "click_rate_display": "43.3%",
    }
    out = totals_from_api_portfolio(raw)
    assert out is not None
    assert out["campaigns_ran"] == 24
    assert out["campaigns"] == 24
    assert out["campaigns_with_send"] == 22
    assert out["campaigns_with_failure"] == 1
    assert out["messages_sent"] == 30
    assert out["open_rate_pct"] == 96.3


def test_totals_from_api_portfolio_none():
    assert totals_from_api_portfolio(None) is None


def test_period_to_query_params_custom_range():
    p = {"fromDate": "2026-09-01", "toDate": "2026-09-10"}
    assert period_to_query_params(p) == {
        "bucket": "all",
        "from": "2026-09-01",
        "to": "2026-09-10",
    }


def test_resolve_report_period_dashboard_weekly():
    session = {"dashboard_period": {"range": "weekly", "relative": "last_7_days"}}
    assert resolve_report_period(session, {}) == {"relative": "last_7_days"}
