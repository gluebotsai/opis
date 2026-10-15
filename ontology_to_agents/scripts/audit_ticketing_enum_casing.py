#!/usr/bin/env python3
"""Fail if ticketing enum compares omit LOWER()/lower() around Title Case DB values.

Scans dbt marts, enriched.py, and sql_agent KPI templates for bare compares like
  status = 'active'
without an enclosing lower()/LOWER().

Usage:
  PYTHONPATH=. python3 scripts/audit_ticketing_enum_casing.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

LITERALS = (
    "active",
    "inactive",
    "published",
    "draft",
    "open",
    "pending",
    "resolved",
    "closed",
    "approved",
    "rejected",
    "accepted",
    "dismissed",
    "high",
    "urgent",
    "at_risk",
    "internal",
)

# Match col = 'literal' where literal is lowercase (Title Case DB mismatch risk).
# Title Case literals like 'Resolved' intentionally match live status display values.
_BARE = re.compile(
    r"(?P<prefix>(?:^|[^a-zA-Z0-9_]))"
    r"(?P<col>(?:status|visibility|priority|sla_status|action|role|kb_article_status)"
    r"(?:\s+[Aa][Ss]\s+\w+)?)"
    r"\s*=\s*['\"](?P<lit>" + "|".join(re.escape(x) for x in LITERALS) + r")['\"]",
)

# Also catch IN ('open', ...) without lower on the column — simplified: flag
# bare = compares only; IN with LOWER(col) IN (...) is fine.

SCAN_GLOBS = [
    "semantic/dbt/postgres/default/dbt/models/ticketing/marts/*.sql",
    "sql_agent/ticketing_sql/enriched.py",
    "sql_agent/kpi_templates/ticketing.yml",
]


def _has_lower_before(text: str, match_start: int, window: int = 40) -> bool:
    snippet = text[max(0, match_start - window) : match_start].lower()
    return "lower(" in snippet


def audit_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    hits: list[str] = []
    for m in _BARE.finditer(text):
        # Skip if LOWER( wraps the column immediately before
        col_start = m.start("col")
        if _has_lower_before(text, col_start):
            continue
        # Skip ticket status Title Case compares that intentionally match
        # display status ('Resolved') — only flag lowercase literals.
        lit = m.group("lit").lower()
        if lit not in LITERALS:
            continue
        line_no = text.count("\n", 0, m.start()) + 1
        hits.append(f"{path.relative_to(ROOT)}:{line_no}: {m.group(0).strip()}")
    return hits


def main() -> int:
    issues: list[str] = []
    for pattern in SCAN_GLOBS:
        for path in sorted(ROOT.glob(pattern)):
            if not path.is_file():
                continue
            issues.extend(audit_file(path))
    if issues:
        print("FAIL bare enum compares without LOWER()/lower():")
        for issue in issues:
            print(f"  {issue}")
        return 1
    print("OK enum casing audit — all scanned compares use LOWER()/lower()")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
