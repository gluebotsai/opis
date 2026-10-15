#!/usr/bin/env python3
"""Unit tests for execute_multi fan-out row merge."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from semantic.query import _merge_fanout_rows


def test_scalar_merge() -> None:
    rows = _merge_fanout_rows(
        {
            "open_conversations": [{"open_conversations": 5}],
            "sla_breach_rate": [{"sla_breach_rate": 0.12}],
        },
        ["open_conversations", "sla_breach_rate"],
        [],
    )
    assert rows == [{"open_conversations": 5, "sla_breach_rate": 0.12}]


def test_group_by_merge() -> None:
    rows = _merge_fanout_rows(
        {
            "open_conversations": [
                {"conversation__queue_name": "Support", "open_conversations": 3},
                {"conversation__queue_name": "Sales", "open_conversations": 1},
            ],
            "sla_breach_rate": [
                {"sla_state__queue_name": "Support", "sla_breach_rate": 0.1},
                {"sla_state__queue_name": "Sales", "sla_breach_rate": 0.2},
            ],
        },
        ["open_conversations", "sla_breach_rate"],
        ["queue_name"],
    )
    by_queue = {r["queue_name"]: r for r in rows}
    assert by_queue["Support"]["open_conversations"] == 3
    assert by_queue["Support"]["sla_breach_rate"] == 0.1
    assert by_queue["Sales"]["open_conversations"] == 1


def test_time_grain_merge() -> None:
    rows = _merge_fanout_rows(
        {
            "total_conversations": [
                {"metric_time__month": "2026-01-01", "total_conversations": 10},
            ],
            "open_conversations": [
                {"metric_time__month": "2026-01-01", "open_conversations": 2},
            ],
        },
        ["total_conversations", "open_conversations"],
        ["metric_time__month"],
    )
    assert len(rows) == 1
    assert rows[0]["total_conversations"] == 10
    assert rows[0]["open_conversations"] == 2


def main() -> int:
    tests = [test_scalar_merge, test_group_by_merge, test_time_grain_merge]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"  OK  {fn.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"  FAIL {fn.__name__}: {exc}")
    print(f"\n{len(tests) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
