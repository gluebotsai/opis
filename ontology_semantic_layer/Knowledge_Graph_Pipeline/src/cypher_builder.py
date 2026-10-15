"""Cypher generation.  Spec section 7.

Pure functions.  No I/O, no driver, no config file reads -- everything arrives as
a TableMapping.  This is what makes ``dry-run`` and the unit tests work with no
database at all.

Generated once per (database, table) at startup and cached.  Never inside the
event loop.

TWO INVARIANTS THAT MUST NOT BE RELAXED
---------------------------------------
1. MERGE uses the CORE label and CORE key only.  ``MERGE (n:Contact:Customer)``
   matches only nodes bearing *both* labels, so it would miss the node core
   created, try to create a duplicate, and hit the uniqueness constraint.  Extra
   labels are applied with ``SET n:Label`` afterwards.

2. Relationship targets are MERGEd, never MATCHed.  A MERGE on the key alone
   creates a *stub* node if the target row has not streamed in yet; when it does,
   the same MERGE finds that stub and fills in its properties.  This is what makes
   arrival order irrelevant.  Do not "fix" it into a MATCH.
"""

from __future__ import annotations

import re

from .config_loader import TableMapping
from .errors import MappingError
from .naming import safe_property_name

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

# "legacy"  -> CALL { WITH n, e ... }   works throughout Neo4j 5.x, deprecated 5.23+
# "scoped"  -> CALL (n, e) { ... }      Neo4j 5.23+ only; required in 6.x
SUBQUERY_SYNTAXES = ("legacy", "scoped")


def _ident(value: str | None, what: str) -> str:
    """Reject anything that is not a bare identifier.

    Labels, relationship types and property keys cannot be parameterised in
    Cypher, so they are interpolated.  Everything interpolated is validated here;
    everything from a data row is parameterised.  That split is the injection
    boundary.
    """
    if value is None or not _IDENT.match(str(value)):
        raise MappingError(
            f"{what} must be a bare identifier matching [A-Za-z_][A-Za-z0-9_]*, "
            f"got {value!r}"
        )
    return str(value)


def _labels_clause(labels: list[str]) -> str:
    return "".join(f":{_ident(l, 'extra label')}" for l in labels)


# --------------------------------------------------------------------------
# mode: node
# --------------------------------------------------------------------------

def resolve_target(label: str, table: str, cfg: dict) -> str:
    """create | match | defer | skip"""
    if not cfg:
        return "create"
    owner = cfg.get("node_ownership", {}).get(label, {}).get("owner")
    owners = owner if isinstance(owner, list) else [owner]
    if table in owners:
        return "create"                      # the owning table
    if label in cfg.get("create_target_allowed", []):
        return "create"                      # bounded dimension stub
    return cfg.get("edge_policy", {}).get(table, {}).get("on_missing", cfg.get("default_on_missing", "skip"))

