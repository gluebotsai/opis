"""Shared Postgres connection pool for semantic-layer DB reads."""

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Any

try:
    import psycopg2
    from psycopg2.pool import ThreadedConnectionPool
except ImportError:  # pragma: no cover
    psycopg2 = None  # type: ignore[assignment]
    ThreadedConnectionPool = None  # type: ignore[assignment,misc]

_pool: ThreadedConnectionPool | None = None
_pool_lock = threading.Lock()
_pooled_conn_ids: set[int] = set()
_pooled_ids_lock = threading.Lock()

_POOL_MIN = 2
_POOL_MAX = 8


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip("'\""))


def _connect_kwargs() -> dict[str, Any] | None:
    if psycopg2 is None or ThreadedConnectionPool is None:
        return None
    _load_dotenv()
    host = os.environ.get("pg_host") or os.environ.get("PG_HOST")
    if not host:
        return None
    return {
        "host": host,
        "port": int(os.environ.get("pg_port") or os.environ.get("PG_PORT") or 5432),
        "dbname": os.environ.get("pg_db") or os.environ.get("PG_DB") or "postgres",
        "user": os.environ.get("pg_user") or os.environ.get("PG_USER") or "postgres",
        "password": os.environ.get("pg_pass")
        or os.environ.get("PG_PASSWORD")
        or "",
        "connect_timeout": 15,
    }


def _mark_pooled(conn: Any, pooled: bool) -> None:
    """Track pool membership externally — psycopg2 connections reject setattr."""
    cid = id(conn)
    with _pooled_ids_lock:
        if pooled:
            _pooled_conn_ids.add(cid)
        else:
            _pooled_conn_ids.discard(cid)


def _unmark_pooled(conn: Any) -> None:
    with _pooled_ids_lock:
        _pooled_conn_ids.discard(id(conn))


def is_pooled_connection(conn: Any) -> bool:
    with _pooled_ids_lock:
        return id(conn) in _pooled_conn_ids


def _ensure_pool() -> ThreadedConnectionPool | None:
    global _pool
    if _pool is not None:
        return _pool
    with _pool_lock:
        if _pool is not None:
            return _pool
        kwargs = _connect_kwargs()
        if kwargs is None:
            return None
        _pool = ThreadedConnectionPool(_POOL_MIN, _POOL_MAX, **kwargs)
        return _pool


def checkout_connection() -> Any:
    """Return a pooled connection with statement_timeout set, or a one-off connect."""
    pool = _ensure_pool()
    if pool is None:
        kwargs = _connect_kwargs()
        if kwargs is None:
            raise RuntimeError("pg_host not configured")
        conn = psycopg2.connect(**kwargs)
        pooled = False
    else:
        conn = pool.getconn()
        pooled = True
    _mark_pooled(conn, pooled)
    try:
        with conn.cursor() as cur:
            cur.execute("SET statement_timeout = '30s'")
            cur.execute("SET default_transaction_read_only = on")
    except Exception:
        release_connection(conn, close_on_error=True)
        raise
    return conn


def release_connection(
    conn: Any,
    *,
    pooled: bool | None = None,
    close_on_error: bool = False,
) -> None:
    """Return connection to pool or close one-off connection."""
    if conn is None:
        return
    is_pooled = pooled if pooled is not None else is_pooled_connection(conn)
    _unmark_pooled(conn)
    pool = _pool
    if is_pooled and pool is not None and not close_on_error:
        try:
            if not conn.closed:
                pool.putconn(conn)
                return
        except Exception:
            pass
    try:
        conn.close()
    except Exception:
        pass


def close_pool() -> None:
    """Close and discard the shared pool (runtime reload)."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            try:
                _pool.closeall()
            except Exception:
                pass
            _pool = None
    with _pooled_ids_lock:
        _pooled_conn_ids.clear()
