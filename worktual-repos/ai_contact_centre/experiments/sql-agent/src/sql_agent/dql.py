"""DQL-only SQL validation. Mirrors apps/cc-core sql-dql.ts plus catalog allowlists."""

from __future__ import annotations

import re

from sql_agent.catalog import Catalog

FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|"
    r"EXECUTE|EXEC|COPY|REINDEX|VACUUM|MERGE|UPSERT|CALL|SET|RESET|LOCK|"
    r"BEGIN|COMMIT|ROLLBACK|SAVEPOINT|COMMENT|DO|PREPARE|DEALLOCATE|"
    r"REFRESH)\b",
    re.IGNORECASE,
)
TABLE_REF_RE = re.compile(
    r"\b(?:FROM|JOIN)\s+((?:[a-zA-Z_][\w]*\.)?[a-zA-Z_][\w]*)",
    re.IGNORECASE,
)
CTE_NAME_RE = re.compile(
    r"(?:WITH|,)\s*([a-zA-Z_][\w]*)\s+AS\s*\(",
    re.IGNORECASE,
)
SELECT_STAR_RE = re.compile(r"SELECT\s+(?:DISTINCT\s+(?:ON\s*\([^)]+\)\s+)?)?\*", re.IGNORECASE)


class DqlError(ValueError):
    pass


def strip_sql_comments(sql: str) -> str:
    without_line = re.sub(r"--.*?$", "", sql, flags=re.MULTILINE)
    return re.sub(r"/\*[\s\S]*?\*/", "", without_line).strip()


def validate_dql(sql: str, catalog: Catalog | None = None) -> str:
    if not sql or not sql.strip():
        raise DqlError("SQL query cannot be empty.")
    cleaned = strip_sql_comments(sql)
    trimmed = re.sub(r";+\s*$", "", cleaned).strip()
    if ";" in trimmed:
        raise DqlError("Multi-statement SQL execution is strictly forbidden.")
    forbidden = FORBIDDEN.search(cleaned)
    if forbidden:
        raise DqlError(
            f"DQL restriction violation: Operation '{forbidden.group(1).upper()}' is forbidden. "
            "Only SELECT/WITH DQL queries are allowed."
        )
    first = cleaned.split()[0].upper() if cleaned.split() else ""
    if first not in {"SELECT", "WITH"}:
        raise DqlError(f"DQL restriction violation: Query must begin with SELECT or WITH, got '{first}'.")
    if re.search(r"\bWITH\s+RECURSIVE\b", cleaned, re.IGNORECASE):
        raise DqlError("WITH RECURSIVE is not allowed in this DQL agent.")
    if catalog is not None:
        _assert_allowlisted_tables(cleaned, catalog)
        _assert_no_blocked_columns(cleaned, catalog)
    return cleaned


def _assert_allowlisted_tables(sql: str, catalog: Catalog) -> None:
    cte_names = {name.casefold() for name in CTE_NAME_RE.findall(sql)}
    cte_names.add("__matched")
    cte_names.add("__org_conversations")
    cte_names.add("__inner")
    for match in TABLE_REF_RE.finditer(sql):
        raw = match.group(1)
        if raw.startswith("("):
            continue
        if raw.casefold() in cte_names or raw.casefold().startswith("__scope_"):
            continue
        resolved = catalog.resolve_table(raw)
        if resolved is None:
            raise DqlError(f"Table '{raw}' is not in the analytics allowlist.")


def _assert_no_blocked_columns(sql: str, catalog: Catalog) -> None:
    folded = sql.casefold()
    for table in catalog.tables.values():
        for column in table.blocked_select:
            if re.search(rf"\b{re.escape(column.casefold())}\b", folded):
                # Allow mentions in comments already stripped; block SELECT of PII.
                raise DqlError(
                    f"Column '{table.name}.{column}' is blocked from SELECT (PII / message body)."
                )


def mentions_select_star(sql: str) -> bool:
    return bool(SELECT_STAR_RE.search(sql))
