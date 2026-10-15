#!/usr/bin/env python3
"""Tests for webtracking website entitlement (Amendment 1)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.webtracking_entitlement import (  # noqa: E402
    WebsiteEntitlementError,
    assert_webtracking_website_entitled,
)


def test_missing_website_id_required() -> None:
    try:
        assert_webtracking_website_entitled(1, None, run_query=lambda *_: [{"ok": 1}])
        raise AssertionError("expected WebsiteEntitlementError")
    except WebsiteEntitlementError as exc:
        assert exc.code == "website_id_required"
        assert exc.website_id is None


def test_foreign_site_not_entitled() -> None:
    def empty_query(sql, params):
        return []

    try:
        assert_webtracking_website_entitled(10, 99, run_query=empty_query)
        raise AssertionError("expected WebsiteEntitlementError")
    except WebsiteEntitlementError as exc:
        assert exc.code == "website_not_entitled"
        assert exc.website_id == 99


def test_owned_site_ok() -> None:
    def hit(sql, params):
        assert params == [10, 20]
        return [{"ok": 1}]

    assert assert_webtracking_website_entitled(10, 20, run_query=hit) == 20


def test_owned_empty_traffic_still_entitled() -> None:
    """Entitlement uses sites mart, not session traffic — zero traffic still OK."""
    assert (
        assert_webtracking_website_entitled(
            10, 20, run_query=lambda *_: [{"ok": 1}]
        )
        == 20
    )


def test_sql_uses_mart_web_sites() -> None:
    seen: list[str] = []

    def capture(sql, params):
        seen.append(sql)
        return [{"ok": 1}]

    assert_webtracking_website_entitled(1, 2, run_query=capture)
    assert "mart_web_sites" in seen[0]
    assert "organization_id" in seen[0]
    assert "website_id" in seen[0]


if __name__ == "__main__":
    test_missing_website_id_required()
    test_foreign_site_not_entitled()
    test_owned_site_ok()
    test_owned_empty_traffic_still_entitled()
    test_sql_uses_mart_web_sites()
    print("OK: webtracking entitlement tests passed")
