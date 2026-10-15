#!/usr/bin/env python3
"""Webtracking must never fall through to MetricFlow/Postgres."""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.query import SemanticQuery, execute  # noqa: E402
from semantic.sql.template_execute import can_use_sql_template  # noqa: E402


def _prepared(**overrides):
    base = {
        "organizationId": 1003,
        "userId": 1019,
        "product": "webtracking",
        "execution_product": "webtracking",
        "agent": "wt.reporting_mas",
        "metrics": ["web_session_volume"],
        "time": {},
        "group_by_requested": [],
        "user_filters": [],
        "websiteId": 1001,
    }
    base.update(overrides)
    return base


def test_can_use_sql_template_webtracking_with_groupby() -> None:
    assert can_use_sql_template(_prepared(group_by_requested=["country"])) is True


def test_can_use_sql_template_webtracking_with_filters() -> None:
    assert (
        can_use_sql_template(
            _prepared(
                user_filters=[{"dimension": "device", "operator": "=", "values": ["mobile"]}]
            )
        )
        is True
    )


def test_country_alias_india_to_in() -> None:
    from semantic.sql.webtracking_dims import normalize_webtracking_filter_value

    assert normalize_webtracking_filter_value("country", "India") == "IN"
    assert normalize_webtracking_filter_value("web_sessions__country", "india") == "IN"
    assert normalize_webtracking_filter_value("country", "IN") == "IN"


def test_execute_never_calls_postgres_for_webtracking() -> None:
    q = SemanticQuery(
        organization_id=1003,
        user_id=1019,
        product="webtracking",
        agent="wt.reporting_mas",
        website_id=1001,
        metrics=["web_session_volume"],
    )
    with patch("semantic.sql.db.run_postgres_query") as pg:
        with patch(
            "semantic.sql.metric_fallback.execute_metric_fallback",
            return_value={"rows": [{"web_session_volume": 1}], "source": "sql_template"},
        ):
            # If template path fails open to MF, postgres would be hit — assert not.
            try:
                execute(q)
            except Exception:
                pass
        assert pg.call_count == 0, "webtracking must not call run_postgres_query"


if __name__ == "__main__":
    test_can_use_sql_template_webtracking_with_groupby()
    test_can_use_sql_template_webtracking_with_filters()
    test_country_alias_india_to_in()
    test_execute_never_calls_postgres_for_webtracking()
    print("OK: webtracking CH-only unit checks passed")
