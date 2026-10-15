"""Postgres access for live module data (org-scoped) — reads and writes."""

from __future__ import annotations

from contextlib import contextmanager
from threading import Lock
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row

from app.config import get_settings

_pool_lock = Lock()
_pool: Any | None = None


def _connect() -> psycopg.Connection:
    settings = get_settings()
    conn = psycopg.connect(
        settings.database_url,
        row_factory=dict_row,
        options="-c search_path=ticketing",
    )
    with conn.cursor() as cur:
        cur.execute("SET search_path TO ticketing")
    return conn


def _get_pool():
    """Lazy ConnectionPool when psycopg_pool is installed; else None."""
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is not None:
            return _pool
        try:
            from psycopg_pool import ConnectionPool  # type: ignore
        except ImportError:
            return None
        settings = get_settings()
        _pool = ConnectionPool(
            conninfo=settings.database_url,
            min_size=0,
            max_size=8,
            kwargs={
                "row_factory": dict_row,
                "options": "-c search_path=ticketing",
            },
            open=True,
        )
        return _pool


def close_pool() -> None:
    """Shut down the lazy connection pool (tests / process exit)."""
    global _pool
    with _pool_lock:
        pool = _pool
        _pool = None
    if pool is None:
        return
    try:
        pool.close()
    except Exception:  # noqa: BLE001
        pass


@contextmanager
def db_conn() -> Iterator[psycopg.Connection]:
    """Borrow a pooled connection when available; otherwise open a short-lived one."""
    pool = _get_pool()
    if pool is not None:
        with pool.connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SET search_path TO ticketing")
            yield conn
        return
    with _connect() as conn:
        yield conn


def fetch_all(
    sql: str,
    params: tuple[Any, ...] | list[Any] | None = None,
    *,
    conn: psycopg.Connection | None = None,
) -> list[dict[str, Any]]:
    if conn is not None:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            return list(cur.fetchall())
    with db_conn() as c:
        with c.cursor() as cur:
            cur.execute(sql, params or ())
            return list(cur.fetchall())


def fetch_one(
    sql: str,
    params: tuple[Any, ...] | list[Any] | None = None,
    *,
    conn: psycopg.Connection | None = None,
) -> dict[str, Any] | None:
    rows = fetch_all(sql, params, conn=conn)
    return rows[0] if rows else None


def execute(sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> int:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            count = cur.rowcount
        conn.commit()
        return count


def execute_returning(
    sql: str, params: tuple[Any, ...] | list[Any] | None = None
) -> dict[str, Any] | None:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            row = cur.fetchone()
        conn.commit()
        return dict(row) if row else None


def execute_returning_all(
    sql: str, params: tuple[Any, ...] | list[Any] | None = None
) -> list[dict[str, Any]]:
    with db_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            rows = list(cur.fetchall())
        conn.commit()
        return [dict(r) for r in rows]
