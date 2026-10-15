"""PostgreSQL preflight.  Spec section 2.5, plus the REPLICA IDENTITY check.

WHY REPLICA IDENTITY IS CHECKED IN CODE
---------------------------------------
The build spec treated ``REPLICA IDENTITY FULL`` as a TOAST optimisation for
"tables with large TOAST-able columns".  It is not optional.  Under the DEFAULT
replica identity, a DELETE's before-image contains ONLY primary-key columns --
so ``tenant_id`` is absent, routing step 3 finds nothing, and EVERY DELETE is
quarantined.  Acceptance test 4 fails on an otherwise correct system.

Three ways to satisfy it, in order of practicality on an existing schema:

  1. REPLICA IDENTITY FULL          zero migration, correct immediately, costs WAL
  2. REPLICA IDENTITY USING INDEX   on an index that includes tenant_id;
                                    worth doing for the top 10-20 write-heavy
                                    tables once WAL volume is measurable
  3. tenant_id in a composite PK    tenant_id lands in the before-image under
                                    DEFAULT with no WAL penalty. Cleanest, and the
                                    right answer for NEW tables; on existing tables
                                    a PK change cascades to every referencing FK.

A prerequisite that is not verified in code is a prerequisite that is wrong
within a quarter, so this runs at startup and fails the process.
"""

from __future__ import annotations

import logging

from .errors import PreflightError

log = logging.getLogger(__name__)

# pg_class.relreplident: d=default, n=nothing, f=full, i=index
ACCEPTABLE_REPLIDENT = {"f", "i"}


def check_wal_settings(conn) -> dict:
    out = {}
    with conn.cursor() as cur:
        for setting in ("wal_level", "max_replication_slots", "max_wal_senders"):
            cur.execute("SELECT current_setting(%s)", (setting,))
            out[setting] = cur.fetchone()[0]

    problems = []
    if out["wal_level"] != "logical":
        problems.append(
            f"wal_level is {out['wal_level']!r}, must be 'logical'. "
            "This requires a full server RESTART, not a reload."
        )
    if int(out["max_replication_slots"]) < 1:
        problems.append("max_replication_slots must be >= 1")
    if int(out["max_wal_senders"]) < 1:
        problems.append("max_wal_senders must be >= 1")
    if problems:
        raise PreflightError("PostgreSQL WAL prerequisites not met:\n  - " + "\n  - ".join(problems))
    return out


def check_replication_role(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT rolreplication OR rolsuper FROM pg_roles WHERE rolname = current_user"
        )
        row = cur.fetchone()
    if not row or not row[0]:
        raise PreflightError(
            "the connecting role lacks the REPLICATION attribute. "
            "GRANT it, or connect as a role that has it."
        )


def check_replica_identity(conn, tables: list[str]) -> list[str]:
    """Return the list of tables whose replica identity would break DELETE routing."""
    bad: list[str] = []
    with conn.cursor() as cur:
        for qualified in tables:
            schema, _, table = qualified.partition(".")
            cur.execute(
                "SELECT c.relreplident FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = %s AND c.relname = %s",
                (schema, table),
            )
            row = cur.fetchone()
            if row is None:
                bad.append(f"{qualified} (table not found)")
            elif row[0] not in ACCEPTABLE_REPLIDENT:
                bad.append(f"{qualified} (relreplident={row[0]!r})")
    return bad


def check_tenant_id_not_null(conn, tables: list[str], tenant_column: str = "tenant_id",
                              resolver_tables: set | None = None) -> list[str]:
    """Check that every tracked table has a non-nullable tenant discriminator column.

    Tables in resolver_tables are excluded from this check because their tenant
    ID is resolved at runtime via FK lookup (see src/tenant_resolver.py).
    """
    bad: list[str] = []
    with conn.cursor() as cur:
        for qualified in tables:
            if resolver_tables and qualified in resolver_tables:
                continue  # handled by TenantResolver via FK lookup -- skip
            schema, _, table = qualified.partition(".")
            cur.execute(
                "SELECT is_nullable FROM information_schema.columns "
                "WHERE table_schema = %s AND table_name = %s AND column_name = %s",
                (schema, table, tenant_column),
            )
            row = cur.fetchone()
            if row is None:
                bad.append(f"{qualified} (no {tenant_column} column)")
            elif row[0] != "NO":
                bad.append(f"{qualified} ({tenant_column} is nullable)")
    return bad


def check_publications_pubviaroot(conn) -> list[str]:
    """Check if any publications have pubviaroot=false, which causes Debezium to emit child partition names."""
    bad: list[str] = []
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT pubname, pubviaroot FROM pg_publication;")
            for pubname, pubviaroot in cur.fetchall():
                if not pubviaroot:
                    bad.append(pubname)
    except Exception as e:
        log.warning("could not check publication pubviaroot: %s", e)
    return bad


def run_all(conn, tables: list[str], tenant_column: str = "tenant_id",
            control_table: str | None = None, strict: bool = True,
            core_doc: dict | None = None) -> dict:
    """Run every preflight check.  Raises PreflightError unless ``strict`` is False."""
    resolver_tables = set()
    if core_doc and "tables" in core_doc:
        for tname, tspec in core_doc["tables"].items():
            if isinstance(tspec, dict):
                t = tspec.get("tenant") or {}
                if t.get("via") or t.get("scope") == "global":
                    resolver_tables.add(tname)

    report: dict = {}
    report["wal"] = check_wal_settings(conn)
    check_replication_role(conn)

    all_tables = list(tables)
    if control_table and control_table not in all_tables:
        all_tables.append(control_table)

    bad_identity = check_replica_identity(conn, all_tables)
    bad_tenant = check_tenant_id_not_null(
        conn, [t for t in tables if t != control_table], tenant_column,
        resolver_tables=resolver_tables)
    bad_pubs = check_publications_pubviaroot(conn)

    report["replica_identity_problems"] = bad_identity
    report["tenant_id_problems"] = bad_tenant
    report["publications_without_pubviaroot"] = bad_pubs

    problems = []
    if bad_identity:
        problems.append(
            "REPLICA IDENTITY is DEFAULT or NOTHING on:\n      "
            + "\n      ".join(bad_identity)
            + "\n    Under DEFAULT, a DELETE's before-image carries only PK columns, so "
              "tenant_id\n    is absent and every delete is quarantined. Fix with:\n"
              "      ALTER TABLE <schema>.<table> REPLICA IDENTITY FULL;"
        )
    if bad_tenant:
        problems.append(
            "tenant_id missing or nullable on:\n      " + "\n      ".join(bad_tenant)
        )

    if problems and strict:
        raise PreflightError("PostgreSQL preflight failed:\n  - " + "\n  - ".join(problems))
    for p in problems:
        log.warning("preflight (non-strict): %s", p)
    return report
