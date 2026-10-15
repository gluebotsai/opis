#!/usr/bin/env python3
"""Read-only Postgres inspect: schemas, tenant/cdp keys, product tables.

Loads pg_host, pg_port, pg_user, pg_pass, pg_db from .env in the project root.
Prints structure only — no passwords, no PII columns dumped as rows.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"

EXPECTED = ("pg_host", "pg_port", "pg_user", "pg_pass", "pg_db")
PRODUCT_SCHEMAS = (
    "accounts",
    "cdp",
    "ccass",
    "ticketing",
    "crm",
    "campaign",
    "inventory",
    "web_tracking",
)


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file() or path.stat().st_size == 0:
        return out
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip("'").strip('"')
        out[key] = val
        out[key.lower()] = val
        out[key.upper()] = val
    return out


def connect(env: dict[str, str]):
    try:
        import psycopg2
    except ImportError:
        print("Install psycopg2-binary: pip install psycopg2-binary", file=sys.stderr)
        sys.exit(1)

    missing = [k for k in EXPECTED if not env.get(k) and not env.get(k.upper())]
    if missing:
        print(
            f"{ENV_PATH} is missing or empty. Add: {', '.join(EXPECTED)}",
            file=sys.stderr,
        )
        sys.exit(2)

    def g(name: str) -> str:
        return env.get(name) or env.get(name.upper()) or env.get(name.lower()) or ""

    return psycopg2.connect(
        host=g("pg_host"),
        port=int(g("pg_port") or "5432"),
        user=g("pg_user"),
        password=g("pg_pass"),
        dbname=g("pg_db"),
        connect_timeout=15,
    )


def q(cur, sql: str, params=None) -> list[tuple]:
    cur.execute(sql, params)
    return list(cur.fetchall())


def main() -> None:
    env = load_env(ENV_PATH)
    conn = connect(env)
    conn.set_session(readonly=True, autocommit=True)
    cur = conn.cursor()
    print(f"connected db={env.get('pg_db') or env.get('PG_DB')} (user/host omitted)")

    schemas = [
        r[0]
        for r in q(
            cur,
            """
            SELECT schema_name FROM information_schema.schemata
            WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
            ORDER BY 1
            """,
        )
    ]
    print("\n== schemas ==")
    for s in schemas:
        mark = "  [expected]" if s in PRODUCT_SCHEMAS else ""
        print(f"  {s}{mark}")
    missing = [s for s in PRODUCT_SCHEMAS if s not in schemas]
    if missing:
        print("expected but absent:", ", ".join(missing))

    print("\n== table counts ==")
    for s in schemas:
        n = q(
            cur,
            """
            SELECT count(*) FROM information_schema.tables
            WHERE table_schema = %s AND table_type = 'BASE TABLE'
            """,
            (s,),
        )[0][0]
        print(f"  {s}: {n} tables")

    print("\n== accounts.organizations columns ==")
    try:
        cols = q(
            cur,
            """
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = 'accounts' AND table_name = 'organizations'
            ORDER BY ordinal_position
            """,
        )
        for name, typ in cols:
            print(f"  {name}: {typ}")
        orgs = q(cur, "SELECT count(*) FROM accounts.organizations")[0][0]
        print(f"  row_count={orgs}")
    except Exception as exc:
        print("  ERROR", type(exc).__name__, str(exc).split("\n")[0])
        conn.rollback()

    print("\n== accounts.setup_users columns (names only) ==")
    try:
        cols = q(
            cur,
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'accounts' AND table_name = 'setup_users'
            ORDER BY ordinal_position
            """,
        )
        print(" ", ", ".join(c[0] for c in cols) or "(missing)")
    except Exception as exc:
        print("  ERROR", type(exc).__name__)

    print("\n== cdp tables ==")
    try:
        tables = q(
            cur,
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'cdp' AND table_type = 'BASE TABLE'
            ORDER BY 1
            """,
        )
        print(" ", ", ".join(t[0] for t in tables) or "(no cdp schema)")
    except Exception as exc:
        print("  ERROR", type(exc).__name__)

    print("\n== cdp.identity_keys.source_system distinct ==")
    try:
        vals = q(
            cur,
            """
            SELECT source_system, count(*) 
            FROM cdp.identity_keys
            GROUP BY 1 ORDER BY 2 DESC
            LIMIT 30
            """,
        )
        for v, n in vals:
            print(f"  {v!r}: {n}")
    except Exception as exc:
        print("  ERROR", type(exc).__name__, str(exc).split("\n")[0])

    print("\n== organization_id / cdp_id usage (column present?) ==")
    rows = q(
        cur,
        """
        SELECT table_schema, table_name,
               bool_or(column_name = 'organization_id') AS has_org,
               bool_or(column_name IN ('cdp_id', 'customer_id', 'contact_id')) AS has_party
        FROM information_schema.columns
        WHERE table_schema = ANY(%s)
        GROUP BY 1, 2
        ORDER BY 1, 2
        """,
        (list(PRODUCT_SCHEMAS),),
    )
    for sch, tbl, has_org, has_party in rows:
        flags = []
        if has_org:
            flags.append("organization_id")
        if has_party:
            flags.append("party_key")
        print(f"  {sch}.{tbl}: {', '.join(flags) or 'neither'}")

    cur.close()
    conn.close()
    print("\ndone (read-only)")


if __name__ == "__main__":
    main()
