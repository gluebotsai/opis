"""Read-only database execution for SQL agent."""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from sql_agent.errors import SqlAgentError, WarehouseUnavailableError

_RELATION_RE = re.compile(
    r'(?:FROM|JOIN)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\."?([a-zA-Z_][a-zA-Z0-9_]*)"?',
    re.I,
)


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


def _relation_hint(
    sql: str,
    *,
    schema: str | None,
    table: str | None,
) -> tuple[str | None, str | None]:
    if schema and table:
        return schema, table
    match = _RELATION_RE.search(sql or "")
    if match:
        return match.group(1), match.group(2)
    return schema, table


def _reraise_postgres(
    exc: BaseException,
    *,
    schema: str | None,
    table: str | None,
    sql: str,
) -> None:
    schema, table = _relation_hint(sql, schema=schema, table=table)
    rel = f"{schema}.{table}" if schema and table else "warehouse relation"
    try:
        import psycopg2.errors as pg_errors
    except ImportError:
        raise exc

    if isinstance(exc, pg_errors.UndefinedTable):
        raise SqlAgentError(
            f"Warehouse table does not exist: {rel}. "
            "The compiled catalog may not match this database — re-run "
            "scripts/compile_sql_catalog.py against live Postgres.",
            code="missing_warehouse_table",
        ) from exc
    if isinstance(exc, pg_errors.UndefinedColumn):
        raise SqlAgentError(
            f"Warehouse column missing for query on {rel}: {exc}",
            code="missing_warehouse_column",
        ) from exc
    if isinstance(exc, pg_errors.OperationalError):
        raise WarehouseUnavailableError(
            f"Postgres unavailable: {exc}",
            code="unavailable",
        ) from exc
    raise exc


def _reraise_clickhouse(
    exc: BaseException,
    *,
    schema: str | None,
    table: str | None,
    sql: str,
) -> None:
    schema, table = _relation_hint(sql, schema=schema, table=table)
    rel = f"{schema}.{table}" if schema and table else "warehouse relation"
    msg = str(exc).lower()
    if "unknown table" in msg or "doesn't exist" in msg or "does not exist" in msg:
        raise SqlAgentError(
            f"ClickHouse table does not exist: {rel}. "
            "Recompile webtracking catalog against the warehouse.",
            code="missing_warehouse_table",
        ) from exc
    if "connection" in msg or "timeout" in msg or "refused" in msg:
        raise WarehouseUnavailableError(
            f"ClickHouse unavailable: {exc}",
            code="unavailable",
        ) from exc
    raise exc


def run_postgres_query(
    sql: str,
    params: list[object],
    *,
    schema: str | None = None,
    table: str | None = None,
) -> list[dict[str, Any]]:
    try:
        import psycopg2.extras
    except ImportError as exc:
        raise WarehouseUnavailableError(
            "psycopg2 required for SQL executor",
            code="unavailable",
        ) from exc

    from semantic.pg_pool import checkout_connection, release_connection
    from sql_agent.validator import validate_readonly_sql

    validate_readonly_sql(sql)
    _load_dotenv()
    conn = checkout_connection()
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
    except Exception as exc:
        _reraise_postgres(exc, schema=schema, table=table, sql=sql)
        raise  # pragma: no cover
    finally:
        release_connection(conn)


def run_clickhouse_query(
    sql: str,
    params: list[object],
    *,
    schema: str | None = None,
    table: str | None = None,
) -> list[dict[str, Any]]:
    """Execute read-only ClickHouse query (webtracking marts)."""
    _load_dotenv()
    host = os.environ.get("ch_host") or os.environ.get("CH_HOST")
    if not host:
        raise WarehouseUnavailableError(
            "ch_host not configured for ClickHouse",
            code="unavailable",
        )

    try:
        import clickhouse_connect
    except ImportError:
        try:
            from clickhouse_driver import Client
        except ImportError as exc:
            raise WarehouseUnavailableError(
                "clickhouse-connect or clickhouse-driver required for webtracking",
                code="unavailable",
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
        try:
            rows, cols = client.execute(sql, params, with_column_types=True)
            col_names = [c[0] for c in cols]
            return [dict(zip(col_names, row)) for row in rows]
        except Exception as exc:
            _reraise_clickhouse(exc, schema=schema, table=table, sql=sql)
            raise  # pragma: no cover

    raw_port = os.environ.get("ch_port") or os.environ.get("CH_PORT") or "8123"
    http_port = int(raw_port)
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
    try:
        result = client.query(sql, parameters=params)
        cols = result.column_names
        return [dict(zip(cols, row)) for row in result.result_rows]
    except Exception as exc:
        _reraise_clickhouse(exc, schema=schema, table=table, sql=sql)
        raise  # pragma: no cover
