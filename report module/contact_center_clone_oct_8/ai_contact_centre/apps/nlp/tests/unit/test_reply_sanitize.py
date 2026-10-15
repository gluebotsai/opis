from app.runtime.agent import _is_internal_tool_dump, _sanitize_user_reply


def test_detects_sql_plus_presentation_json() -> None:
    dump = (
        "SELECT CASE WHEN c.assigned_at >= DATE_TRUNC('week', CURRENT_DATE) "
        "THEN 'This Week' ELSE 'Last Week' END AS period, "
        "ROUND(AVG(c.handle_time)::numeric, 2) AS avg_seconds "
        "FROM ccass.conversations c WHERE c.assigned_at >= DATE_TRUNC('week', CURRENT_DATE) "
        "- INTERVAL '1 week' GROUP BY period ORDER BY period"
        '{"chart_type": "bar", "label_column": "period", "value_column": "avg_seconds", '
        '"title": "AHT: This Week vs Last Week"}'
    )
    assert _is_internal_tool_dump(dump)
    assert _sanitize_user_reply(dump) == ""


def test_keeps_normal_html_summary() -> None:
    reply = (
        "<p>Average handle time was <strong>2m 52s</strong> yesterday.</p>"
        "<p>Want a channel breakdown?</p>"
    )
    assert not _is_internal_tool_dump(reply)
    assert _sanitize_user_reply(reply) == reply
