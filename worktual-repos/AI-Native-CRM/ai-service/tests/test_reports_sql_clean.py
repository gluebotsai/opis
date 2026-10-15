from app.agents.reports_analytics_turn import _clean_llm_sql


def test_clean_llm_sql_strips_trailing_fence():
    raw = (
        "SELECT id, amount\nFROM rpt.deals\nORDER BY amount DESC\nLIMIT 50;\n```"
    )
    assert _clean_llm_sql(raw).endswith("LIMIT 50")
    assert "```" not in _clean_llm_sql(raw)
