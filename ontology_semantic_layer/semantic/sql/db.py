"""Read-only database execution for SQL agent."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip("'\""))


def run_postgres_query(sql: str, params: list[object]) -> list[dict[str, Any]]:
    try:
        import psycopg2.extras
    except ImportError as exc:
        raise RuntimeError("psycopg2 required for SQL executor") from exc

    from semantic.pg_pool import checkout_connection, release_connection
    from semantic.sql.validator import validate_readonly_sql

    validate_readonly_sql(sql)
    _load_dotenv()
    conn = checkout_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
    finally:
        release_connection(conn)


def run_clickhouse_query(sql: str, params: list[object]) -> list[dict[str, Any]]:
    """Execute read-only ClickHouse query (webtracking marts)."""
    _load_dotenv()
    host = os.environ.get("ch_host") or os.environ.get("CH_HOST")
    if not host:
        raise RuntimeError("ch_host not configured for ClickHouse")

    try:
        import clickhouse_connect
    except ImportError:
        try:
            from clickhouse_driver import Client
        except ImportError as exc:
            raise RuntimeError(
                "clickhouse-connect or clickhouse-driver required for webtracking"
            ) from exc
        client = Client(
            host=host,
            port=int(os.environ.get("ch_port") or os.environ.get("CH_PORT") or "9000"),
            user=os.environ.get("ch_user") or os.environ.get("CH_USER") or "default",
            password=os.environ.get("ch_pass") or os.environ.get("CH_PASS") or "",
            database=os.environ.get("ch_db") or os.environ.get("CH_DB") or "default",
            connect_timeout=15,
            send_receive_timeout=30,
        )
        rows, cols = client.execute(sql, params, with_column_types=True)
        col_names = [c[0] for c in cols]
        return [dict(zip(col_names, row)) for row in rows]

    raw_port = os.environ.get("ch_port") or os.environ.get("CH_PORT") or "8123"
    http_port = int(raw_port)
    # clickhouse-connect speaks HTTP; 9000 is the native protocol port.
    if http_port == 9000:
        http_port = 8123
    client = clickhouse_connect.get_client(
        host=host,
        port=http_port,
        username=os.environ.get("ch_user") or os.environ.get("CH_USER") or "default",
        password=os.environ.get("ch_pass") or os.environ.get("CH_PASS") or "",
        database=os.environ.get("ch_db") or os.environ.get("CH_DB") or "default",
        connect_timeout=15,
        send_receive_timeout=30,
    )
    result = client.query(sql, parameters=params)
    cols = result.column_names
    return [dict(zip(cols, row)) for row in result.result_rows]
