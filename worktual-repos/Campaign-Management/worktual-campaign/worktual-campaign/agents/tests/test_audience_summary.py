"""Tests for audience segmentation prompt formatting."""

from app.agents.create_campaign.context import format_audience_summary_for_prompt


def test_format_empty_summary():
    text = format_audience_summary_for_prompt({})
    assert "No contacts" in text


def test_format_with_segments():
    text = format_audience_summary_for_prompt(
        {
            "total_contacts": 100,
            "with_email": 80,
            "with_phone": 60,
            "by_segment": [{"label": "VIP", "count": 10}],
            "by_city": [{"label": "Mumbai", "count": 25}],
            "join_windows": [{"label": "Last 7 days", "count": 5}],
        }
    )
    assert "VIP (10)" in text
    assert "Mumbai (25)" in text
    assert "Last 7 days (5)" in text
