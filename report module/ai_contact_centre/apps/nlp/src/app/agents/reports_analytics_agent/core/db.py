"""Read-only Postgres. Bound parameters only. Timeout from product.yml."""

from __future__ import annotations

from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg2
from psycopg2.extras import RealDictCursor

# Prisma / Node extras on DATABASE_URL. libpq rejects them (`schema`, …).
# The pack still reads rpt.* and product.yml; it does not use Prisma's search_path.
_PRISMA_DSN_KEYS = frozenset(
    {
        "schema",
        "connection_limit",
        "pool_timeout",
        "socket_timeout",
        "pgbouncer",
        "statement_cache_size",
        "sslidentity",
        "sslcert",
        "sslkey",
        "sslpassword",
    }
)


def connect_dsn(dsn: str) -> str:
    """Keep host/user/db; drop query keys libpq does not understand."""
    raw = (dsn or "").strip()
    if not raw or "://" not in raw:
        return raw
    parts = urlsplit(raw)
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k.lower() not in _PRISMA_DSN_KEYS]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment))


def _timeout_ms() -> int:
    try:
        from .loader import load_product

        defaults = (load_product().get("product") or {}).get("defaults") or {}
        return int(defaults.get("statement_timeout_ms") or 15000)
    except Exception:
        return 15000


def fetchall(
    dsn: str,
    sql: str,
    params: Any = None,
    *,
    timeout_ms: int | None = None,
) -> list[dict[str, Any]]:
    if timeout_ms is None:
        timeout_ms = _timeout_ms()
    conn = psycopg2.connect(connect_dsn(dsn))
    try:
        conn.set_session(readonly=True, autocommit=True)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"SET statement_timeout = {int(timeout_ms)}")
            if params is not None:
                cur.execute(sql, params)
            else:
                cur.execute(sql)
            rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
