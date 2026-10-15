"""accounts.a2a_spoke_clients store — Postgres (preferred) or in-memory."""

from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse, urlunparse

from app.config import get_settings

_log = logging.getLogger(__name__)


@dataclass
class SpokeClientRow:
    a2a_server_name: str
    client_id: str
    client_secret: str
    access_token: str | None = None
    refresh_token: str | None = None
    access_expires_at: float | None = None
    refresh_expires_at: float | None = None
    meta: dict[str, Any] = field(default_factory=dict)


_MEMORY: dict[str, SpokeClientRow] = {}


def _normalize_dsn(url: str) -> str:
    """asyncpg wants postgresql:// without SQLAlchemy +driver suffixes."""
    raw = (url or "").strip()
    if not raw:
        return ""
    # Strip query params that confuse asyncpg (e.g. schema=)
    parsed = urlparse(raw)
    scheme = parsed.scheme.replace("postgresql+asyncpg", "postgresql").replace(
        "postgres://", "postgresql://"
    )
    if scheme.startswith("postgres") and not scheme.startswith("postgresql"):
        scheme = "postgresql"
    # urlparse may leave scheme as postgresql+psycopg2 etc.
    if "+" in scheme:
        scheme = scheme.split("+", 1)[0]
    cleaned = parsed._replace(scheme=scheme, query="", fragment="")
    return urlunparse(cleaned)


def _use_db() -> bool:
    return bool(get_settings().account_database_url.strip())


def _dsn() -> str:
    return _normalize_dsn(get_settings().account_database_url)


def _seed_memory() -> None:
    s = get_settings()
    if s.a2a_server_name not in _MEMORY:
        _MEMORY[s.a2a_server_name] = SpokeClientRow(
            a2a_server_name=s.a2a_server_name,
            client_id=s.a2a_spoke_client_id,
            client_secret=s.a2a_spoke_client_secret,
        )
    hub_name = s.hub_a2a_server_name
    if hub_name and hub_name not in _MEMORY:
        _MEMORY[hub_name] = SpokeClientRow(
            a2a_server_name=hub_name,
            client_id=s.hub_a2a_client_id,
            client_secret=s.hub_a2a_client_secret or "",
        )


def _credentials_for(a2a_server_name: str) -> tuple[str, str]:
    s = get_settings()
    if a2a_server_name == s.a2a_server_name:
        return s.a2a_spoke_client_id, s.a2a_spoke_client_secret
    if a2a_server_name == s.hub_a2a_server_name:
        return s.hub_a2a_client_id, s.hub_a2a_client_secret or ""
    return "", ""


async def _connect():
    import asyncpg  # type: ignore

    return await asyncpg.connect(_dsn(), timeout=15)


