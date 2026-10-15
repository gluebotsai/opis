"""Read-only Postgres. Bound parameters only. Timeout from product.yml."""

from __future__ import annotations

from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor


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
    conn = psycopg2.connect(dsn)
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
