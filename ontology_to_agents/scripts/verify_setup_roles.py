#!/usr/bin/env python3
"""Verify accounts.setup_users ↔ setup_user_product_access ↔ setup_roles (read-only)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from inspect_pg_schemas import connect, load_env  # noqa: E402


def main() -> int:
    env = load_env(ROOT / ".env")
    if not env.get("pg_host"):
        print("SKIP: no .env pg_host")
        return 0
    conn = connect(env)
    with conn.cursor() as cur:
        print("Join path: setup_users.id = setup_user_product_access.user_id")
        print("           setup_user_product_access.role_id = setup_roles.id")
        cur.execute(
            """
            SELECT u.id, u.team_id, p.product_id, r.id, r.name
            FROM accounts.setup_users u
            JOIN accounts.setup_user_product_access p
              ON p.user_id = u.id AND p.organization_id = u.organization_id
            JOIN accounts.setup_roles r
              ON r.id = p.role_id AND r.organization_id = u.organization_id
            WHERE u.organization_id = 1000
            ORDER BY u.id, p.product_id
            LIMIT 15
            """
        )
        for row in cur.fetchall():
            print(" ", row)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
