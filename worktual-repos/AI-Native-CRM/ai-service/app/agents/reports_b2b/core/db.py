"""Read-only Postgres for rpt.* warehouse queries (asyncpg — same driver as MCP)."""

from __future__ import annotations

import asyncio
import re
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Mapping, Sequence
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import asyncpg

from app.config import get_settings

_SEARCH_PATH = "rpt, crm, accounts, inventory, cdp, public"
_NAMED = re.compile(r"%\(([A-Za-z_][A-Za-z0-9_]*)\)s")
_POS = re.compile(r"(?<!%)%s")


def warehouse_dsn() -> str:
    settings = get_settings()
    raw = (settings.reports_warehouse_database_url or settings.database_url or "").strip()
    if not raw:
        raise RuntimeError(
            "DATABASE_URL or REPORTS_WAREHOUSE_DATABASE_URL is required for reports analytics"
        )
    parsed = urlparse(raw)
    qs = parse_qs(parsed.query)
    for key in list(qs.keys()):
        if key.lower() in {"schema", "pgbouncer", "connection_limit"}:
            del qs[key]
    clean = parsed._replace(query=urlencode({k: v[0] for k, v in qs.items()}))
    return urlunparse(clean)


def adapt_sql(
    sql: str,
    params: Mapping[str, Any] | Sequence[Any] | None = None,
) -> tuple[str, list[Any]]:
    """Turn psycopg ``%(name)s`` / ``%s`` placeholders into asyncpg ``$n``."""
    if params is None:
        out = sql.replace("%%", "%")
        return out, []
    if isinstance(params, Mapping):
        args: list[Any] = []

        def named(match: re.Match[str]) -> str:
            key = match.group(1)
            if key not in params:
                raise KeyError(key)
            args.append(params[key])
            return f"${len(args)}"

        converted = _NAMED.sub(named, sql).replace("%%", "%")
        return converted, args
    args_seq = list(params)
    index = 0

    def positional(_match: re.Match[str]) -> str:
        nonlocal index
        index += 1
        return f"${index}"

    converted = _POS.sub(positional, sql).replace("%%", "%")
    return converted, args_seq


def _run_coro_sync(coro: Any) -> Any:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(asyncio.run, coro).result()


async def _fetch_async(
    sql: str,
    args: Sequence[Any],
    *,
    dsn: str,
    statement_timeout: str,
) -> list[dict[str, Any]]:
    conn = await asyncpg.connect(dsn, timeout=10, command_timeout=20)
    try:
        await conn.execute("SET default_transaction_read_only = on")
        await conn.execute(f"SET search_path TO {_SEARCH_PATH}")
        await conn.execute(f"SET statement_timeout = '{statement_timeout}'")
        rows = await conn.fetch(sql, *args)
        return [dict(row) for row in rows]
    finally:
        await conn.close()


def fetch_warehouse_rows(
    sql: str,
    params: Mapping[str, Any] | Sequence[Any] | None = None,
    *,
    dsn: str | None = None,
    statement_timeout: str = "20s",
) -> list[dict[str, Any]]:
    """Execute one read-only statement and return dict rows."""
    converted, args = adapt_sql(sql, params)
    return _run_coro_sync(
        _fetch_async(
            converted,
            args,
            dsn=(dsn or warehouse_dsn()).strip(),
            statement_timeout=statement_timeout,
        )
    )


# Older call sites expected a live connection; keep the name as an alias.
def get_db_connection():  # pragma: no cover — compatibility shim
    raise RuntimeError("Use fetch_warehouse_rows; reports SQL runs on asyncpg")
