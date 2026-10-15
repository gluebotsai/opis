"""Wrap a DQL statement so the caller always gets a preview plus a full-set summary."""

from __future__ import annotations

import re

from sql_agent.catalog import Catalog
from sql_agent.dql import validate_dql

PREVIEW_LIMIT = 50
HARD_CAP = 200
TRAILING_LIMIT_RE = re.compile(
    r"\s+LIMIT\s+\d+(?:\s+OFFSET\s+\d+)?\s*$",
    re.IGNORECASE,
)


def strip_trailing_limit(sql: str) -> str:
    return TRAILING_LIMIT_RE.sub("", sql.rstrip()).rstrip()


def wrap_preview_and_summary(
    sql: str,
    catalog: Catalog | None = None,
    *,
    limit: int = PREVIEW_LIMIT,
) -> dict[str, str | int]:
    validated = validate_dql(sql, catalog)
    inner = strip_trailing_limit(validated)
    cap = max(1, min(limit, HARD_CAP))
    wrapped = (
        "WITH __matched AS (\n"
        "SELECT * FROM (\n"
        f"{inner}\n"
        ") AS __inner\n"
        ")\n"
        "SELECT\n"
        "  (SELECT COUNT(*) FROM __matched) AS __total_matched_rows,\n"
        "  __matched.*\n"
        "FROM __matched\n"
        f"LIMIT {cap}"
    )
    return {
        "inner_sql": inner,
        "execute_sql": wrapped,
        "preview_limit": cap,
        "hard_cap": HARD_CAP,
        "summary_columns": ["__total_matched_rows"],
        "note": (
            "Preview is capped. __total_matched_rows is the full matched row count "
            "from the inner query before LIMIT."
        ),
    }


def summarize_rows(rows: list[dict], *, preview_limit: int = PREVIEW_LIMIT) -> dict:
    if not rows:
        return {
            "total_matched_rows": 0,
            "preview_row_count": 0,
            "truncated": False,
            "preview": [],
        }
    total = rows[0].get("__total_matched_rows", len(rows))
    try:
        total_int = int(total)
    except (TypeError, ValueError):
        total_int = len(rows)
    preview = []
    for row in rows[:preview_limit]:
        cleaned = {key: value for key, value in row.items() if key != "__total_matched_rows"}
        preview.append(cleaned)
    return {
        "total_matched_rows": total_int,
        "preview_row_count": len(preview),
        "truncated": total_int > len(preview),
        "preview": preview,
    }