def _on_conflict_unsupported(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "on conflict" in msg or "unique or exclusion constraint" in msg


async def _ensure_spoke_row_plain(
    conn: Any,
    a2a_server_name: str,
    cid: str,
    secret: str,
) -> bool:
    """Upsert without ON CONFLICT (legacy accounts.a2a_spoke_clients schemas)."""
    updated = await conn.execute(
        """
        UPDATE accounts.a2a_spoke_clients
        SET client_id = $2,
            client_secret = COALESCE(NULLIF($3, ''), client_secret),
            updated_at = NOW()
        WHERE a2a_server_name = $1
        """,
        a2a_server_name,
        cid,
        secret,
    )
    if not str(updated).endswith("0"):
        return True
    try:
        await conn.execute(
            """
            INSERT INTO accounts.a2a_spoke_clients (
              a2a_server_name, client_id, client_secret, created_at, updated_at
            ) VALUES ($1, $2, $3, NOW(), NOW())
            """,
            a2a_server_name,
            cid,
            secret,
        )
        return True
    except Exception as exc:  # noqa: BLE001
        if "unique" not in str(exc).lower() and "duplicate" not in str(exc).lower():
            _log.error("_ensure_spoke_row_plain insert failed: %s", exc)
            return False
        await conn.execute(
            """
            UPDATE accounts.a2a_spoke_clients
            SET a2a_server_name = $1,
                client_secret = COALESCE(NULLIF($3, ''), client_secret),
                updated_at = NOW()
            WHERE client_id = $2
            """,
            a2a_server_name,
            cid,
            secret,
        )
        return True


async def get_client_by_server_name(a2a_server_name: str) -> SpokeClientRow | None:
    name = str(a2a_server_name or "").strip()
    if not name:
        return None
    if not _use_db():
        _seed_memory()
        return _MEMORY.get(name)

    try:
        import asyncpg  # noqa: F401
    except ImportError:
        _log.warning("asyncpg not installed; falling back to in-memory A2A clients")
        _seed_memory()
        return _MEMORY.get(name)

    try:
        conn = await _connect()
    except Exception as exc:  # noqa: BLE001
        _log.error("A2A DB connect failed: %s — falling back to memory", exc)
        _seed_memory()
        return _MEMORY.get(name)

    try:
        row = await conn.fetchrow(
            """
            SELECT a2a_server_name, client_id, client_secret,
                   access_token, refresh_token,
                   EXTRACT(EPOCH FROM access_expires_at) AS access_exp,
                   EXTRACT(EPOCH FROM refresh_expires_at) AS refresh_exp
            FROM accounts.a2a_spoke_clients
            WHERE a2a_server_name = $1
            """,
            name,
        )
    finally:
        await conn.close()

    if not row:
        return None
    return SpokeClientRow(
        a2a_server_name=str(row["a2a_server_name"]),
        client_id=str(row["client_id"]),
        client_secret=str(row["client_secret"] or ""),
        access_token=row["access_token"],
        refresh_token=row["refresh_token"],
        access_expires_at=float(row["access_exp"]) if row["access_exp"] else None,
        refresh_expires_at=float(row["refresh_exp"]) if row["refresh_exp"] else None,
    )


async def get_client_by_credentials(
    client_id: str, client_secret: str, a2a_server_name: str
) -> SpokeClientRow | None:
    row = await get_client_by_server_name(a2a_server_name)
    if not row:
        # Env fallback so /token works before the row is seeded.
        s = get_settings()
        if (
            a2a_server_name == s.a2a_server_name
            and client_id == s.a2a_spoke_client_id
            and client_secret == s.a2a_spoke_client_secret
        ):
            return SpokeClientRow(
                a2a_server_name=s.a2a_server_name,
                client_id=s.a2a_spoke_client_id,
                client_secret=s.a2a_spoke_client_secret,
            )
        return None
    if row.client_id != client_id or row.client_secret != client_secret:
        return None
    return row


async def ensure_spoke_row(
    a2a_server_name: str,
    *,
    client_id: str | None = None,
    client_secret: str | None = None,
) -> bool:
    """Insert spoke row if missing (idempotent). Returns True when DB/memory row is ready."""
    cid, secret = _credentials_for(a2a_server_name)
    if client_id:
        cid = client_id
    if client_secret is not None and client_secret != "":
        secret = client_secret
    if not cid:
        return False

    if not _use_db():
        _seed_memory()
        row = _MEMORY.get(a2a_server_name)
        if not row:
            _MEMORY[a2a_server_name] = SpokeClientRow(
                a2a_server_name=a2a_server_name,
                client_id=cid,
                client_secret=secret,
            )
        return True

    try:
        conn = await _connect()
    except Exception as exc:  # noqa: BLE001
        _log.error("ensure_spoke_row connect failed: %s", exc)
        return False

    ok = False
    try:
        await conn.execute(
            """
            INSERT INTO accounts.a2a_spoke_clients (
              a2a_server_name, client_id, client_secret, created_at, updated_at
            ) VALUES ($1, $2, $3, NOW(), NOW())
            ON CONFLICT (a2a_server_name) DO UPDATE
            SET client_id = EXCLUDED.client_id,
                client_secret = COALESCE(NULLIF(EXCLUDED.client_secret, ''), accounts.a2a_spoke_clients.client_secret),
                updated_at = NOW()
            """,
            a2a_server_name,
            cid,
            secret,
        )
        ok = True
    except Exception as exc:  # noqa: BLE001
        if _on_conflict_unsupported(exc):
            _log.warning(
                "ensure_spoke_row: DB has no ON CONFLICT target — using UPDATE/INSERT fallback"
            )
            ok = await _ensure_spoke_row_plain(conn, a2a_server_name, cid, secret)
        else:
            _log.warning("ensure_spoke_row upsert by server_name failed: %s — retry", exc)
            try:
                await conn.execute(
                    """
                    INSERT INTO accounts.a2a_spoke_clients (
                      a2a_server_name, client_id, client_secret, created_at, updated_at
                    ) VALUES ($1, $2, $3, NOW(), NOW())
                    ON CONFLICT (client_id) DO UPDATE
                    SET a2a_server_name = EXCLUDED.a2a_server_name,
                        client_secret = COALESCE(NULLIF(EXCLUDED.client_secret, ''), accounts.a2a_spoke_clients.client_secret),
                        updated_at = NOW()
                    """,
                    a2a_server_name,
                    cid,
                    secret,
                )
                ok = True
            except Exception as exc2:  # noqa: BLE001
                if _on_conflict_unsupported(exc2):
                    ok = await _ensure_spoke_row_plain(
                        conn, a2a_server_name, cid, secret
                    )
                else:
                    _log.error("ensure_spoke_row failed: %s", exc2)
    finally:
        await conn.close()
    return ok


async def save_tokens(
    a2a_server_name: str,
    *,
    access_token: str,
    refresh_token: str,
    access_ttl_s: int,
    refresh_ttl_s: int,
    client_id: str | None = None,
    client_secret: str | None = None,
) -> None:
    """Persist new access + refresh tokens (memory or accounts.a2a_spoke_clients)."""
    now = time.time()
    access_exp = now + access_ttl_s
    refresh_exp = now + refresh_ttl_s
    cid, secret = _credentials_for(a2a_server_name)
    if client_id:
        cid = client_id
    if client_secret:
        secret = client_secret

    if not _use_db():
        _seed_memory()
        row = _MEMORY.get(a2a_server_name)
        if not row:
            row = SpokeClientRow(
                a2a_server_name=a2a_server_name,
                client_id=cid or a2a_server_name,
                client_secret=secret or "",
            )
            _MEMORY[a2a_server_name] = row
        row.access_token = access_token
        row.refresh_token = refresh_token
        row.access_expires_at = access_exp
        row.refresh_expires_at = refresh_exp
        _log.info("A2A tokens saved in-memory for %s", a2a_server_name)
        return

    try:
        conn = await _connect()
    except Exception as exc:  # noqa: BLE001
        _log.error("save_tokens DB connect failed: %s — using memory", exc)
        _seed_memory()
        row = _MEMORY.setdefault(
            a2a_server_name,
            SpokeClientRow(
                a2a_server_name=a2a_server_name,
                client_id=cid or a2a_server_name,
                client_secret=secret or "",
            ),
        )
        row.access_token = access_token
        row.refresh_token = refresh_token
        row.access_expires_at = access_exp
        row.refresh_expires_at = refresh_exp
        return

    async def _write_tokens_db() -> None:
        await conn.execute(
            """
            INSERT INTO accounts.a2a_spoke_clients (
              a2a_server_name, client_id, client_secret, created_at, updated_at
            ) VALUES ($1, $2, $3, NOW(), NOW())
            ON CONFLICT (a2a_server_name) DO NOTHING
            """,
            a2a_server_name,
            cid or a2a_server_name,
            secret or "",
        )
        result = await conn.execute(
            """
            UPDATE accounts.a2a_spoke_clients
            SET access_token = $2,
                refresh_token = $3,
                access_expires_at = to_timestamp($4),
                refresh_expires_at = to_timestamp($5),
                updated_at = NOW()
            WHERE a2a_server_name = $1
            """,
            a2a_server_name,
            access_token,
            refresh_token,
            access_exp,
            refresh_exp,
        )
        if str(result).endswith("0"):
            await conn.execute(
                """
                INSERT INTO accounts.a2a_spoke_clients (
                  a2a_server_name, client_id, client_secret,
                  access_token, refresh_token,
                  access_expires_at, refresh_expires_at,
                  created_at, updated_at
                ) VALUES (
                  $1, $2, $3, $4, $5, to_timestamp($6), to_timestamp($7), NOW(), NOW()
                )
                ON CONFLICT (client_id) DO UPDATE
                SET a2a_server_name = EXCLUDED.a2a_server_name,
                    access_token = EXCLUDED.access_token,
                    refresh_token = EXCLUDED.refresh_token,
                    access_expires_at = EXCLUDED.access_expires_at,
                    refresh_expires_at = EXCLUDED.refresh_expires_at,
                    updated_at = NOW()
                """,
                a2a_server_name,
                cid or a2a_server_name,
                secret or "",
                access_token,
                refresh_token,
                access_exp,
                refresh_exp,
            )

    async def _write_tokens_plain() -> None:
        await _ensure_spoke_row_plain(
            conn,
            a2a_server_name,
            cid or a2a_server_name,
            secret or "",
        )
        result = await conn.execute(
            """
            UPDATE accounts.a2a_spoke_clients
            SET access_token = $2,
                refresh_token = $3,
                access_expires_at = to_timestamp($4),
                refresh_expires_at = to_timestamp($5),
                updated_at = NOW()
            WHERE a2a_server_name = $1
            """,
            a2a_server_name,
            access_token,
            refresh_token,
            access_exp,
            refresh_exp,
        )
        if str(result).endswith("0"):
            await conn.execute(
                """
                UPDATE accounts.a2a_spoke_clients
                SET access_token = $3,
                    refresh_token = $4,
                    access_expires_at = to_timestamp($5),
                    refresh_expires_at = to_timestamp($6),
                    updated_at = NOW()
                WHERE client_id = $2
                """,
                a2a_server_name,
                cid or a2a_server_name,
                access_token,
                refresh_token,
                access_exp,
                refresh_exp,
            )

    try:
        try:
            await _write_tokens_db()
            _log.info("A2A tokens saved to DB for %s", a2a_server_name)
        except Exception as exc:  # noqa: BLE001
            if not _on_conflict_unsupported(exc):
                raise
            _log.warning(
                "save_tokens: DB has no ON CONFLICT target — using UPDATE/INSERT fallback"
            )
            await _write_tokens_plain()
            _log.info("A2A tokens saved to DB (plain) for %s", a2a_server_name)
    except Exception as exc:  # noqa: BLE001
        _log.error("save_tokens DB write failed: %s — using memory", exc)
        _seed_memory()
        row = _MEMORY.setdefault(
            a2a_server_name,
            SpokeClientRow(
                a2a_server_name=a2a_server_name,
                client_id=cid or a2a_server_name,
                client_secret=secret or "",
            ),
        )
        row.access_token = access_token
        row.refresh_token = refresh_token
        row.access_expires_at = access_exp
        row.refresh_expires_at = refresh_exp
    finally:
        await conn.close()


def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def access_token_valid(row: SpokeClientRow | None, *, skew_s: int = 60) -> bool:
    if not row or not row.access_token:
        return False
    if row.access_expires_at is None:
        return True
    return time.time() < (row.access_expires_at - skew_s)