def build_node_upsert(m: TableMapping, subquery_syntax: str = "legacy") -> str:
    if m.mode != "node":
        raise MappingError(f"{m.table}: build_node_upsert called on mode {m.mode!r}")
    if subquery_syntax not in SUBQUERY_SYNTAXES:
        raise MappingError(f"unknown subquery_syntax {subquery_syntax!r}")

    label = _ident(m.label, "label")
    key = _ident(m.key, "key property")

    lines = [
        "UNWIND $batch AS e",
        f"MERGE (n:{label} {{{key}: e.key}})",
        f"  ON CREATE SET n._owner = '{m.table}', n._source_version = coalesce(e.ts, 0)",
        "WITH n, e WHERE coalesce(e.ts, 0) >= coalesce(n._source_version, 0)",
        "SET n += e.props, n._source_version = coalesce(e.ts, 0), n._deleted_at = null",
    ]
    if m.extra_labels:
        lines.append(f"SET n{_labels_clause(m.extra_labels)}")
        
    lines.append("WITH n, e")
    
    gi = getattr(m, 'graph_integrity', {})
    if gi and "exclusive_label_groups" in gi:
        exclusive = gi["exclusive_label_groups"].get(m.table)
        if exclusive:
            group = exclusive.get("group", [])
            if group:
                lines.append(f"REMOVE n:{', n:'.join(group)}")
    
    # E1: Dynamic Labels (Native Cypher)
    if getattr(m, 'conditional_labels', None):
        for cl in m.conditional_labels:
            lbl = cl['label']
            lines.append(f"FOREACH (_ IN CASE WHEN e.dynamic_labels IS NOT NULL AND '{lbl}' IN e.dynamic_labels THEN [1] ELSE [] END | SET n:`{lbl}`)")
    
    # E2: Promoted Properties (Native Cypher)
    if getattr(m, 'promote_property_to_node', None):
        for p_col, p_spec in m.promote_property_to_node.items():
            plbl = p_spec['label']
            pkey = p_spec.get('key', 'id')
            pname = p_spec.get('name_prop', 'name')
            pedge = p_spec['edge']
            lines.append(f"FOREACH (promo IN [x IN coalesce(e.promotions, []) WHERE x.label = '{plbl}' AND x.edge = '{pedge}'] |")
            lines.append(f"  MERGE (target:`{plbl}` {{`{pkey}`: promo.key_val}})")
            lines.append(f"  SET target.`{pname}` = promo.name_val")
            lines.append(f"  MERGE (n)-[:`{pedge}`]->(target)")
            lines.append(")")
            
    # E3: Conditional Relationships (Native Cypher)
    if getattr(m, 'conditional_relationships', None):
        for cr in m.conditional_relationships:
            tlbl = cr.get('target_label') or cr.get('to')
            tkey = cr.get('target_key') or cr.get('to_key')
            ttype = cr['type']
            tdir = "out" if "to" in cr else cr.get('direction', 'out')
            arrow_l, arrow_r = ("-", "->") if tdir == "out" else ("<-", "-")
            lines.append(f"FOREACH (dyn IN [x IN coalesce(e.dynamic_relationships, []) WHERE x.target_label = '{tlbl}' AND x.type = '{ttype}'] |")
            lines.append(f"  MERGE (target:`{tlbl}` {{`{tkey}`: dyn.target_val}})")
            lines.append(f"  MERGE (n){arrow_l}[:`{ttype}`]{arrow_r}(target)")
            lines.append(")")
            

    
    if getattr(m, 'sublabels', None):
        col = m.sublabels.get('column')
        mapping = m.sublabels.get('mapping', {})
        if col and mapping:
            for val, lbl in mapping.items():
                lines.append(f"FOREACH (_ IN CASE WHEN e.props.`{col}` = '{val}' THEN [1] ELSE [] END | SET n:`{lbl}`)")


    if getattr(m, 'collection', None):
        col_name = _ident(m.collection["name"], "collection name")
        owner_col = _ident(m.collection["owner_column"], "owner column")
        bucket_col = m.collection.get("bucket_column")
        
        # Guard against null owner
        if subquery_syntax == "legacy":
            lines.append(f"CALL {{ WITH n, e WITH n, e WHERE e.props.`{owner_col}` IS NOT NULL")
        else:
            lines.append(f"CALL (n, e) {{ WITH n, e WHERE e.props.`{owner_col}` IS NOT NULL")
            
        lines.append(f"  MERGE (col:`{col_name}` {{`{owner_col}`: e.props.`{owner_col}`}})")
        
        owner_label = m.collection.get("owner_label")
        owner_key = m.collection.get("owner_key")
        owner_edge = m.collection.get("owner_edge")
        if owner_label and owner_key and owner_edge:
            lines.append(f"  MERGE (owner:`{owner_label}` {{`{owner_key}`: e.props.`{owner_col}`}})")
            lines.append(f"  MERGE (owner)-[:`{owner_edge}`]->(col)")
            
        if bucket_col:
            lines.append(f"  WITH n, e, col, substring(toString(e.props.`{bucket_col}`), 0, 7) AS _mo")
            lines.append(f"  MERGE (lp:LogPeriod {{uid: toString(e.props.`{owner_col}`) + ':' + coalesce(_mo, 'unknown')}})")
            lines.append("    ON CREATE SET lp.period = _mo")
            lines.append("  MERGE (col)-[:HAS_PERIOD]->(lp)")
            lines.append("  MERGE (lp)-[:CONTAINS]->(n)")
        else:
            lines.append("  MERGE (col)-[:CONTAINS]->(n)")
            
        lines.append("}")
        lines.append("WITH n, e")

    if m.relationships:
        lines.append("WITH n, e")
        for i, rel in enumerate(m.relationships):
            tlabel = _ident(rel.target_label, "target_label")
            tkey = _ident(rel.target_key, "target_key") if not getattr(rel, 'match_fields', None) else ""
            rtype = _ident(rel.type, "relationship type")
            var = f"t{i}"
            pkey = rel.payload_key
            arrow_l, arrow_r = ("-", "->") if rel.direction == "out" else ("<-", "-")

            if getattr(rel, 'is_list', False):
                item_var = "list_item"
            else:
                item_var = f"e.{pkey}"

            if getattr(rel, 'match_fields', None):
                null_checks = " AND ".join(f"e.props.`{v}` IS NOT NULL" for v in rel.match_fields.values())
                if subquery_syntax == "legacy":
                    head = ["CALL {", "  WITH n, e", f"  WITH n, e WHERE {null_checks}"]
                else:
                    head = ["CALL (n, e) {", f"  WITH n, e WHERE {null_checks}"]
                
                match_props = ", ".join(f"`{k}`: e.props.`{v}`" for k, v in rel.match_fields.items())
                lines.extend(head)
                if getattr(rel, 'create_target', False):
                    lines.append(f"  MERGE ({var}:{tlabel} {{{match_props}}})")
                else:
                    lines.append(f"  MATCH ({var}:{tlabel} {{{match_props}}})")
                lines.append(f"  MERGE (n){arrow_l}[:{rtype}]{arrow_r}({var})")
                lines.append("}")
                continue

            if subquery_syntax == "legacy":
                head = ["CALL {", "  WITH n, e", f"  WITH n, e WHERE e.{pkey} IS NOT NULL AND size(e.{pkey}) > 0" if getattr(rel, 'is_list', False) else f"  WITH n, e WHERE e.{pkey} IS NOT NULL"]
            else:
                head = ["CALL (n, e) {", f"  WITH n, e WHERE e.{pkey} IS NOT NULL AND size(e.{pkey}) > 0" if getattr(rel, 'is_list', False) else f"  WITH n, e WHERE e.{pkey} IS NOT NULL"]

            if getattr(rel, 'is_list', False):
                head.append(f"  UNWIND e.{pkey} AS list_item")

            if getattr(rel, 'coerce_to_int', False):
                if not getattr(rel, 'is_list', False):
                    head[-1] += f" AND {item_var} =~ '^\\\\d+$'"
                else:
                    head.append(f"  WITH n, e, {item_var} WHERE {item_var} =~ '^\\\\d+$'")
                val_expr = f"toInteger({item_var})"
            else:
                val_expr = item_var

            lines.extend(head)
            if getattr(rel, 'create_target', False):
                lines.append(f"  MERGE ({var}:{tlabel} {{{tkey}: {val_expr}}})")
            else:
                lines.append(f"  MATCH ({var}:{tlabel} {{{tkey}: {val_expr}}})")
            lines.append(f"  MERGE (n){arrow_l}[:{rtype}]{arrow_r}({var})")
            lines.append("}")

    lines.append('RETURN count(*) AS _processed')
    return "\n".join(lines)


