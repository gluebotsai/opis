"""LIST_MONITOR channel / ran filters (dashboard parity)."""

from app.agents.monitoring.list_filters import (
    channel_rollup_count,
    is_ran_campaign_status,
    normalize_row_channels,
    row_includes_channel,
)
from app.services.portfolio_api import normalize_dashboard_period


def test_is_ran_campaign_status():
    assert is_ran_campaign_status("live")
    assert is_ran_campaign_status("completed")
    assert is_ran_campaign_status("cancelled")
    assert not is_ran_campaign_status("draft")
    assert not is_ran_campaign_status("scheduled")


def test_normalize_row_channels_push_aliases():
    row = {"channels": ["email", "app_push"]}
    assert normalize_row_channels(row) == ["email", "push"]
    assert row_includes_channel(row, "push")
    assert not row_includes_channel(row, "whatsapp")


def test_channel_rollup_count():
    totals = {
        "channel_rollup": [
            {"channel": "email", "campaigns": 24},
            {"channel": "push", "campaigns": 3},
        ]
    }
    assert channel_rollup_count(totals, "push") == 3
    assert channel_rollup_count(totals, "sms") is None


def test_normalize_dashboard_period():
    raw = {
        "range": "weekly",
        "relative": "last_7_days",
        "from_date": None,
        "label": "Last week",
    }
    out = normalize_dashboard_period(raw)
    assert out is not None
    assert out["relative"] == "last_7_days"
    assert out["range"] == "weekly"


def test_normalize_dashboard_period_custom_activity():
    raw = {
        "range": "custom",
        "from_date": "2025-09-01",
        "to_date": "2025-09-27",
        "activity_from": "2025-09-01",
        "activity_to": "2025-09-27",
        "label": "1 Sept – 27 Sept",
    }
    out = normalize_dashboard_period(raw)
    assert out is not None
    assert out["from_date"] == "2025-09-01"
    assert out["activity_to"] == "2025-09-27"


def test_merge_portfolio_performance_args_custom():
    from app.services.portfolio_api import merge_portfolio_performance_args

    session = {
        "dashboard_period": {
            "range": "custom",
            "from_date": "2025-09-01",
            "to_date": "2025-09-27",
            "activity_from": "2025-09-01",
            "activity_to": "2025-09-27",
        }
    }
    merged = merge_portfolio_performance_args(session, {})
    assert merged["from_date"] == "2025-09-01"
    assert merged["relative"] is None
    assert merged["activity_to"] == "2025-09-27"
