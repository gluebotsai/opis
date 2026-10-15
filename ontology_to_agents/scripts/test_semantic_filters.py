#!/usr/bin/env python3
"""Unit tests for semantic query filter normalization."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from semantic.query import QueryValidationError, _coerce_null_count_metrics, _normalize_filter


class Results:
    def __init__(self) -> None:
        self.ok = 0
        self.fail = 0

    def check(self, name: str, cond: bool) -> None:
        if cond:
            self.ok += 1
            print(f"  OK  {name}")
        else:
            self.fail += 1
            print(f"  FAIL {name}")


def test_normalize_filter(r: Results) -> None:
    flt = _normalize_filter(
        {"dimension": "channel", "operator": "equals", "value": "voice"}
    )
    r.check("operator equals -> eq", flt["op"] == "eq")
    r.check("value -> values", flt["values"] == ["voice"])


def test_coerce_null_counts(r: Results) -> None:
    rows = _coerce_null_count_metrics(
        ["open_conversations"],
        [{"open_conversations": None}],
    )
    r.check("null count -> 0", rows[0]["open_conversations"] == 0)


def test_contains_op_builds(r: Results) -> None:
    from semantic.query import _filters_to_where

    # Avoid manifest resolution — patch _resolve_dimensions
    import semantic.query as qmod

    original = qmod._resolve_dimensions

    def _fake(*_a, **_k):
        return ["queue__name"]

    qmod._resolve_dimensions = _fake
    try:
        clauses = _filters_to_where(
            [{"dimension": "queue_name", "op": "contains", "values": ["billing"]}],
            "open_conversations",
            product="ccaas",
            organization_id=1000,
            metric_names=["open_conversations"],
        )
        r.check("contains uses ILIKE", "ILIKE" in clauses[0])
    finally:
        qmod._resolve_dimensions = original


def main() -> int:
    print("=== semantic filter normalization ===")
    r = Results()
    test_normalize_filter(r)
    test_coerce_null_counts(r)
    test_contains_op_builds(r)
    print(f"\n{r.ok} passed, {r.fail} failed")
    return 1 if r.fail else 0


if __name__ == "__main__":
    sys.exit(main())
