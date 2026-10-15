#!/usr/bin/env python3
"""Client payload shape: rows + status + threshold."""

from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from semantic.response import shape_client_response


def test_metric_response() -> None:
    body = shape_client_response(
        [{"open_tickets_metric": 42}],
        metric_ids=["open_tickets_metric"],
        organization_id=1000,
    )
    assert "rows" in body
    assert body["status"] == "warn"
    assert body["threshold"] == {"warn": 25, "critical": 60}
    assert "sql" not in body
    assert "interpretation" not in body


def test_list_response() -> None:
    body = shape_client_response([{"ticket_id": "t1"}])
    assert body["status"] == "not_applicable"
    assert body["threshold"] is None


def main() -> int:
    failed = 0
    for fn in (test_metric_response, test_list_response):
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
        except Exception as exc:
            failed += 1
            print(f"  FAIL  {fn.__name__}: {exc}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
