"""Executor-owned tenant and period scope. Deterministic SQL safety, not NLP intent."""

from __future__ import annotations

import re

from sql_agent.catalog import Catalog, TableCard
from sql_agent.compile import fill_sql
from sql_agent.context import QueryContext

TIMESTAMP_RE = re.compile(r"TIMESTAMP(?:TZ)?\s+'[^']+'", re.IGNORECASE)


def rewrite_timestamp_literals(sql: str, period_start: str, period_end: str) -> str:
    """Force every TIMESTAMP '...' pair onto the trusted window (>= start, < end)."""
    matches = list(TIMESTAMP_RE.finditer(sql))
    if not matches:
        return sql
    pieces: list[str] = []
    last = 0
    for index, match in enumerate(matches):
        pieces.append(sql[last : match.start()])
        bound = period_start if index % 2 == 0 else period_end
        pieces.append(f"TIMESTAMP '{bound}'")
        last = match.end()
    pieces.append(sql[last:])
    return "".join(pieces)


def _period_expr(table: TableCard) -> str | None:
    if table.dashboard_time_expr:
        return table.dashboard_time_expr
    if table.time_columns:
        return table.time_columns[0]
    return None


def _has_org(table: TableCard) -> bool:
    return any(column.name == "organization_id" for column in table.columns)


def apply_scope(sql: str, ctx: QueryContext, catalog: Catalog) -> str:
    """Replace mentioned catalog tables with org (and period, if unbounded) CTEs."""
    filled = sql
    if "{{" in filled:
        filled = fill_sql(
            filled,
            period_start=ctx.period_start,
            period_end=ctx.period_end,
            time_expr="COALESCE(assigned_at, resolved_at, ended_at, created_at)",
            catalog=catalog,
            table_for_time="ccass.conversations",
        )
    had_bounds = TIMESTAMP_RE.search(filled) is not None
    filled = rewrite_timestamp_literals(filled, ctx.period_start, ctx.period_end)
    mentioned = [
        catalog.tables[name]
        for name in sorted(catalog.tables, key=len, reverse=True)
        if re.search(rf"\b{re.escape(name)}\b", filled, re.IGNORECASE)
    ]
    if not mentioned:
        return filled
    ctes: list[str] = []
    rewritten = filled
    for table in mentioned:
        cte_name = f"__scope_{table.name.split('.')[-1]}"
        predicates: list[str] = []
        if _has_org(table):
            predicates.append(f"organization_id = '{ctx.organization_id}'::bigint")
        period_expr = _period_expr(table)
        if period_expr and not had_bounds:
            predicates.append(
                f"{period_expr} >= TIMESTAMP '{ctx.period_start}' "
                f"AND {period_expr} < TIMESTAMP '{ctx.period_end}'"
            )
        if not predicates:
            continue
        where = " AND ".join(predicates)
        ctes.append(
            f"{cte_name} AS (\n  SELECT *\n  FROM {table.name}\n  WHERE {where}\n)"
        )
        rewritten = re.sub(
            rf"\b{re.escape(table.name)}\b",
            cte_name,
            rewritten,
            flags=re.IGNORECASE,
        )
    if not ctes:
        return rewritten
    cte_sql = ",\n".join(ctes)
    if re.match(r"WITH\b", rewritten, re.IGNORECASE):
        return re.sub(r"^WITH\s+", f"WITH {cte_sql},\n", rewritten, count=1, flags=re.IGNORECASE)
    return f"WITH {cte_sql}\n{rewritten}"
