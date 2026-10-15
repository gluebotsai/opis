"""Hub OAuth clients for A2A spokes — accounts.a2a_spoke_clients.

One row per spoke (`a2a_server_name`). Hub SELECTs `access_token`; this spoke
replaces access + refresh after POST /token. Memory fallback is for tests /
offline when ACCOUNT_DATABASE_URL is unset.
"""

from __future__ import annotations

import hmac
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from app.config import get_settings

log = logging.getLogger("ai-service.a2a.clients")

_MEMORY: dict[tuple[str, str], "SpokeClient"] = {}


@dataclass
class SpokeClient:
    a2a_server_name: str
    client_id: str
    client_secret: str
    access_token: str | None = None
    access_expires_at: datetime | None = None
    refresh_token: str | None = None
    refresh_expires_at: datetime | None = None
    skill_version: str | None = None


def secrets_equal(left: str, right: str) -> bool:
    a = (left or "").encode("utf-8")
    b = (right or "").encode("utf-8")
    if len(a) != len(b):
        return False
    return hmac.compare_digest(a, b)


def this_server_name() -> str:
    return (get_settings().a2a_server_name or "worktual-crm").strip() or "worktual-crm"


def reset_memory() -> None:
    _MEMORY.clear()
    _seed_memory_from_settings()


def _seed_memory_from_settings() -> None:
    settings = get_settings()
    pairs = (
        (
            this_server_name(),
            (settings.a2a_spoke_client_id or "").strip(),
            (settings.a2a_spoke_client_secret or "").strip(),
        ),
        (
            (settings.hub_a2a_server_name or "worktual-hub").strip() or "worktual-hub",
            (settings.hub_a2a_client_id or "").strip(),
            (settings.hub_a2a_client_secret or "").strip(),
        ),
    )
    for server, client_id, secret in pairs:
        if not client_id or not secret:
            continue
        key = (server, client_id)
        if key not in _MEMORY:
            _MEMORY[key] = SpokeClient(
                a2a_server_name=server,
                client_id=client_id,
                client_secret=secret,
            )


async def _upsert_client_row(conn: Any, server: str, client_id: str, secret: str) -> None:
    await conn.execute(
        """
        INSERT INTO accounts.a2a_spoke_clients (
          a2a_server_name, client_id, client_secret, created_at, updated_at
        ) VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT (a2a_server_name) DO UPDATE SET
          client_id = EXCLUDED.client_id,
          client_secret = EXCLUDED.client_secret,
          updated_at = NOW()
        """,
        server,
        client_id,
        secret,
    )


async def ensure_seed_row() -> None:
    """Insert this spoke + Hub peer env clients if the accounts rows are missing."""
    settings = get_settings()
    _seed_memory_from_settings()
    rows = (
        (
            this_server_name(),
            (settings.a2a_spoke_client_id or "").strip(),
            (settings.a2a_spoke_client_secret or "").strip(),
        ),
        (
            (settings.hub_a2a_server_name or "worktual-hub").strip() or "worktual-hub",
            (settings.hub_a2a_client_id or "").strip(),
            (settings.hub_a2a_client_secret or "").strip(),
        ),
    )
    conn = None
    try:
        conn = await _connect()
        if conn is None:
            return
        for server, client_id, secret in rows:
            if not client_id or not secret:
                continue
            await _upsert_client_row(conn, server, client_id, secret)
    except Exception as exc:  # noqa: BLE001
        log.debug("a2a spoke client seed skipped: %s", exc)
    finally:
        if conn is not None:
            await conn.close()


def _row_to_client(row: Any) -> SpokeClient:
    data = dict(row)
    access = data.get("access_token")
    refresh = data.get("refresh_token")
    version = data.get("skill_version")
    return SpokeClient(
        a2a_server_name=str(data["a2a_server_name"]),
        client_id=str(data["client_id"]),
        client_secret=str(data["client_secret"]),
        access_token=str(access) if access else None,
        access_expires_at=data.get("access_expires_at"),
        refresh_token=str(refresh) if refresh else None,
        refresh_expires_at=data.get("refresh_expires_at"),
        skill_version=str(version) if version else None,
    )


