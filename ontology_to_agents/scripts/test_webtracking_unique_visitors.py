#!/usr/bin/env python3
"""unique_visitors dim/grain regression (Amendment 2).

Template already uses mart_web_sessions; policy dims include device/city.
Before/after vs mart_web_visitors: 0% delta on full matrix (see plan Commit 4 report).
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.lookup import get_allowed_dims  # noqa: E402
from semantic.sql.metric_template_registry import get_template  # noqa: E402


def test_unique_visitors_session_template() -> None:
    meta = get_template("webtracking", "unique_visitors")
    assert meta is not None
    assert meta.get("table") == "mart_web_sessions"
    sql = meta.get("sql") or ""
    assert "uniqExact(visitor_id)" in sql
    assert "mart_web_sessions" in sql
    assert "organization_id = %s" in sql


def test_unique_visitors_allows_device_and_city() -> None:
    dims = set(get_allowed_dims("unique_visitors", product="webtracking"))
    assert "device" in dims
    assert "city" in dims
    assert "country" in dims


if __name__ == "__main__":
    test_unique_visitors_session_template()
    test_unique_visitors_allows_device_and_city()
    print("OK: unique_visitors grain/dims checks passed")