def build_node_delete(m: TableMapping) -> str:
    if m.mode != "node":
        raise MappingError(f"{m.table}: build_node_delete called on mode {m.mode!r}")
    label = _ident(m.label, "label")
    key = _ident(m.key, "key property")
    if m.on_delete == "soft":
        return (
            "UNWIND $batch AS e\n"
            f"MATCH (n:{label} {{{key}: e.key}})\n"
            "SET n.deleted_at = e.ts"
        )
    return (
        "UNWIND $batch AS e\n"
        f"MATCH (n:{label} {{{key}: e.key}})\n"
        "DETACH DELETE n"
    )


# --------------------------------------------------------------------------
# mode: relationship_only
# --------------------------------------------------------------------------

def build_relationship_upsert(m: TableMapping) -> str:
    if m.mode != "relationship_only":
        raise MappingError(f"{m.table}: build_relationship_upsert called on mode {m.mode!r}")
    fl, fk = _ident(m.from_label, "from_label"), _ident(m.from_key, "from_key")
    tl, tk = _ident(m.to_label, "to_label"), _ident(m.to_key, "to_key")
    rtype = _ident(m.type, "relationship type")
    if getattr(m, "on_delete", "detach") == "ignore":
        return "RETURN 1"  # No-op query
        
    gi = getattr(m, 'graph_integrity', {})
    a_action = resolve_target(fl, m.table, gi)
    b_action = resolve_target(tl, m.table, gi)
    
    a_cypher = f"MERGE (a:{fl} {{{fk}: e.from_key}})" if a_action == "create" else f"MATCH (a:{fl} {{{fk}: e.from_key}})"
    b_cypher = f"MERGE (b:{tl} {{{tk}: e.to_key}})" if b_action == "create" else f"MATCH (b:{tl} {{{tk}: e.to_key}})"
    
    props_clause = "\n        SET r += e.props" if m.properties else ""
    return (
        "UNWIND $batch AS e\n"
        f"        {a_cypher}\n"
        f"        {b_cypher}\n"
        f"        MERGE (a)-[r:{rtype}]->(b){props_clause}"
    )


