#!/usr/bin/env python3
"""Insert Ticketing → Hub A2A client row into accounts.a2a_spoke_clients.

Reads DATABASE_URL + HUB_A2A_* from repo-root .env (and ai-agents/.env).
Run once against the shared MyAccount/Postgres DB:

  python scripts/seed_hub_a2a_client.py
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_AGENTS = _ROOT / "ai-agents"
sys.path.insert(0, str(_AGENTS))

from app.config import get_settings  # noqa: E402
from app.db import execute, fetch_one  # noqa: E402


def main() -> int:
    get_settings.cache_clear()
    settings = get_settings()
    if not (settings.database_url or "").strip():
        print("DATABASE_URL is required", file=sys.stderr)
        return 1
    client_id = (settings.hub_a2a_client_id or "worktual-ticketing-hub").strip()
    secret = (settings.hub_a2a_client_secret or "").strip()
    server = (settings.hub_a2a_server_name or "worktual-hub").strip()
    if not secret or secret.startswith("change-me"):
        print(
            "Set HUB_A2A_CLIENT_SECRET in .env to a real secret before seeding.",
            file=sys.stderr,
        )
        return 1

    existing = fetch_one(
        """
        SELECT client_id, a2a_server_name
        FROM accounts.a2a_spoke_clients
        WHERE a2a_server_name = %s AND client_id = %s
        LIMIT 1
        """,
        (server, client_id),
    )
    if existing:
        execute(
            """
            UPDATE accounts.a2a_spoke_clients
            SET client_secret = %s
            WHERE a2a_server_name = %s AND client_id = %s
            """,
            (secret, server, client_id),
        )
        print(f"Updated client_secret for {client_id!r} on {server!r}")
        return 0

    execute(
        """
        INSERT INTO accounts.a2a_spoke_clients (
          a2a_server_name, client_id, client_secret
        ) VALUES (%s, %s, %s)
        """,
        (server, client_id, secret),
    )
    print(f"Inserted {client_id!r} for {server!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
