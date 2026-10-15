"""PostgreSQL connection helpers for auth/config (ingest domain checks)."""

from __future__ import annotations

import os
import re
from contextlib import contextmanager
from typing import Any, Generator

from shared.env import load_project_env

load_project_env()

_SCHEMA_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def postgres_read_only() -> bool:
    """Live PostgreSQL auth DB is read-only by default (SELECT only)."""
    return os.environ.get("POSTGRES_READ_ONLY", "true").lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


def _valid_schema(name: str) -> str:
    if not _SCHEMA_RE.match(name):
        raise ValueError(f"Invalid DB_SCHEMA identifier: {name!r}")
    return name


def database_url() -> str:
    from urllib.parse import quote_plus

    # Prefer discrete DB_* vars so passwords with @, :, etc. are not misparsed in URLs.
    if os.environ.get("DB_HOST") or os.environ.get("DB_PASSWORD"):
        host = os.environ.get("DB_HOST", "localhost")
        port = os.environ.get("DB_PORT", "5432")
        name = os.environ.get("DB_NAME", "web_analytics")
        user = os.environ.get("DB_USER", "analytics_user")
        password = os.environ.get("DB_PASSWORD", "")
        return f"postgresql://{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{name}"

    url = os.environ.get("DATABASE_URL")
    if url:
        return url

    return f"postgresql://{quote_plus('analytics_user')}:@{os.environ.get('DB_HOST', 'localhost')}:5432/web_analytics"


@contextmanager
def get_pg_connection() -> Generator[Any, None, None]:
    import psycopg
    from psycopg.rows import dict_row

    conn = psycopg.connect(database_url(), row_factory=dict_row)
    try:
        schema = os.environ.get("DB_SCHEMA", "public")
        conn.execute(f"SET search_path TO {_valid_schema(schema)}, public")
        if postgres_read_only():
            conn.execute("SET default_transaction_read_only = on")
        yield conn
    finally:
        conn.close()
