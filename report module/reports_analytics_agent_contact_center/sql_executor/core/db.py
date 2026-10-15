from __future__ import annotations

import threading
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor

_THREAD_LOCAL = threading.local()


def _get_connection(dsn: str) -> psycopg2.extensions.connection:
    conn = getattr(_THREAD_LOCAL, "conn", None)
    current_dsn = getattr(_THREAD_LOCAL, "dsn", None)
    if conn is None or conn.closed != 0 or current_dsn != dsn:
        conn = psycopg2.connect(dsn)
        conn.set_session(readonly=True, autocommit=True)
        _THREAD_LOCAL.conn = conn
        _THREAD_LOCAL.dsn = dsn
    return conn


def fetchall(dsn: str, sql: str, params: tuple[Any, ...] = (), *, timeout_ms: int = 15000) -> list[dict[str, Any]]:
    conn = _get_connection(dsn)
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(f"SET statement_timeout = {int(timeout_ms)}")
        if params:
            cur.execute(sql, params)
        else:
            cur.execute(sql)
        rows = cur.fetchall()
    return [dict(r) for r in rows]