def _accounts_dsn() -> str:
    settings = get_settings()
    return (settings.account_database_url or settings.database_url or "").strip()


async def _connect():
    dsn = _accounts_dsn()
    if not dsn:
        return None
    import asyncpg

    from app.mcp.db import _normalize_dsn

    clean, _search = _normalize_dsn(dsn)
    return await asyncpg.connect(clean)


async def load_client(*, client_id: str, server_name: str) -> SpokeClient | None:
    _seed_memory_from_settings()
    conn = None
    try:
        conn = await _connect()
        if conn is not None:
            row = await conn.fetchrow(
                """
                SELECT a2a_server_name, client_id, client_secret,
                       access_token, access_expires_at,
                       refresh_token, refresh_expires_at, skill_version
                FROM accounts.a2a_spoke_clients
                WHERE client_id = $1
                LIMIT 1
                """,
                client_id,
            )
            if row:
                return _row_to_client(row)
            return None
    except Exception as exc:  # noqa: BLE001
        log.warning("a2a spoke client load failed: %s", exc)
    finally:
        if conn is not None:
            await conn.close()
    return _MEMORY.get((server_name, client_id))


async def load_client_by_server(server_name: str) -> SpokeClient | None:
    """Load the unique spoke row (CRM spoke or Hub peer)."""
    _seed_memory_from_settings()
    name = (server_name or "").strip()
    conn = None
    try:
        conn = await _connect()
        if conn is not None:
            row = await conn.fetchrow(
                """
                SELECT a2a_server_name, client_id, client_secret,
                       access_token, access_expires_at,
                       refresh_token, refresh_expires_at, skill_version
                FROM accounts.a2a_spoke_clients
                WHERE a2a_server_name = $1
                LIMIT 1
                """,
                name,
            )
            if row:
                return _row_to_client(row)
            return None
    except Exception as exc:  # noqa: BLE001
        log.warning("a2a spoke client load by server failed: %s", exc)
    finally:
        if conn is not None:
            await conn.close()
    for (srv, _cid), rec in _MEMORY.items():
        if srv == name:
            return rec
    return None


async def persist_tokens(
    *,
    client_id: str,
    server_name: str,
    access_token: str,
    access_expires_at: datetime,
    refresh_token: str,
    refresh_expires_at: datetime,
    skill_version: str,
    client_secret: str | None = None,
) -> None:
    now = datetime.now(timezone.utc)
    existing = _MEMORY.get((server_name, client_id))
    secret = client_secret or (existing.client_secret if existing else "")
    _MEMORY[(server_name, client_id)] = SpokeClient(
        a2a_server_name=server_name,
        client_id=client_id,
        client_secret=secret,
        access_token=access_token,
        access_expires_at=access_expires_at,
        refresh_token=refresh_token,
        refresh_expires_at=refresh_expires_at,
        skill_version=skill_version,
    )
    conn = None
    try:
        conn = await _connect()
        if conn is None:
            return
        result = await conn.execute(
            """
            UPDATE accounts.a2a_spoke_clients
            SET access_token = $1,
                access_expires_at = $2,
                refresh_token = $3,
                refresh_expires_at = $4,
                skill_version = $5,
                updated_at = $6
            WHERE a2a_server_name = $7
              AND client_id = $8
            """,
            access_token,
            access_expires_at,
            refresh_token,
            refresh_expires_at,
            skill_version,
            now,
            server_name,
            client_id,
        )
        if str(result) == "UPDATE 0" and secret:
            await conn.execute(
                """
                INSERT INTO accounts.a2a_spoke_clients (
                  a2a_server_name, client_id, client_secret,
                  access_token, access_expires_at,
                  refresh_token, refresh_expires_at, skill_version,
                  created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
                """,
                server_name,
                client_id,
                secret,
                access_token,
                access_expires_at,
                refresh_token,
                refresh_expires_at,
                skill_version,
                now,
            )
    except Exception as exc:  # noqa: BLE001
        log.warning("a2a spoke client token persist failed: %s", exc)
    finally:
        if conn is not None:
            await conn.close()
