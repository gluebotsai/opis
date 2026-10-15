"""Routing.  Spec sections 8.2 and 8.3.

THE ROUTER IS A SECURITY BOUNDARY.  A misroute writes one organisation's data
into another's graph -- the exact failure this whole architecture exists to
prevent.  Therefore it is fail-closed without exception:

    unknown tenant_id          -> quarantine   (never guess, never default)
    missing tenant_id          -> quarantine
    organisation inactive      -> quarantine
    organisation unprovisioned -> quarantine   (replayable after provisioning)
    unknown table              -> quarantine
    unpurchased product        -> skip         (a business rule, not an error)

No I/O beyond registry and mapping lookups, which keeps the whole thing unit
testable with plain dicts.
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from .coercion import (
    coerce_debezium_row,
    extract_custom,
    extract_field_schemas,
    strip_nulls,
)
from .config_loader import TableMapping
from .derived_lookup import DerivedLookupCache, LookupSpec, parse_lookup_spec
from .naming import safe_property_name
from .errors import CoercionError
from .tenant_resolver import Unresolved

log = logging.getLogger(__name__)

UPSERT_OPS = ("c", "u", "r")          # create, update, snapshot-read
DELETE_OP = "d"


@dataclass
class RoutedEvent:
    database: str
    instance: str
    table: str
    op: str                            # "upsert" | "delete"
    mode: str
    row: dict[str, Any]                # the payload handed to Cypher
    collapse_key: tuple                # spec correction #5 -- per-mode, see below
    attr_name: str | None = None       # properties_on only, for delete grouping
    topic: str = ""
    partition: int | None = None
    offset: int | None = None
    companion: "RoutedEvent | None" = None
    # A second event that must be buffered alongside this one. Used only by
    # properties_on when an UPDATE renames attr_name: the new name is upserted
    # and the OLD name must be removed, or it is orphaned on the node forever.
    # The companion carries no offset -- the primary event owns the watermark
    # for this Kafka record, and double-counting would stall it.

    @property
    def buffer_key(self) -> tuple[str, str]:
        """Buffer is keyed by (database, table) -- NOT (database, table, op).

        The spec keyed it by operation too, but that splits the same business key
        across two buffers and destroys per-key ordering: a delete-then-reinsert
        inside one flush window would apply the upsert first and the delete second,
        losing the row. Collapsing across operations first, then applying the
        buckets in the fixed order upsert -> relationship -> delete, is both
        correct and strictly cheaper.
        """
        return (self.database, self.table)


@dataclass
class Quarantined:
    reason: str
    detail: str = ""


@dataclass
class Parked:
    parent_table: str
    parent_id: str
    reason: str

@dataclass
class Skipped:
    reason: str
    detail: str = ""


@dataclass
class ControlEvent:
    op: str
    before: dict | None
    after: dict | None


def unwrap(message: dict) -> tuple[dict, dict | None]:
    """Split a Debezium message into (payload, value-schema).

    With ``value.converter.schemas.enable=true`` the message is
    ``{"schema": ..., "payload": ...}``.  Without it the payload is bare and the
    schema is None, which degrades coercion to pass-through.
    """
    if isinstance(message, dict) and "payload" in message and "schema" in message:
        return message.get("payload") or {}, message.get("schema")
    return message or {}, None



def _sanitize_for_neo4j(v: Any) -> Any:
    """Failsafe for complex types: Neo4j cannot store Maps/Dicts or complex arrays."""
    if isinstance(v, dict) or (isinstance(v, list) and any(isinstance(x, (dict, list)) for x in v)):
        import json
        try:
            # default=str acts as a safety net for non-serializable objects like UUIDs/Datetimes
            return json.dumps(v, default=str)
        except Exception:
            # Ultimate failsafe: force convert to a raw string if JSON parsing completely fails
            return str(v)
    return v


def _evaluate_when(when_clause: dict, row: dict) -> bool:
    if not when_clause:
        return True
    for k, expected in when_clause.items():
        val = row.get(k)
        if isinstance(expected, list):
            if val not in expected: return False
        elif expected == "not_null":
            if val is None: return False
        elif expected == "is_null":
            if val is not None: return False
    return True

PARTITION_SUFFIX_RE = re.compile(
    r"_(?:[0-9]{4}_[0-9]{2}(?:_[0-9]{2})?|[0-9]{6,8}|default|other|p[0-9]+(?:_[0-9]+)*|part(?:ition)?[0-9_]*|w[0-9]{1,2})$",
    re.IGNORECASE,
)


class Router:
    def __init__(self, loader, registry, topic_prefix: str, control_table: str,
                 metrics=None, money_emit_scale: bool = True,
                 tenant_column: str = "tenant_id",
                 tenant_resolver=None,
                 partition_map: dict[str, str] | None = None):
        self.loader = loader
        self.registry = registry
        self.topic_prefix = topic_prefix
        self.control_table = control_table
        self.control_topic = f"{topic_prefix}.{control_table}"
        # The column in BUSINESS tables that identifies the owning tenant.
        # The spec assumed 'tenant_id'. Many schemas discriminate on
        # 'organization_id' instead, collapsing tenant and organisation into one
        # identifier. Configured via control_plane.tenant_column.
        self.tenant_column = tenant_column
        self.metrics = metrics
        self.money_emit_scale = money_emit_scale
        self.tenant_resolver = tenant_resolver
        self.partition_map: dict[str, str] = dict(partition_map or {})
        self._drift_seen: set[tuple[str, str]] = set()
        self.lookup_cache = DerivedLookupCache()

    # -- partition & topic helpers ------------------------------------------

    def load_partition_map_from_postgres(self, conn) -> int:
        """Query pg_inherits to dynamically map child partition tables to parent tables."""
        query = """
            SELECT 
                nmsp_child.nspname  AS child_schema,
                child.relname       AS child_table,
                nmsp_parent.nspname AS parent_schema,
                parent.relname      AS parent_table
            FROM pg_inherits
            JOIN pg_class parent        ON pg_inherits.inhparent = parent.oid
            JOIN pg_class child         ON pg_inherits.inhrelid   = child.oid
            JOIN pg_namespace nmsp_parent ON nmsp_parent.oid  = parent.relnamespace
            JOIN pg_namespace nmsp_child  ON nmsp_child.oid   = child.relnamespace
        """
        count = 0
        try:
            with conn.cursor() as cur:
                cur.execute(query)
                rows = cur.fetchall()
            for c_sch, c_tbl, p_sch, p_tbl in rows:
                child = f"{c_sch}.{c_tbl}"
                parent = f"{p_sch}.{p_tbl}"
                self.partition_map[child] = parent
                count += 1
            log.info("partition map loaded: %d partition-to-parent mapping(s)", len(self.partition_map))
        except Exception as exc:
            log.warning("could not load partition map from postgres: %s", exc)
        return len(self.partition_map)

    def resolve_table(self, raw_table: str, database: str | None = None) -> str:
        """Resolve a potentially partitioned child table name to its canonical parent table."""
        # 1. Exact match in core or effective mapping
        if raw_table in self.loader.core_tables:
            return raw_table
        if database and self.loader.get_mapping(database, raw_table) is not None:
            return raw_table

        # 2. Known partition mapping from pg_inherits
        if raw_table in self.partition_map:
            parent = self.partition_map[raw_table]
            if parent in self.loader.core_tables or (database and self.loader.get_mapping(database, parent) is not None):
                return parent

        # 3. Fallback: regex stripping of partition suffix (e.g. _2026_07, _default)
        schema, dot, bare_table = raw_table.partition(".")
        stripped_bare = PARTITION_SUFFIX_RE.sub("", bare_table)
        if stripped_bare != bare_table:
            candidate = f"{schema}.{stripped_bare}" if dot else stripped_bare
            if candidate in self.loader.core_tables or (database and self.loader.get_mapping(database, candidate) is not None):
                return candidate

        return raw_table

    def table_for(self, topic: str) -> str:
        raw = topic.split(".", 1)[1] if "." in topic else topic
        return self.resolve_table(raw)

    def is_control_topic(self, topic: str) -> bool:
        return self.table_for(topic) == self.control_table

    # -- schema drift -------------------------------------------------------

    def _note_drift(self, table: str, row: dict, m: TableMapping) -> None:
        """Warn once per (table, column) when a payload column has no mapping.

        Ignoring new columns is the RIGHT default -- an explicit property list is
        what keeps junk out of the graph -- but it should be a decision, not an
        accident. Without this the gap between PostgreSQL and the graph widens for
        months unnoticed.
        """
        if m.mode != "node":
            return
        known = {m.key_column, m.custom_field, self.tenant_column}
        known |= {p.name for p in m.properties}
        known |= {p.currency_column for p in m.properties if p.currency_column}
        known |= {r.from_column for r in m.relationships}
        for col in row:
            if col in known or col is None:
                continue
            sig = (table, col)
            if sig in self._drift_seen:
                continue
            self._drift_seen.add(sig)
            log.warning(
                "schema drift: column %s.%s is present in the CDC payload but absent "
                "from the mapping, so it is not written to the graph. Add it to "
                "core.yaml 'properties' if it belongs in the graph.", table, col,
            )
            if self.metrics:
                self.metrics.inc("unmapped_columns_total", table=table, column=col)

    # -- property assembly --------------------------------------------------

    def _node_props(self, row: dict, m: TableMapping) -> dict:
        props: dict[str, Any] = {}
        for p in m.properties:
            if p.name not in row:
                continue                       # absent != null; leave untouched
            v = row[p.name]
            if v is None:
                continue                       # spec 2.4/7.5 -- null DELETES
            
            v = _sanitize_for_neo4j(v)
                
            props[p.name] = v
            if p.type == "decimal":
                # Value is already integer minor units (coercion did the conversion).
                if self.money_emit_scale and p.scale is not None:
                    props[f"{p.name}_scale"] = p.scale
                if p.currency_column:
                    cur = row.get(p.currency_column)
                    if cur is not None:
                        props[f"{p.name}_currency"] = cur
        
        custom = extract_custom(
            row,
            m.custom_field,
            m.custom_properties,
            m.custom_prefix,
            m.custom_dynamic,
            whitelist=m.custom_fields_whitelist or None,
            blocklist=m.custom_fields_blocklist or None,
            stop_dynamic_keys=m.stop_dynamic_keys or None,
            blocklist_action=m.custom_fields_blocklist_action,
        )
        for k, v in custom.items():
            props[k] = _sanitize_for_neo4j(v)
            
        return strip_nulls(props)

    # -- the routing decision -----------------------------------------------

    def route(self, topic: str, message: dict, partition: int | None = None,
              offset: int | None = None, bypass_control: bool = False):
        payload, schema = unwrap(message)
        op = payload.get("op")
        before, after = payload.get("before"), payload.get("after")

        # 1. control topic -- handled by the consumer before any data topic
        if self.is_control_topic(topic) and not bypass_control:
            return ControlEvent(op=op, before=before, after=after)

        # 2. topic -> table
        table = self.table_for(topic)

        if op not in UPSERT_OPS and op != DELETE_OP:
            return Quarantined("unknown_operation", f"op={op!r}")

        raw_row = after if op in UPSERT_OPS else before
        if not raw_row:
            return Quarantined(
                "missing_row_image",
                f"op={op!r} carried no row image. For deletes this usually means "
                "REPLICA IDENTITY is not FULL on this table.",
            )

        # 3. tenant discriminator from the row
        tenant_id = raw_row.get(self.tenant_column)
        if tenant_id is None and table == self.control_table:
            tenant_id = raw_row.get(self.loader.section("control_plane").get("organization_id_column", "id"))
        
        if tenant_id is None:
            # Try FK-based resolution for known child tables that lack organization_id
            if self.tenant_resolver and self.tenant_resolver.needs_resolution(table):
                try:
                    tenant_id = self.tenant_resolver.resolve(table, raw_row)
                except Unresolved as exc:
                    if op in UPSERT_OPS:
                        self.tenant_resolver.park(table, exc.parent_table, exc.parent_id, message)
                        return Parked(exc.parent_table, str(exc.parent_id), f"parent {exc.parent_table}[{exc.parent_id}] not arrived yet")
                    else:
                        return Skipped(
                            "parent_deleted_before_child",
                            f"FK lookup found no parent for {table}; "
                            "parent's DETACH DELETE handles graph cleanup",
                        )
                except Exception as exc:
                    return Quarantined("tenant_resolution_failed", str(exc))

                if tenant_id is None:
                    if op == DELETE_OP:
                        # Parent was already deleted; DETACH DELETE on the parent
                        # node in Neo4j already severed all relationships to the child.
                        # Skip (not quarantine) so we don't flood the quarantine log.
                        return Skipped(
                            "parent_deleted_before_child",
                            f"FK lookup found no parent for {table}; "
                            "parent's DETACH DELETE handles graph cleanup",
                        )
                    return Quarantined(
                        "tenant_resolution_failed",
                        f"FK lookup to parent table failed for table={table}",
                    )
            else:
                return Quarantined(
                    "missing_tenant_id",
                    f"row has no {self.tenant_column}. On a delete this means REPLICA "
                    "IDENTITY is DEFAULT: the before-image carries only primary-key columns.",
                )

        # 4. registry lookup -- never guess, never auto-create from a data event
        org = self.registry.lookup(tenant_id)
        if org is None:
            return Quarantined("unknown_tenant", f"{self.tenant_column}={tenant_id!r}")
        if not org.active:
            return Quarantined("organisation_inactive", f"status={org.status!r}")
        if not org.provisioned:
            return Quarantined(
                "organisation_not_provisioned",
                f"database {org.database} is not provisioned yet; replay after provisioning",
            )

        # 5. mapping lookup
        m = self.loader.get_mapping(org.database, table)
        if m is None:
            resolved = self.resolve_table(table, org.database)
            if resolved != table:
                table = resolved
                m = self.loader.get_mapping(org.database, table)
        if m is None:
            return Quarantined("unknown_table", f"table={table!r} database={org.database}")

        # 6. product entitlement
        if m.product and m.product not in org.products:
            return Skipped("product_not_entitled", f"product={m.product!r} table={table}")

        # 7. build the payload
        props_by_name = {p.name: p for p in m.properties}
        try:
            row = coerce_debezium_row(
                raw_row, extract_field_schemas(schema), props_by_name,
                passthrough={m.custom_field} if m.custom_field else None,
            )
        except CoercionError as exc:
            return Quarantined("coercion_failed", str(exc))

        self._note_drift(table, row, m)
        out_op = "upsert" if op in UPSERT_OPS else "delete"

        if m.mode == "lookup_source":
            self._ingest_lookup_source(table, row, out_op)
            return Skipped("lookup_source", f"table={table} feeds derived lookup cache only")

        try:
            built = self._build(row, m, out_op, payload, org.database)
        except CoercionError as exc:
            return Quarantined("coercion_failed", str(exc))
        if isinstance(built, (Quarantined, Skipped)):
            return built
        event_row, collapse_key, attr_name, out_op = built

        companion = self._rename_companion(m, before, after, op, out_op, org, table,
                                           topic, partition)

        return RoutedEvent(
            companion=companion,
            database=org.database,
            instance=org.instance,
            table=table,
            op=out_op,
            mode=m.mode,
            row=event_row,
            collapse_key=collapse_key,
            attr_name=attr_name,
            topic=topic,
            partition=partition,
            offset=offset,
        )

    def _rename_companion(self, m, before, after, op, out_op, org, table,
                          topic, partition):
        """Remove the OLD property when a properties_on UPDATE renames attr_name.

        Without this, changing a row's attr_name from 'colour' to 'shade' writes
        attr_shade and leaves attr_colour on the node forever -- the graph then
        reports an attribute that no longer exists in PostgreSQL.

        Deliberately carries offset=None: the primary event owns the Kafka
        watermark for this record. Tagging both with the same offset would make
        the buffer release it twice and could advance the watermark past an
        unflushed event.
        """
        if m.mode != "properties_on" or out_op != "upsert":
            return None
        if op not in UPSERT_OPS or not before or not after:
            return None

        old_raw = before.get(m.attr_key_column)
        new_raw = after.get(m.attr_key_column)
        if old_raw is None or old_raw == new_raw:
            return None

        target_key = after.get(m.target_key_column)
        if target_key is None:
            return None

        old_safe = safe_property_name(f"{m.prefix or ''}{old_raw}")
        if old_safe == safe_property_name(f"{m.prefix or ''}{new_raw}"):
            return None                    # both sanitise to the same property

        return RoutedEvent(
            database=org.database, instance=org.instance, table=table,
            op="delete", mode=m.mode,
            row={"target_key": target_key},
            collapse_key=("p", target_key, old_safe),
            attr_name=str(old_raw),
            topic=topic, partition=partition, offset=None,
        )

    # -- per-mode payload ---------------------------------------------------

    def _derived_doc(self, database: str) -> dict[str, Any]:
        try:
            eff = self.loader.effective(database)
            return dict(eff.derived or {})
        except Exception:
            return dict(getattr(self.loader, "core_meta", {}).get("derived") or {})

    def _ingest_lookup_source(self, table: str, row: dict, out_op: str) -> None:
        spec = LookupSpec(
            table=table,
            match_local="id",
            match_remote="id",
            select="cdp_id",
        )
        if out_op == "delete":
            self.lookup_cache.evict(table, row, spec)
        else:
            self.lookup_cache.ingest(table, row, spec)

    def _apply_config_derived(self, row: dict, table: str, database: str) -> None:
        prefix = f"{table}."
        for key, raw in self._derived_doc(database).items():
            if not key.startswith(prefix):
                continue
            col_name = key[len(prefix) :]
            lookup = parse_lookup_spec(raw if isinstance(raw, dict) else {})
            if not lookup:
                continue
            local_val = row.get(lookup.match_local)
            resolved = self.lookup_cache.resolve(lookup, local_val)
            if resolved is not None:
                row[col_name] = resolved

    def _compute_derived(self, row: dict, m: TableMapping, database: str = ""):
        if database:
            self._apply_config_derived(row, m.table, database)
        if m.table == "campaign.sms_channel_settings":
            row["channel"] = "sms"
        elif m.table == "campaign.push_channel_settings":
            import json
            settings = row.get("settings")
            if isinstance(settings, str):
                try: settings = json.loads(settings)
                except Exception: settings = {}
            if isinstance(settings, dict):
                row["channel"] = settings.get("kind")
        elif m.table == "campaign.website_contacts":
            row["visitor_state"] = "anonymous" if row.get("contact_id") is None else "identified"
        elif m.table == "campaign.app_notifications":
            source_key = str(row.get("source_key", ""))
            parts = source_key.split(":")
            row["subject_kind"] = parts[0] if parts else None
            import re
            m_id = re.search(r'(\d+)$', source_key)
            row["subject_id"] = m_id.group(1) if m_id else None

    def _build(self, row: dict, m: TableMapping, out_op: str, payload: dict, database: str = ""):
        """Return (event_row, collapse_key, attr_name, op) or a Quarantined."""
        
        self._compute_derived(row, m, database)
        if not m.emit_to_graph:
            return Skipped("emit_to_graph_false", f"table={m.table} does not emit graph nodes")
        ts = payload.get("ts_ms")
        if ts is None:
            import datetime
            dt = row.get("updated_at") or row.get("created_at")
            if isinstance(dt, datetime.datetime):
                ts = int(dt.timestamp() * 1000)
            elif isinstance(dt, str):
                try:
                    import datetime as _dt
                    ts = int(_dt.datetime.fromisoformat(dt.replace("Z", "+00:00")).timestamp() * 1000)
                except Exception:
                    ts = int(time.time() * 1000)
            else:
                ts = int(time.time() * 1000)

        if m.mode == "node":
            if m.synthesize_key:
                try:
                    # Treat row as a dict; fallback to empty string if a part is null
                    safe_row = {k: (v if v is not None else "") for k, v in row.items()}
                    key = m.synthesize_key.format(**safe_row)
                    row[m.key_column] = key
                except KeyError:
                    return Quarantined("missing_synthesize_parts", f"cannot format {m.synthesize_key}")
            else:
                key = row.get(m.key_column)
            if key is None:
                return Quarantined("missing_key", f"column {m.key_column!r} is null")
            if out_op == "delete":
                return {"key": key, "ts": ts}, ("n", key), None, "delete"
                
            event = {"key": key, "props": self._node_props(row, m), "ts": ts}
            
            # Embed text preparation (deferred to Writer flush)
            if getattr(m, 'embed', None) and out_op == "upsert":
                embed_fields = m.embed.get("fields", [])
                embed_prop = m.embed.get("property", "_embedding")

                text_changed = True
                before_payload = payload.get("before") if isinstance(payload, dict) else None
                if isinstance(before_payload, dict):
                    text_changed = any(
                        str(row.get(f, "")) != str(before_payload.get(f, ""))
                        for f in embed_fields
                    )

                if text_changed:
                    parts = []
                    for f in embed_fields:
                        val = event["props"].get(f) or row.get(f)
                        if val is not None and str(val).strip():
                            parts.append(str(val).strip())
                    if parts:
                        event["_embed_text"] = " | ".join(parts)
                        event["_embed_prop"] = embed_prop
            
            # E1: Conditional Labels
            dyn_labels = []
            for cl in getattr(m, 'conditional_labels', []):
                if _evaluate_when(cl.get("when", {}), row):
                    dyn_labels.append(cl["label"])
            if dyn_labels:
                event["dynamic_labels"] = dyn_labels
                
            # E2: Promote property to node
            promotions = []
            for p_col, p_spec in getattr(m, 'promote_property_to_node', {}).items():
                p_val = row.get(p_col)
                if p_val:
                    promotions.append({
                        "label": p_spec["label"],
                        "key_prop": p_spec.get("key", "id"),
                        "key_val": str(p_val),
                        "name_prop": "name",
                        "name_val": str(row.get(p_spec.get("name_from"))) if p_spec.get("name_from") else str(p_val),
                        "edge": p_spec["edge"]
                    })
            if promotions:
                event["promotions"] = promotions
                
            # E3: Conditional Relationships
            dyn_rels = []
            for cr in getattr(m, 'conditional_relationships', []):
                if _evaluate_when(cr.get("when", {}), row):
                    target_val = row.get(cr["from_column"])
                    if target_val:
                        if cr.get("coerce_to_string"): target_val = str(target_val)
                        tlbl = cr.get("target_label") or cr.get("to")
                        tkey = cr.get("target_key") or cr.get("to_key")
                        tdir = "out" if "to" in cr else cr.get("direction", "out")
                        dyn_rels.append({
                            "type": cr["type"],
                            "direction": tdir,
                            "target_label": tlbl,
                            "target_key": tkey,
                            "target_val": target_val
                        })
            if dyn_rels:
                event["dynamic_relationships"] = dyn_rels
                
            for rel in m.relationships:
                if getattr(rel, 'match_fields', None):
                    # For match_fields, Cypher builder reads directly from e.props
                    pass
                elif getattr(rel, 'resolver', None):
                    import src.resolvers
                    func = getattr(src.resolvers, rel.resolver)
                    event[rel.payload_key] = func(row)
                else:
                    val = row.get(rel.from_column)
                    if val is not None and getattr(rel, 'to_key_template', None):
                        val = rel.to_key_template.format(**{rel.from_column: val})
                        
                    if rel.is_list and isinstance(val, str) and not getattr(rel, 'to_key_template', None):
                        import json
                        try:
                            val = json.loads(val)
                        except Exception:
                            val = []
                    event[rel.payload_key] = val
            return event, ("n", key), None, "upsert"

        if m.mode == "relationship_only":
            from_key = row.get(m.from_column)
            to_key = row.get(m.to_column)
            
            if from_key is not None and getattr(m, 'from_key_template', None):
                from_key = m.from_key_template.format(**{m.from_column: from_key})
            if to_key is not None and getattr(m, 'to_key_template', None):
                to_key = m.to_key_template.format(**{m.to_column: to_key})
                
            if from_key is None or to_key is None:
                return Quarantined(
                    "missing_relationship_endpoint",
                    f"{m.from_column}={from_key!r} {m.to_column}={to_key!r}",
                )
            event_payload = {"from_key": from_key, "to_key": to_key}
            if m.properties:
                event_payload["props"] = self._node_props(row, m)
            return (
                event_payload,
                ("r", from_key, to_key, m.type),
                None,
                out_op,
            )

        if m.mode == "properties_on":
            target_key = row.get(m.target_key_column)
            attr_name = row.get(m.attr_key_column)
            if target_key is None or attr_name is None:
                return Quarantined(
                    "missing_properties_on_key",
                    f"{m.target_key_column}={target_key!r} {m.attr_key_column}={attr_name!r}",
                )
            safe_del = safe_property_name(f"{m.prefix or ''}{attr_name}")
            if out_op == "delete":
                return (
                    {"target_key": target_key},
                    ("p", target_key, safe_del),
                    str(attr_name),
                    "delete",
                )
            value = row.get(m.attr_value_column)
            # The property name MUST be sanitised here as well as in the REMOVE
            # clause. The upsert passes it as a $batch parameter, where any string
            # is legal, but the delete has to embed it literally because Cypher
            # cannot parameterise a property key -- so it runs through
            # safe_property_name. If only one side sanitises, an attr_name like
            # 'risk-score' is WRITTEN as attr_risk-score and DELETED as
            # attr_risk_score: the delete matches nothing and the value survives
            # in the graph forever, silently.
            safe = safe_property_name(f"{m.prefix or ''}{attr_name}")
            props = strip_nulls({safe: value})
            if not props:
                # The attribute's value went null. SET n += {} is a no-op, so this
                # must become a property removal, not a silent nothing.
                return (
                    {"target_key": target_key},
                    ("p", target_key, safe),
                    str(attr_name),
                    "delete",
                )
            return (
                {"target_key": target_key, "props": props},
                ("p", target_key, safe),
                str(attr_name),
                "upsert",
            )

        return Quarantined("unsupported_mode", f"mode={m.mode!r}")
