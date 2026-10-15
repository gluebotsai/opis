"""Async Postgres pool for CRM MCP tool handlers (crm.* writes)."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import asyncpg

from app.config import get_settings

log = logging.getLogger("ai-service.mcp.db")

_pool: asyncpg.Pool | None = None
_search_path: str = "crm, inventory, public"



def _normalize_dsn(url: str) -> tuple[str, str]:
    """Prisma uses ``?schema=crm``; asyncpg needs a clean DSN + search_path."""
    raw = (url or "").strip()
    if not raw:
        return "", "crm, inventory, public"
    parsed = urlparse(raw)
    qs = parse_qs(parsed.query)
    schema = "crm"
    if "schema" in qs and qs["schema"]:
        schema = (qs["schema"][0] or "crm").strip() or "crm"
        del qs["schema"]
    # Drop other Prisma-only params asyncpg may reject
    for key in list(qs.keys()):
        if key.lower() in {"schema", "pgbouncer", "connection_limit"}:
            del qs[key]
    clean = parsed._replace(query=urlencode({k: v[0] for k, v in qs.items()}))
    search_path = f"{schema}, inventory, public" if schema != "public" else "inventory, public"
    return urlunparse(clean), search_path


async def _init_conn(conn: asyncpg.Connection) -> None:
    # Also re-applied on every acquire — pool reset clears session state.
    await conn.execute(f"SET search_path TO {_search_path}")


async def get_pool() -> asyncpg.Pool:
    global _pool, _search_path
    if _pool is not None:
        return _pool
    settings = get_settings()
    dsn, _search_path = _normalize_dsn(settings.database_url)
    if not dsn:
        raise RuntimeError(
            "DATABASE_URL is not set — MCP tools cannot write to crm.*"
        )
    _pool = await asyncpg.create_pool(
        dsn=dsn, min_size=1, max_size=5, init=_init_conn
    )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


@asynccontextmanager
async def acquire() -> AsyncIterator[asyncpg.Connection]:
    """Acquire a connection with crm search_path (pool reset clears SET)."""
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(f"SET search_path TO {_search_path}")
        yield conn


async def fetchrow(sql: str, *args: Any) -> asyncpg.Record | None:
    async with acquire() as conn:
        return await conn.fetchrow(sql, *args)


async def fetch(sql: str, *args: Any) -> list[asyncpg.Record]:
    async with acquire() as conn:
        return await conn.fetch(sql, *args)


async def execute(sql: str, *args: Any) -> str:
    async with acquire() as conn:
        return await conn.execute(sql, *args)


async def fetchval(sql: str, *args: Any) -> Any:
    async with acquire() as conn:
        return await conn.fetchval(sql, *args)
