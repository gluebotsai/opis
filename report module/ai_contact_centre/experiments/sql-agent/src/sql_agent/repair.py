"""Repair unknown tables/columns using catalog names (typos like chanel, conversatons)."""

from __future__ import annotations

import re
from typing import Any

from sql_agent.catalog import Catalog
from sql_agent.textutil import closest

FROM_JOIN_RE = re.compile(
    r"\b(?:FROM|JOIN)\s+((?:[a-zA-Z_][\w]*\.)?[a-zA-Z_][\w]*)",
    re.IGNORECASE,
)
IDENT_RE = re.compile(r"\b([a-zA-Z_][\w]*)\b")
STRING_RE = re.compile(r"'(?:[^'\\]|\\.)*'")
SQL_KEYWORDS = {
    "select",
    "from",
    "join",
    "inner",
    "left",
    "right",
    "full",
    "outer",
    "on",
    "where",
    "and",
    "or",
    "not",
    "group",
    "by",
    "order",
    "limit",
    "offset",
    "as",
    "with",
    "count",
    "avg",
    "sum",
    "min",
    "max",
    "filter",
    "distinct",
    "case",
    "when",
    "then",
    "else",
    "end",
    "null",
    "is",
    "in",
    "between",
    "date_trunc",
    "coalesce",
    "extract",
    "epoch",
    "timestamp",
    "interval",
    "true",
    "false",
    "desc",
    "asc",
    "having",
    "union",
    "exists",
    "nullif",
}


def _mask_strings(sql: str) -> tuple[str, list[str]]:
    held: list[str] = []

    def keep(match: re.Match[str]) -> str:
        held.append(match.group(0))
        return f"'__SQL_STR_{len(held) - 1}__'"

    return STRING_RE.sub(keep, sql), held


def _unmask_strings(sql: str, held: list[str]) -> str:
    for index, value in enumerate(held):
        sql = sql.replace(f"'__SQL_STR_{index}__'", value)
    return sql


def repair_sql(sql: str, catalog: Catalog) -> dict[str, Any]:
    masked, held = _mask_strings(sql)
    repaired = masked
    replacements: list[dict[str, str]] = []

    table_names = list(catalog.tables)
    short_names = [name.split(".")[-1] for name in table_names]
    alias_to_column: dict[str, str] = {}
    exact_columns: set[str] = set()
    for table in catalog.tables.values():
        for column in table.columns:
            exact_columns.add(column.name.casefold())
            alias_to_column[column.name.casefold()] = column.name
            for alias in column.aliases:
                alias_to_column[alias.casefold()] = column.name

    for match in FROM_JOIN_RE.finditer(repaired):
        raw = match.group(1)
        if catalog.resolve_table(raw):
            continue
        leaf = raw.split(".")[-1]
        hit = closest(leaf, short_names + table_names)
        if not hit:
            continue
        resolved = catalog.resolve_table(hit) or hit
        if resolved.casefold() == raw.casefold():
            continue
        replacements.append({"from": raw, "to": resolved, "kind": "table"})
        repaired = re.sub(rf"\b{re.escape(raw)}\b", resolved, repaired)

    for match in IDENT_RE.finditer(repaired):
        ident = match.group(1)
        folded = ident.casefold()
        if folded in SQL_KEYWORDS or ident.isdigit() or len(ident) <= 2:
            continue
        if folded.startswith("__sql_str_"):
            continue
        if folded in exact_columns:
            continue
        if catalog.resolve_table(ident):
            continue
        canonical = alias_to_column.get(folded)
        if canonical and canonical.casefold() != folded:
            replacements.append({"from": ident, "to": canonical, "kind": "column"})
            repaired = re.sub(rf"\b{re.escape(ident)}\b", canonical, repaired)

    repaired = _unmask_strings(repaired, held)
    return {
        "original": sql,
        "repaired": repaired,
        "replacements": replacements,
        "changed": repaired != sql,
    }
