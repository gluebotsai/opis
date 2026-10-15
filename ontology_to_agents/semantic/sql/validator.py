"""Validate generated SQL against catalog allowlists."""

from __future__ import annotations

import re

_FORBIDDEN = re.compile(
    r"\b("
    r"INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|"
    r"RETURNING|INTO|COPY|MERGE|CALL|EXECUTE|"
    r"SET|RESET|SHOW|VACUUM|ANALYZE|REINDEX|CLUSTER|"
    r"LOCK|LISTEN|NOTIFY|UNLISTEN|"
    r"PREPARE|DEALLOCATE|DISCARD|"
    r"LOAD|REFRESH|COMMENT|SECURITY|"
    r"dblink|pg_sleep|pg_read_file|pg_write_file|pg_ls_dir|"
    r"lo_import|lo_export|lo_unlink"
    r")\b",
    re.IGNORECASE,
)

# Unsafe Postgres builtins (pg_catalog schema reads are OK for SELECT introspection).
_PG_UNSAFE = re.compile(
    r"\bpg_(?:sleep|read_file|write_file|ls_dir|stat_file|advisory_lock|"
    r"terminate_backend|cancel_backend|reload_conf|rotate_logfile)\b",
    re.IGNORECASE,
)


class SqlValidationError(ValueError):
    pass


def _strip_quoted_literals(sql: str) -> str:
    """Remove string literals so keyword checks do not match inside values (e.g. 'call')."""
    out: list[str] = []
    i = 0
    n = len(sql)
    while i < n:
        ch = sql[i]
        if ch == "'":
            out.append("''")
            i += 1
            while i < n:
                if sql[i] == "'" and i + 1 < n and sql[i + 1] == "'":
                    i += 2
                    continue
                if sql[i] == "'":
                    i += 1
                    break
                i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _strip_leading_comments(sql: str) -> str:
    """Remove leading -- and /* */ comments for statement-kind detection."""
    text = sql.lstrip()
    while text:
        if text.startswith("--"):
            nl = text.find("\n")
            text = text[nl + 1 :].lstrip() if nl >= 0 else ""
            continue
        if text.startswith("/*"):
            end = text.find("*/")
            text = text[end + 2 :].lstrip() if end >= 0 else ""
            continue
        break
    return text


def validate_readonly_sql(sql: str) -> None:
    """Reject anything that is not a single read-only SELECT (optional WITH)."""
    text = sql.strip()
    if not text:
        raise SqlValidationError("Empty SQL is not allowed.")

    head = _strip_leading_comments(text).upper()
    if not (head.startswith("SELECT") or head.startswith("WITH")):
        raise SqlValidationError("Only SELECT (or WITH … SELECT) statements are allowed.")

    # Allow one trailing semicolon only.
    trimmed = text.rstrip()
    if trimmed.endswith(";"):
        trimmed = trimmed[:-1].rstrip()
    if ";" in trimmed:
        raise SqlValidationError("Multiple statements are not allowed.")

    scan = _strip_quoted_literals(text)
    if _FORBIDDEN.search(scan):
        raise SqlValidationError("DDL/DML or unsafe keywords are not allowed.")
    if _PG_UNSAFE.search(scan):
        raise SqlValidationError("Unsafe pg_* functions are not allowed.")


def quote_ident(name: str) -> str:
    if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", name):
        raise SqlValidationError(f"Invalid identifier: {name}")
    return name


def quote_literal(val: object) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "TRUE" if val else "FALSE"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val).replace("'", "''")
    return f"'{s}'"
