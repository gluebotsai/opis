from __future__ import annotations

from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor


def fetchall(dsn: str, sql: str, params: Any = None, *, timeout_ms: int = 15000) -> list[dict[str, Any]]:
    conn = psycopg2.connect(dsn)
    try:
        conn.set_session(readonly=True, autocommit=True)
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute(f"SET statement_timeout = {int(timeout_ms)}")
            if params:
                cur.execute(sql, params)
            else:
                cur.execute(sql)
            rows = cur.fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
