"""Parameterized filter fragments shared by list/count/KPI SQL."""

from __future__ import annotations

from sql_agent.job import SqlFilter
from sql_agent.validator import SqlValidationError, quote_ident

_CI_COLUMNS = frozenset({"status", "priority"})
_NAME_COLUMNS = frozenset(
    {
        "assignee_name",
        "resolver_name",
        "created_by_name",
        "customer_name",
        "customer_email",
        "queue_name",
        "account_name",
    }
)

LIKE_FALLBACK_COLUMNS = frozenset(
    {
        "status_display_name",
        "queue_name",
        "queue_type",
        "customer_name",
        "customer_email",
        "assignee_name",
        "resolver_name",
        "created_by_name",
        "category",
        "skill",
        "account_name",
        "channel",
        "subject",
    }
)


def like_contains_pattern(value: object) -> str:
    token = "".join(ch for ch in str(value).strip() if ch not in "%_")
    return f"%{token}%"


def filter_clause(flt: SqlFilter, *, column_sql: str | None = None) -> tuple[str, list[object]]:
    col = column_sql or quote_ident(flt.column)
    op = (flt.op or "eq").lower()
    values = list(flt.values or [])
    ci = flt.column.lower() in _CI_COLUMNS
    expr = f"lower({col}::text)" if ci else col
    if ci and op not in ("contains", "ilike", "like"):
        values = [str(v).strip().lower() for v in values]

    if op in ("eq", "=") and flt.column.lower() in _NAME_COLUMNS:
        return f"{col} ILIKE %s", [like_contains_pattern(values[0])]
    if op in ("eq", "="):
        return f"{expr} = %s", [values[0]]
    if op in ("neq", "!="):
        return f"{expr} != %s", [values[0]]
    if op in ("in",):
        placeholders = ", ".join("%s" for _ in values)
        return f"{expr} IN ({placeholders})", values
    if op in ("not_in", "notin", "neq_in"):
        placeholders = ", ".join("%s" for _ in values)
        return f"{expr} NOT IN ({placeholders})", values
    if op in ("contains", "ilike", "like"):
        patterns = [like_contains_pattern(v) for v in (flt.values or [])]
        if not patterns:
            raise SqlValidationError("ILIKE filter requires a value")
        parts = [f"{col} ILIKE %s" for _ in patterns]
        return f"({' OR '.join(parts)})", patterns
    raise SqlValidationError(f"Unsupported filter op: {flt.op}")


def can_like_retry(filters: list[SqlFilter]) -> bool:
    return any(
        (flt.op or "eq").lower() in ("eq", "=", "in")
        and flt.column.lower() in LIKE_FALLBACK_COLUMNS
        and flt.values
        for flt in filters
    )


def rewrite_eq_filters_to_ilike(filters: list[SqlFilter]) -> list[SqlFilter]:
    out: list[SqlFilter] = []
    for flt in filters:
        op = (flt.op or "eq").lower()
        if op in ("eq", "=", "in") and flt.column.lower() in LIKE_FALLBACK_COLUMNS and flt.values:
            out.append(SqlFilter(column=flt.column, op="ilike", values=list(flt.values)))
        else:
            out.append(flt)
    return out
