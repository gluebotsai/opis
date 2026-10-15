"""Resolve ticketing.agents.id for validators (userId on API = agents.id, not setup_users.id)."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"


def load_dotenv() -> None:
    if not ENV_PATH.is_file():
        return
    for raw in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip("'\""))


def _pg_conn():
    import psycopg2

    load_dotenv()
    return psycopg2.connect(
        host=os.environ["pg_host"],
        port=int(os.environ.get("pg_port", "5432")),
        user=os.environ.get("pg_user", "postgres"),
        password=os.environ.get("pg_pass", ""),
        dbname=os.environ.get("pg_db", "postgres"),
        connect_timeout=15,
    )


def resolve_ticketing_agent_id(
    org: int,
    *,
    role: str | None = None,
    explicit: int | None = None,
) -> int:
    """Return ticketing.agents.id for org. Uses env TICKETING_AGENT_ID / USER_ID or DB lookup."""
    if explicit is not None:
        return int(explicit)
    for key in ("TICKETING_AGENT_ID", "USER_ID"):
        raw = os.environ.get(key)
        if raw:
            return int(raw)
    role_l = (role or "admin").strip().lower()
    conn = _pg_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id
                FROM ticketing.agents
                WHERE organization_id = %s
                  AND lower(role) = %s
                  AND lower(coalesce(status, 'active')) IN ('active', 'enabled', '1', 'true')
                ORDER BY id
                LIMIT 1
                """,
                (org, role_l),
            )
            row = cur.fetchone()
            if row:
                return int(row[0])
            cur.execute(
                """
                SELECT id FROM ticketing.agents
                WHERE organization_id = %s
                ORDER BY id LIMIT 1
                """,
                (org,),
            )
            row = cur.fetchone()
            if row:
                return int(row[0])
    finally:
        conn.close()
    raise RuntimeError(f"No ticketing.agents row for org={org} role={role_l}")


def list_agents_by_role(org: int) -> dict[str, int]:
    """Map role -> first active agents.id for scenario tests."""
    conn = _pg_conn()
    out: dict[str, int] = {}
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT lower(role), id
                FROM ticketing.agents
                WHERE organization_id = %s
                  AND lower(coalesce(status, 'active')) IN ('active', 'enabled', '1', 'true')
                ORDER BY id
                """,
                (org,),
            )
            for role, aid in cur.fetchall():
                if role and role not in out:
                    out[str(role)] = int(aid)
    finally:
        conn.close()
    return out
