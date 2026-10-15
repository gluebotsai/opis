#!/usr/bin/env python3
"""
tenant_resolver.py  —  route rows that have no organization_id
==============================================================
TARGET PATH:  src/tenant_resolver.py
USED BY:      the CDC consumer, before it picks a Neo4j database.

Eleven mapped tables have no organization_id and cannot get one, so the tenant
has to be derived from a parent row. Resolution runs in four layers, cheapest
first:

  1  LRU cache              (parent_table, parent_id) -> org
  2  routing.tenant_index   control-plane table, survives restarts
  3  source SQL             follows the declared chain, then fills 1 and 2
  4  park                   parent has not arrived yet; replay on its arrival

Layer 2 is the important one. It is populated as a SIDE EFFECT of every parent
row that streams through, whether or not a child needs it yet, which is what
makes resolution independent of arrival order for anything already seen. It
lives in the CONTROL-PLANE database, never a tenant one — you cannot store the
answer in the tenant database when finding the tenant is the question.

Deletes: Debezium's `before` image carries the FK, so resolve from that. The
index row must survive until AFTER the delete is applied, then be removed.

Re-parenting: if before/after resolve to different tenants the node has to move
databases. move_required() detects it; ignoring it leaks rows across tenants.
"""

from __future__ import annotations

import logging
from collections import OrderedDict
from dataclasses import dataclass

log = logging.getLogger("tenant_resolver")

TENANT_COL = "organization_id"


class Unresolved(Exception):
    """Parent not known yet. Caller should park, not drop."""
    def __init__(self, table, parent_table, parent_id):
        super().__init__(f"{table}: parent {parent_table}[{parent_id}] not resolvable yet")
        self.table, self.parent_table, self.parent_id = table, parent_table, parent_id


@dataclass(frozen=True)
class Hop:
    column: str
    parent: str
    parent_key: str


class LRU(OrderedDict):
    def __init__(self, cap=50_000):
        super().__init__()
        self.cap = cap

    def put(self, k, v):
        if k in self:
            self.move_to_end(k)
        self[k] = v
        while len(self) > self.cap:
            self.popitem(last=False)

    def take(self, k):
        if k in self:
            self.move_to_end(k)
            return self[k]
        return None


