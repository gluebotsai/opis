"""Organisation registry.  Spec section 5.

The registry is the gate: no data is written to Neo4j for an organisation that is
not present and active here.  It is loaded from ``accounts.organisations`` at
startup and kept current from that table's own Debezium topic, which is handled
before data topics in every poll cycle.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field

from .errors import ConfigError
from .naming import make_database_name

log = logging.getLogger(__name__)


@dataclass
class Organisation:
    tenant_id: str
    organization_id: str
    database: str
    instance: str
    status: str
    provisioned: bool = False
    products: set[str] = field(default_factory=set)

    @property
    def active(self) -> bool:
        return self._active

    _active: bool = True

    def routable(self) -> bool:
        """Every condition that must hold before a data event may be written."""
        return self._active and self.provisioned


class Registry:
    def __init__(self, prefix: str, control_plane: dict, default_instance: str):
        self.prefix = prefix
        self.cp = control_plane
        self.default_instance = default_instance
        self._by_tenant: dict[str, Organisation] = {}
        self._by_database: dict[str, Organisation] = {}
        self._lock = threading.RLock()

    # -- construction -------------------------------------------------------

    def _active_values(self) -> set[str]:
        return {str(v).lower() for v in self.cp.get("active_status_values", ["active"])}

    def _make(self, tenant_id: str, organization_id: str, status: str,
              instance: str | None = None) -> Organisation:
        org = Organisation(
            tenant_id=str(tenant_id),
            organization_id=str(organization_id),
            database=make_database_name(self.prefix, organization_id),
            instance=instance or self.default_instance,
            status=str(status),
        )
        org._active = str(status).lower() in self._active_values()
        return org

    def load_from_postgres(self, conn) -> int:
        """Populate the registry from ``accounts.organisations``."""
        table = self.cp["organisations_table"]
        org_col = self.cp["organization_id_column"]
        tenant_col = self.cp["tenant_id_column"]
        status_col = self.cp["status_column"]
        instance_col = self.cp.get("instance_column")     # optional

        cols = [tenant_col, org_col, status_col] + ([instance_col] if instance_col else [])
        sql = f"SELECT {', '.join(cols)} FROM {table}"

        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()

        with self._lock:
            self._by_tenant.clear()
            self._by_database.clear()
            for row in rows:
                tenant_id, organization_id, status = row[0], row[1], row[2]
                instance = row[3] if instance_col else None
                if tenant_id is None or organization_id is None:
                    log.warning(
                        "skipping accounts.organisations row with null identity: %r", row
                    )
                    continue
                org = self._make(tenant_id, organization_id, status, instance)
                self._insert(org)
        return len(self._by_tenant)

    def _insert(self, org: Organisation) -> None:
        existing = self._by_tenant.get(org.tenant_id)
        if existing is not None:
            org.provisioned = existing.provisioned
            org.products = existing.products
        clash = self._by_database.get(org.database)
        if clash is not None and clash.tenant_id != org.tenant_id:
            raise ConfigError(
                f"database name collision: tenants {clash.tenant_id!r} and "
                f"{org.tenant_id!r} both map to {org.database!r}. Refusing to start; "
                "two tenants sharing one graph is the failure this design prevents."
            )
        self._by_tenant[org.tenant_id] = org
        self._by_database[org.database] = org

    # -- runtime updates ----------------------------------------------------

    def upsert_from_event(self, op: str, before: dict | None, after: dict | None) -> Organisation | None:
        """Apply one control-topic event.  Spec 5.2."""
        org_col = self.cp["organization_id_column"]
        tenant_col = self.cp["tenant_id_column"]
        status_col = self.cp["status_column"]
        row = after if op in ("c", "u", "r") else before

        if not row:
            log.warning("control event op=%s carried no usable row image", op)
            return None
        tenant_id, organization_id = row.get(tenant_col), row.get(org_col)
        if tenant_id is None or organization_id is None:
            log.error(
                "control event op=%s is missing %s/%s. Is REPLICA IDENTITY FULL set on "
                "accounts.organisations?", op, tenant_col, org_col
            )
            return None

        with self._lock:
            if op == "d":
                # Never drop the Neo4j database automatically. Mark inactive, log,
                # require a human. A dropped tenant graph is unrecoverable.
                existing = self._by_tenant.get(str(tenant_id))
                if existing:
                    existing._active = False
                    existing.status = "deleted"
                log.warning(
                    "organisation %s deleted from control plane; marked INACTIVE. "
                    "Neo4j database %s is retained and requires manual action.",
                    organization_id,
                    existing.database if existing else make_database_name(self.prefix, organization_id),
                )
                return existing

            org = self._make(tenant_id, organization_id, row.get(status_col, ""))
            self._insert(org)
            return self._by_tenant[str(tenant_id)]

    def mark_provisioned(self, tenant_id: str, products: set[str] | None = None) -> None:
        with self._lock:
            org = self._by_tenant.get(str(tenant_id))
            if org:
                org.provisioned = True
                if products is not None:
                    org.products = set(products)

    # -- lookups ------------------------------------------------------------

    def lookup(self, tenant_id) -> Organisation | None:
        if tenant_id is None:
            return None
        with self._lock:
            return self._by_tenant.get(str(tenant_id))

    def by_database(self, database: str) -> Organisation | None:
        with self._lock:
            return self._by_database.get(database)

    def active(self) -> list[Organisation]:
        with self._lock:
            return [o for o in self._by_tenant.values() if o.active]

    def all(self) -> list[Organisation]:
        with self._lock:
            return list(self._by_tenant.values())

    def __len__(self) -> int:
        return len(self._by_tenant)