def build_relationship_delete(m: TableMapping) -> str:
    if m.mode != "relationship_only":
        raise MappingError(f"{m.table}: build_relationship_delete called on mode {m.mode!r}")
    fl, fk = _ident(m.from_label, "from_label"), _ident(m.from_key, "from_key")
    tl, tk = _ident(m.to_label, "to_label"), _ident(m.to_key, "to_key")
    rtype = _ident(m.type, "relationship type")
    if getattr(m, "on_delete", "detach") == "ignore":
        return "RETURN 1"  # No-op query
    return (
        "UNWIND $batch AS e\n"
        f"MATCH (a:{fl} {{{fk}: e.from_key}})-[r:{rtype}]->(b:{tl} {{{tk}: e.to_key}})\n"
        "DELETE r"
    )


# --------------------------------------------------------------------------
# mode: properties_on
# --------------------------------------------------------------------------

def build_properties_on_upsert(m: TableMapping) -> str:
    if m.mode != "properties_on":
        raise MappingError(f"{m.table}: build_properties_on_upsert called on mode {m.mode!r}")
    label = _ident(m.target_label, "target_label")
    key = _ident(m.target_key, "target_key")
    # SET n += merges the map and leaves every unmentioned property untouched.
    # That is what preserves the rest of the node (acceptance test 10).
    return (
        "UNWIND $batch AS e\n"
        f"MERGE (n:{label} {{{key}: e.target_key}})\n"
        "SET n += e.props"
    )


def build_properties_on_remove(m: TableMapping, attr_name: str) -> str:
    """Cypher cannot remove a dynamically named property, so the name is built in
    Python from the sanitised attribute and embedded as a backticked literal.

    Callers group deletes by property name so each generated query is still a batch.
    """
    if m.mode != "properties_on":
        raise MappingError(f"{m.table}: build_properties_on_remove called on mode {m.mode!r}")
    label = _ident(m.target_label, "target_label")
    key = _ident(m.target_key, "target_key")
    safe = safe_property_name(f"{m.prefix or ''}{attr_name}")
    return (
        "UNWIND $batch AS e\n"
        f"MATCH (n:{label} {{{key}: e.target_key}})\n"
        f"REMOVE n.`{safe}`"
    )


# --------------------------------------------------------------------------
# facade
# --------------------------------------------------------------------------

def build_all(m: TableMapping, subquery_syntax: str = "legacy") -> dict[str, str]:
    """Every query a mapping can produce, keyed by operation.  Used by dry-run."""
    if m.raw_cypher:
        return {"raw": m.raw_cypher}
    if m.mode == "node":
        return {
            "upsert": build_node_upsert(m, subquery_syntax),
            "delete": build_node_delete(m),
        }
    if m.mode == "relationship_only":
        return {
            "upsert": build_relationship_upsert(m),
            "delete": build_relationship_delete(m),
        }
    if m.mode == "properties_on":
        return {
            "upsert": build_properties_on_upsert(m),
            "delete": build_properties_on_remove(m, "DYNAMIC"),
        }
    if m.mode in ("lookup_source", "view"):
        return {}
    raise MappingError(f"{m.table}: unknown mode {m.mode!r}")


def build_constraint(label: str, key: str, name: str) -> str:
    """Uniqueness constraint DDL.  Created BEFORE any data is written.

    Without it MERGE is a full label scan whose cost grows with the graph; with it
    the lookup is an index seek whose cost is independent of graph size.  Single
    largest performance factor in the system.
    """
    return (
        f"CREATE CONSTRAINT {_ident(name, 'constraint name')} IF NOT EXISTS "
        f"FOR (n:{_ident(label, 'label')}) REQUIRE n.{_ident(key, 'key')} IS UNIQUE"
    )