class TenantResolver:
    def __init__(self, mapping: dict, control_conn, source_conn, cache_size=50_000, pg_factory=None):
        self.tables = mapping.get("tables") or {}
        self.control = control_conn          # psycopg2 connection, autocommit
        self.source = source_conn            # psycopg2 connection, read-only is fine
        self.pg_factory = pg_factory
        self.cache = LRU(cache_size)
        self.chains: dict[str, list[Hop]] = {}
        self.global_tables: set[str] = set()
        self._build_chains()
        self.stats = {"cache": 0, "index": 0, "sql": 0, "parked": 0, "direct": 0}

    @property
    def control_conn(self):
        if getattr(self.control, "closed", 1) != 0 and self.pg_factory:
            try:
                self.control = self.pg_factory()
                self.control.autocommit = True
            except Exception as e:
                log.warning("TenantResolver failed to reconnect control connection: %s", e)
        return self.control

    @property
    def source_conn(self):
        if getattr(self.source, "closed", 1) != 0 and self.pg_factory:
            try:
                self.source = self.pg_factory()
            except Exception as e:
                log.warning("TenantResolver failed to reconnect source connection: %s", e)
        return self.source

    # -- config ------------------------------------------------------------
    def needs_resolution(self, table: str) -> bool:
        return table in self.chains

    def _build_chains(self):
        for name, spec in self.tables.items():
            if not isinstance(spec, dict):
                continue
            t = spec.get("tenant") or {}
            if t.get("scope") == "global":
                self.global_tables.add(name)
            elif t.get("via"):
                self.chains[name] = [Hop(h["column"], h["parent"], h.get("parent_key", "id"))
                                     for h in t["via"]]

    def validate(self, tables_without_tenant_col: set[str] | None = None) -> list[str]:
        """Call at startup. A table that needs a chain and has none is a config
        error, not a runtime surprise.

        Pass the authoritative set from information_schema:

            SELECT table_schema||'.'||table_name FROM information_schema.tables t
            WHERE t.table_type='BASE TABLE' AND NOT EXISTS (
              SELECT 1 FROM information_schema.columns c
              WHERE c.table_schema=t.table_schema AND c.table_name=t.table_name
                AND c.column_name='organization_id');

        Without it we fall back to the `properties` list, which under-reports:
        relationship_only tables list edge properties only, so a table that has
        the column but does not declare it looks like a false positive."""
        problems = []
        for name, spec in self.tables.items():
            if not isinstance(spec, dict) or spec.get("mode") == "view":
                continue
            if tables_without_tenant_col is not None:
                if name not in tables_without_tenant_col:
                    continue                  # column exists in Postgres, nothing to do
            else:
                declared = set()
                for p in (spec.get("properties") or []):
                    declared.add(p.get("as") or p.get("from") if isinstance(p, dict) else p)
                if TENANT_COL in declared:
                    continue
            if name in self.chains or name in self.global_tables:
                continue
            if name == "accounts.organizations":
                continue                      # its own id IS the tenant
            problems.append(f"{name}: no {TENANT_COL}, no tenant.via, no global scope")
        for name, hops in self.chains.items():
            for h in hops:
                if h.parent not in self.tables:
                    problems.append(f"{name}: parent {h.parent} is not a mapped table")
        return problems

    # -- writes ------------------------------------------------------------
    def note_parent(self, table: str, row: dict):
        """Call for EVERY row that carries organization_id. Cheap, and it is
        what removes the ordering dependency."""
        org = row.get(TENANT_COL)
        if org is None:
            return
        key = str(row.get("id") if "id" in row else next(iter(row.values())))
        self.cache.put((table, key), org)
        with self.control_conn.cursor() as cur:
            cur.execute(
                "INSERT INTO routing.tenant_index (entity_table, entity_id, organization_id) "
                "VALUES (%s,%s,%s) ON CONFLICT (entity_table, entity_id) "
                "DO UPDATE SET organization_id = EXCLUDED.organization_id, updated_at = now()",
                (table, key, org))

    def forget_parent(self, table: str, entity_id):
        """Call AFTER a parent delete has been applied to the tenant graph."""
        self.cache.pop((table, str(entity_id)), None)
        with self.control_conn.cursor() as cur:
            cur.execute("DELETE FROM routing.tenant_index "
                        "WHERE entity_table=%s AND entity_id=%s", (table, str(entity_id)))

    # -- reads -------------------------------------------------------------
    def resolve(self, table: str, row: dict) -> int:
        if table in self.global_tables:
            raise ValueError(f"{table} is global; fan it out with tenants_for_global()")
        if row.get(TENANT_COL) is not None:
            self.stats["direct"] += 1
            return int(row[TENANT_COL])
        if table == "accounts.organizations":
            return int(row["id"])

        hops = self.chains.get(table)
        if not hops:
            raise ValueError(f"{table} has no organization_id and no tenant.via — fix core.yaml")

        cur_table, cur_row = table, row
        for hop in hops:
            pid = cur_row.get(hop.column)
            if pid is None:
                raise Unresolved(table, hop.parent, None)
            org = self._lookup(hop.parent, pid, hop.parent_key)
            if org is not None:
                return int(org)
            cur_table, cur_row = hop.parent, {hop.parent_key: pid}
        raise Unresolved(table, hops[-1].parent, cur_row.get(hops[-1].parent_key))

    def _lookup(self, parent_table: str, parent_id, parent_key: str):
        key = (parent_table, str(parent_id))

        hit = self.cache.take(key)
        if hit is not None:
            self.stats["cache"] += 1
            return hit

        with self.control_conn.cursor() as cur:
            cur.execute("SELECT organization_id FROM routing.tenant_index "
                        "WHERE entity_table=%s AND entity_id=%s", key)
            row = cur.fetchone()
        if row:
            self.stats["index"] += 1
            self.cache.put(key, row[0])
            return row[0]

        org = self._sql(parent_table, parent_id, parent_key)
        if org is not None:
            self.stats["sql"] += 1
            self.cache.put(key, org)
            with self.control_conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO routing.tenant_index (entity_table, entity_id, organization_id) "
                    "VALUES (%s,%s,%s) ON CONFLICT DO NOTHING", (*key, org))
            return org
        return None

    def _sql(self, parent_table: str, parent_id, parent_key: str):
        """Cold miss. Follows one more hop if the parent is itself parentless."""
        schema, tbl = parent_table.split(".", 1)
        pspec = self.tables.get(parent_table, {})
        pprops = {p.get("as") or p.get("from") if isinstance(p, dict) else p
                  for p in (pspec.get("properties") or [])}
        with self.source_conn.cursor() as cur:
            if TENANT_COL in pprops:
                cur.execute(f'SELECT "{TENANT_COL}" FROM "{schema}"."{tbl}" '
                            f'WHERE "{parent_key}"=%s', (parent_id,))
                r = cur.fetchone()
                return r[0] if r else None
            grand = self.chains.get(parent_table)
            if not grand:
                return None
            g = grand[0]
            cur.execute(f'SELECT "{g.column}" FROM "{schema}"."{tbl}" '
                        f'WHERE "{parent_key}"=%s', (parent_id,))
            r = cur.fetchone()
            return self._lookup(g.parent, r[0], g.parent_key) if r and r[0] is not None else None

    # -- helpers -----------------------------------------------------------
    def move_required(self, table: str, before: dict, after: dict):
        """Returns (old_org, new_org) when a row changed tenant, else None.
        The node must be deleted from the old database and created in the new."""
        try:
            old = self.resolve(table, before) if before else None
            new = self.resolve(table, after) if after else None
        except Unresolved:
            return None
        return (old, new) if old and new and old != new else None

    def tenants_for_global(self) -> list[int]:
        with self.control_conn.cursor() as cur:
            cur.execute("SELECT DISTINCT organization_id FROM routing.tenant_index "
                        "WHERE entity_table = 'accounts.organizations'")
            return [r[0] for r in cur.fetchall()]

    def load_order(self) -> list[str]:
        """Backfill order: parents before children. Feed this to the seeder."""
        order, seen = [], set()

        def visit(t, stack=()):
            if t in seen:
                return
            if t in stack:
                raise ValueError(f"tenant.via cycle: {' -> '.join(stack + (t,))}")
            for h in self.chains.get(t, []):
                visit(h.parent, stack + (t,))
            seen.add(t)
            order.append(t)

        for t in self.tables:
            visit(t)
        return order

    def park(self, child_table: str, parent_table: str, parent_id: str, payload: dict):
        """Park a row that arrived before its parent."""
        import json
        with self.control_conn.cursor() as cur:
            cur.execute("""
                INSERT INTO routing.pending_rows 
                (child_table, parent_table, parent_id, payload)
                VALUES (%s, %s, %s, %s)
            """, (child_table, parent_table, str(parent_id), json.dumps(payload)))
        self.stats["parked"] += 1

    def sweep_parked(self, max_age_hours: int, dead_letter_callback):
        """Find parked rows older than max_age_hours, dead-letter them, and remove them."""
        with self.control_conn.cursor() as cur:
            cur.execute("""
                SELECT id, child_table, payload, first_seen_at
                FROM routing.pending_rows
                WHERE first_seen_at < now() - interval '%s hours'
            """, (max_age_hours,))
            rows = cur.fetchall()
            if not rows:
                return 0
            
            for row_id, child_table, payload, first_seen_at in rows:
                dead_letter_callback(child_table, payload, f"Parked row expired after {max_age_hours} hours")
            
            cur.execute("""
                DELETE FROM routing.pending_rows
                WHERE id = ANY(%s)
            """, ([r[0] for r in rows],))
            return len(rows)

    def fetch_parked(self, parent_table: str, parent_id: str) -> list[dict]:
        """Fetch all parked rows waiting on this parent and remove them from the queue."""
        with self.control_conn.cursor() as cur:
            cur.execute("""
                DELETE FROM routing.pending_rows
                WHERE parent_table = %s AND parent_id = %s
                RETURNING child_table, payload
            """, (parent_table, str(parent_id)))
            return [{"child_table": r[0], "payload": r[1]} for r in cur.fetchall()]
