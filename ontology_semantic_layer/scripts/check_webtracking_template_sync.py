#!/usr/bin/env python3
"""Fail if semantic/sql and sql_agent webtracking KPI templates diverge."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
A = ROOT / "semantic" / "sql" / "metric_templates" / "webtracking.yml"
B = ROOT / "sql_agent" / "kpi_templates" / "webtracking.yml"


def main() -> int:
    if not A.is_file() or not B.is_file():
        print(f"missing template file(s): {A.exists()=} {B.exists()=}", file=sys.stderr)
        return 1
    a = A.read_text(encoding="utf-8")
    b = B.read_text(encoding="utf-8")
    if a != b:
        print(
            "webtracking template sync failed:\n"
            f"  {A.relative_to(ROOT)}\n"
            f"  {B.relative_to(ROOT)}\n"
            "Copy one side to the other so both files are identical.",
            file=sys.stderr,
        )
        return 1
    print("OK: webtracking.yml templates are identical")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
