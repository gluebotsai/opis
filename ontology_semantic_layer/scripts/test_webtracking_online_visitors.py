#!/usr/bin/env python3
"""online_visitors certification smoke (Amendment 5)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.capabilities import get_metric_capabilities  # noqa: E402
from semantic.lookup import is_certified  # noqa: E402
from semantic.sql.metric_template_registry import get_template  # noqa: E402


def test_online_visitors_certified_webtracking() -> None:
    assert is_certified("online_visitors")
    cap = get_metric_capabilities("online_visitors", product="webtracking")
    assert cap["product"] == "webtracking"
    assert cap["engine"] == "clickhouse"
    meta = get_template("webtracking", "online_visitors")
    assert meta is not None
    sql = meta.get("sql") or ""
    assert "organization_id = %s" in sql
    assert "is_online_flag = 1" in sql
    assert "{{extra_where}}" in sql


if __name__ == "__main__":
    test_online_visitors_certified_webtracking()
    print("OK: online_visitors certification checks passed")
