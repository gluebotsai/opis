#!/usr/bin/env python3
"""CCaaS guardrails learned from ticketing postmortem."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def test_product_alias_contact_centre() -> None:
    from semantic.sql.product_aliases import normalize_sql_catalog_product

    assert normalize_sql_catalog_product("contact_centre") == "ccaas"
    assert normalize_sql_catalog_product("aiccaas") == "ccaas"


def test_channel_filter_skips_copilot_turns() -> None:
    from semantic.sql.catalog_loader import resolve_channel_filter

    _, col = resolve_channel_filter(
        "ccaas", "mart_copilot_turns", channel_scoped=True, channels=["voice"]
    )
    assert col is None
    ch, col = resolve_channel_filter(
        "ccaas", "mart_conversations", channel_scoped=True, channels=["voice"]
    )
    assert ch == []
    assert col is None


def test_validator_allows_call_channel_literal() -> None:
    from semantic.sql.validator import validate_readonly_sql

    sql = "SELECT COUNT(*) FROM ccass_marts_aiccaas.mart_conversations WHERE channel = 'call'"
    validate_readonly_sql(sql)


def test_ccaas_catalog_count() -> None:
    from semantic.ownership import list_certified_for_source

    certified = list_certified_for_source("aiccaas")
    assert len(certified) == 58


def main() -> int:
    tests = [
        test_product_alias_contact_centre,
        test_channel_filter_skips_copilot_turns,
        test_validator_allows_call_channel_literal,
        test_ccaas_catalog_count,
    ]
    for fn in tests:
        fn()
        print(f"PASS  {fn.__name__}")
    print(f"\n{len(tests)}/{len(tests)} passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
