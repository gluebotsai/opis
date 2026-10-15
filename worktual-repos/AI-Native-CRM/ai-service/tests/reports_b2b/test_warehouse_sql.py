from app.agents.reports_b2b.core.db import adapt_sql


def test_adapt_sql_named_placeholders():
    sql, args = adapt_sql(
        "SELECT * FROM t WHERE org_id = %(organization_id)s AND owner = %(user_id)s",
        {"organization_id": 12, "user_id": 7},
    )
    assert sql == "SELECT * FROM t WHERE org_id = $1 AND owner = $2"
    assert args == [12, 7]


def test_adapt_sql_repeats_named_params():
    sql, args = adapt_sql(
        "SELECT %(x)s AS a, %(x)s AS b",
        {"x": "same"},
    )
    assert sql == "SELECT $1 AS a, $2 AS b"
    assert args == ["same", "same"]


def test_adapt_sql_positional_and_escaped_percent():
    sql, args = adapt_sql("SELECT '100%%' AS pct WHERE id = %s", (9,))
    assert sql == "SELECT '100%' AS pct WHERE id = $1"
    assert args == [9]
