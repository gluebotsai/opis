"""accounts.a2a_spoke_clients access for inbound Hub client validation."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from app.config import get_settings
from app.db import execute, fetch_one

_MEMORY_CLIENTS: dict[str, dict[str, Any]] = {}


def _use_memory() -> bool:
    return bool(os.getenv("PYTEST_CURRENT_TEST"))


def _memory_key(server_name: str, client_id: str) -> str:
    return f"{server_name}:{client_id}"


def seed_memory_client(
    *,
    a2a_server_name: str,
    client_id: str,
    client_secret: str,
) -> None:
    _MEMORY_CLIENTS[_memory_key(a2a_server_name, client_id)] = {
        "a2a_server_name": a2a_server_name,
        "client_id": client_id,
        "client_secret": client_secret,
        "access_token": None,
        "refresh_token": None,
        "access_token_expires_at": None,
    }


def clear_memory_clients() -> None:
    _MEMORY_CLIENTS.clear()


def load_client(a2a_server_name: str, client_id: str) -> dict[str, Any] | None:
    key = _memory_key(a2a_server_name, client_id)
    if key in _MEMORY_CLIENTS:
        return _MEMORY_CLIENTS[key]
    if _use_memory():
        return None
    return fetch_one(
        """
        SELECT *
        FROM accounts.a2a_spoke_clients
        WHERE a2a_server_name = %s AND client_id = %s
        LIMIT 1
        """,
        (a2a_server_name, client_id),
    )


def validate_client_credentials(
    *,
    a2a_server_name: str,
    client_id: str,
    client_secret: str,
) -> dict[str, Any] | None:
    row = load_client(a2a_server_name, client_id)
    if not row:
        settings = get_settings()
        # Dev/test fallback when row not seeded
        expected_id = (settings.a2a_spoke_client_id or "worktual-hub-ticketing").strip()
        expected_secret = (settings.a2a_spoke_client_secret or "").strip()
        if (
            client_id == expected_id
            and expected_secret
            and client_secret == expected_secret
            and a2a_server_name
            == (settings.a2a_server_name or "worktual-ticketing").strip()
        ):
            return {
                "a2a_server_name": a2a_server_name,
                "client_id": client_id,
                "client_secret": client_secret,
            }
        return None
    if str(row.get("client_secret") or "") != client_secret:
        return None
    return row


def persist_tokens(
    *,
    a2a_server_name: str,
    client_id: str,
    access_token: str,
    refresh_token: str,
    expires_at: datetime | None,
) -> None:
    key = _memory_key(a2a_server_name, client_id)
    if _use_memory() or key in _MEMORY_CLIENTS:
        row = _MEMORY_CLIENTS.setdefault(
            key,
            {
                "a2a_server_name": a2a_server_name,
                "client_id": client_id,
                "client_secret": "",
            },
        )
        row["access_token"] = access_token
        row["refresh_token"] = refresh_token
        row["access_token_expires_at"] = expires_at
        return

    attempts: list[tuple[str, tuple[Any, ...]]] = []
    if expires_at is not None:
        attempts.append(
            (
                """
                UPDATE accounts.a2a_spoke_clients
                SET access_token = %s,
                    refresh_token = %s,
                    access_token_expires_at = %s
                WHERE a2a_server_name = %s AND client_id = %s
                """,
                (access_token, refresh_token, expires_at, a2a_server_name, client_id),
            )
        )
    attempts.append(
        (
            """
            UPDATE accounts.a2a_spoke_clients
            SET access_token = %s,
                refresh_token = %s
            WHERE a2a_server_name = %s AND client_id = %s
            """,
            (access_token, refresh_token, a2a_server_name, client_id),
        )
    )
    last_exc: Exception | None = None
    for sql, params in attempts:
        try:
            execute(sql, params)
            return
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
    if last_exc:
        raise last_exc


def validate_refresh_token(
    *,
    a2a_server_name: str,
    client_id: str,
    client_secret: str,
    refresh_token: str,
) -> dict[str, Any] | None:
    row = validate_client_credentials(
        a2a_server_name=a2a_server_name,
        client_id=client_id,
        client_secret=client_secret,
    )
    if not row:
        return None
    stored = str(row.get("refresh_token") or "").strip()
    if not stored or stored != str(refresh_token or "").strip():
        return None
    return row
