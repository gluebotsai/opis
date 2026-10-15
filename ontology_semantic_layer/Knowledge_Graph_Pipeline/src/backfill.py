"""Backfill.  Spec section 9.

CDC carries only changes from the moment the replication slot is created, so a
backfill path is mandatory at onboarding and whenever an organisation enables a
new product.

Rows go through THE SAME mapping and THE SAME generated Cypher as the streaming
path.  Only the decoder differs, and it has to: psycopg already produces
``datetime`` and ``Decimal`` where Debezium produces integers and strings.
Sharing the decoder would be wrong; sharing everything downstream is mandatory,
because a second code path is how backfill and stream silently diverge.

Backfill may run while streaming is live -- every write is idempotent.
Ordering caveat: if a row is updated during the backfill, the backfill's older
snapshot can overwrite the newer streamed value. Prefer Debezium's
``snapshot.mode: initial`` for the initial load and use this tool for
newly-enabled products, or pass ``--updated-since`` to bound the window.
"""

from __future__ import annotations

import logging
import time

from .coercion import coerce_native_row
from .errors import CoercionError
from .router import RoutedEvent

log = logging.getLogger(__name__)

DEFAULT_FETCH = 10000


class Backfiller:
    def __init__(self, loader, registry, router, writer, pg_conn_factory, tenant_resolver=None):
        self.loader = loader
        self.registry = registry
        self.router = router
        self.writer = writer
        self.pg_conn_factory = pg_conn_factory
        self.tenant_resolver = tenant_resolver

    def _tables_for(self, org, product: str | None, table: str | None) -> list[str]:
        eff = self.loader.effective(org.database)
        out = []
        for name, m in eff.tables.items():
            if table and name != table:
                continue
            if m.product and m.product not in org.products:
                continue                       # not entitled
            if product and m.product != product:
                continue
            out.append(name)
        return sorted(out)

    def run(self, organization_id: str, product: str | None = None, table: str | None = None,
            resume_from=None, chunk_size: int | None = None) -> dict:
        org = next(
            (o for o in self.registry.all() if o.organization_id == str(organization_id)),
            None,
        )
        if org is None:
            raise ValueError(f"organisation {organization_id!r} is not in the registry")
        if not org.routable():
            raise ValueError(
                f"organisation {organization_id!r} is inactive or unprovisioned; "
                "provision it before backfilling"
            )

        chunk = chunk_size or self.writer.node_batch_size
        tables = self._tables_for(org, product, table)
        if not tables:
            log.warning("no tables to backfill for organisation %s", organization_id)
        stats: dict[str, dict] = {}
        for name in tables:
            stats[name] = self._backfill_table_with_retry(org, name, chunk, resume_from)
        return stats

    def _backfill_table_with_retry(self, org, table: str, chunk: int, resume_from, max_attempts: int = 3) -> dict:
        for attempt in range(1, max_attempts + 1):
            try:
                with self.pg_conn_factory() as conn:
                    result = self._backfill_table(conn, org, table, chunk, resume_from)
                    conn.commit()
                    return result
            except Exception as exc:
                log.warning("Attempt %d/%d backfilling table %s failed: %s", attempt, max_attempts, table, exc)
                if attempt < max_attempts:
                    time.sleep(attempt * 2.0)
                else:
                    log.error("Failed to backfill table %s after %d attempts: %s", table, max_attempts, exc)
                    return {
                        "read": 0, "written": 0, "quarantined": 0,
                        "elapsed_seconds": 0, "last_primary_key": None,
                        "error": str(exc)
                    }

    def _backfill_table(self, conn, org, table: str, chunk: int, resume_from) -> dict:
        m = self.loader.get_mapping(org.database, table)
        started = time.monotonic()
        read = written = quarantined = 0

        pk = self._primary_key_column(m)
        tenant_col = self.router.tenant_column
        
        # Check if the table actually has the tenant column
        has_tenant_col = False
        with conn.cursor() as check_cur:
            schema, tablename = m.table.split('.') if '.' in m.table else ('public', m.table)
            check_cur.execute(
                "SELECT 1 FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name=%s",
                (schema, tablename, tenant_col)
            )
            has_tenant_col = check_cur.fetchone() is not None

        if has_tenant_col:
            where = [f"{tenant_col}::text = %(tenant)s"]
            params = {"tenant": str(org.tenant_id)}
        else:
            where = []
            params = {}

        if resume_from is not None and pk:
            where.append(f"{pk} > %(resume)s")
            params["resume"] = resume_from
            
        order = f" ORDER BY {pk}" if pk else ""
        where_clause = f" WHERE {' AND '.join(where)}" if where else ""
        sql = f"SELECT * FROM {m.table}{where_clause}{order}"


        props_by_name = {p.name: p for p in m.properties}
        last_pk = None

        # Server-side (named) cursor: never fetchall() a large table.
        with conn.cursor(name=f"backfill_{table.replace('.', '_')}") as cur:
            cur.itersize = chunk
            import psycopg
            try:
                cur.execute(sql, params)
            except psycopg.errors.UndefinedTable as exc:
                log.warning("Table %s does not exist in postgres, skipping.", table)
                conn.rollback()
                return {"read": 0, "written": 0, "quarantined": 0, "elapsed_seconds": 0, "last_primary_key": None}
            columns = None
            batch = []
            for record in cur:
                if columns is None:
                    columns = [d.name for d in cur.description]
                raw = dict(zip(columns, record))
                read += 1
                if not has_tenant_col:
                    is_global = m.tenant and m.tenant.get("scope") == "global"
                    if not is_global:
                        resolved_tenant = raw.get(tenant_col)
                        if not resolved_tenant and table == self.router.control_table:
                            resolved_tenant = raw.get(self.loader.section("control_plane").get("organization_id_column", "id"))
                        if not resolved_tenant and self.router.tenant_resolver:
                            resolved_tenant = self.router.tenant_resolver.resolve(table, raw)
                        if str(resolved_tenant) != str(org.tenant_id):
                            continue
                if pk:
                    last_pk = raw.get(pk, last_pk)
                try:
                    row = coerce_native_row(raw, props_by_name)
                    built = self.router._build(row, m, "upsert", {"ts_ms": None})
                except CoercionError as exc:
                    log.error("backfill %s: %s", table, exc)
                    quarantined += 1
                    continue
                if not isinstance(built, tuple):
                    quarantined += 1
                    continue
                event_row, collapse_key, attr_name, op = built
                batch.append(
                    RoutedEvent(
                        database=org.database, instance=org.instance, table=table,
                        op=op, mode=m.mode, row=event_row, collapse_key=collapse_key,
                        attr_name=attr_name, topic="<backfill>",
                    )
                )
                if len(batch) >= chunk:
                    written += self._flush(batch)
                    batch = []
            if batch:
                written += self._flush(batch)

        elapsed = time.monotonic() - started
        log.info(
            "backfill table=%s database=%s read=%d written=%d quarantined=%d "
            "elapsed=%.1fs last_pk=%s",
            table, org.database, read, written, quarantined, elapsed, last_pk,
        )
        return {
            "read": read, "written": written, "quarantined": quarantined,
            "elapsed_seconds": round(elapsed, 2), "last_primary_key": last_pk,
        }

    def _flush(self, batch: list) -> int:
        for e in batch:
            self.writer.add(e)
        return self.writer.flush_all()

    @staticmethod
    def _primary_key_column(m) -> str | None:
        if m.synthesize_key:
            return None
        if m.mode == "node":
            return m.key_column
        if m.mode == "properties_on":
            return m.target_key_column
        if m.mode == "relationship_only":
            return m.from_column
        return None
