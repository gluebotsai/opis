from app.agents.reports_analytics_companion import (
    companion_assistant_text,
    strip_markdown_tables,
)


def test_strip_markdown_tables():
    raw = "Top deal is kavin.\n\n| Deal | Amount |\n|---|---|\n| a | 1 |\n\nRest note."
    assert "|" not in strip_markdown_tables(raw)
    assert "Top deal is kavin." in strip_markdown_tables(raw)


def test_companion_strips_when_table_visual():
    analytics = {
        "visual": {
            "kind": "table",
            "table": {"rows": [{"a": 1}, {"a": 2}]},
        }
    }
    speech = companion_assistant_text(
        "Winner is X.\n| Deal | Amt |\n|---|---|\n| x | 1 |",
        analytics,
    )
    assert "|" not in speech
    assert "Winner is X." in speech
