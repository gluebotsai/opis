"""Unit tests for semantic flatten + analytics visual mapping."""

from app.agents.reports.analytics_visual import (
    build_visual_from_semantic_results,
)
from app.services.semantic_layer import flatten_semantic_results


def test_flatten_query_key() -> None:
    body = {
        "open rate?": [
            {"ok": True, "metric_id": "open_rate", "rows": [{"open_rate": 0.12}]}
        ]
    }
    rows = flatten_semantic_results(body, "open rate?")
    assert len(rows) == 1
    assert rows[0]["metric_id"] == "open_rate"


def test_flatten_query_list() -> None:
    body = {"query": [{"ok": True, "metric_id": "click_rate", "rows": [{"click_rate": 0.04}]}]}
    rows = flatten_semantic_results(body, "anything")
    assert rows[0]["metric_id"] == "click_rate"


def test_visual_kpi_formats_rate() -> None:
    analytics = build_visual_from_semantic_results(
        query="open rate",
        usable=[{"ok": True, "metric_id": "open_rate", "rows": [{"open_rate": 0.067}]}],
        organization_id="1000",
        source="semantic_layer",
    )
    assert analytics is not None
    assert analytics["visual"]["kind"] == "kpi"
    assert analytics["visual"]["kpis"][0]["value"] == "6.7%"
    assert analytics["audit"]["source"] == "semantic_layer"


def test_visual_pie_status_share() -> None:
    analytics = build_visual_from_semantic_results(
        query="campaigns by status",
        usable=[
            {
                "ok": True,
                "metric_id": "campaign_status_share",
                "rows": [
                    {"status": "live", "count": 3},
                    {"status": "scheduled", "count": 2},
                    {"status": "past", "count": 5},
                ],
            }
        ],
        organization_id="1000",
        source="campaign_sql",
    )
    assert analytics is not None
    assert analytics["visual"]["kind"] == "pie"
    assert len(analytics["visual"]["chart"]["data"]) == 3


def test_visual_bar_channels() -> None:
    analytics = build_visual_from_semantic_results(
        query="sent by channel",
        usable=[
            {
                "ok": True,
                "metric_id": "sent_by_channel",
                "rows": [
                    {"channel": "email", "sent": 10},
                    {"channel": "web", "sent": 4},
                ],
            }
        ],
        organization_id="1000",
        source="campaign_sql",
    )
    assert analytics is not None
    assert analytics["visual"]["kind"] == "bar"
