"""Read-only Cypher allowlist and contact center product edge fence."""

from __future__ import annotations

import json
import re
from typing import Any

import yaml

from .paths import KG_DIR

_MUTATION = re.compile(
    r"\b(CREATE|MERGE|SET|DELETE|DETACH|REMOVE|DROP|ALTER|TRUNCATE)\b",
    re.IGNORECASE,
)
_DANGEROUS = [
    r"\bLOAD\s+CSV\b",
    r"\bCALL\s+(dbms|apoc)\b",
    r"\bCREATE\s+(INDEX|CONSTRAINT)\b",
]
_HOP = re.compile(
    r"\(([A-Za-z_][A-Za-z0-9_]*)(?::([A-Za-z][A-Za-z0-9_]*))?\)"
    r"\s*-\[\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*)?:(\w+)\s*\]\s*->"
    r"\s*\(([A-Za-z_][A-Za-z0-9_]*)(?::([A-Za-z][A-Za-z0-9_]*))?\)"
)
_BIND = re.compile(r"\(([A-Za-z_][A-Za-z0-9_]*):([A-Za-z][A-Za-z0-9_]*)\)")
_BARE_REL = re.compile(r"-\[\s*\]-|-\[]->")
_UNDIRECTED = re.compile(r"\)\s*--\s*\(")
_VAR_LEN = re.compile(r"\[[^\]]*\*|shortestPath|allShortestPaths", re.IGNORECASE)


def _strip_quoted(cypher: str) -> str:
    return re.sub(r"'[^']*'|\"[^\"]*\"", "''", cypher)


def load_schema() -> tuple[set[str], set[str], set[str]]:
    path = KG_DIR / "schema_registry.json"
    data = json.loads(path.read_text())
    labels = set(data.get("labels") or [])
    rels = set(data.get("relationships") or [])
    raw_props = data.get("properties") or []
    if isinstance(raw_props, dict):
        props = set(p for prop_list in raw_props.values() for p in (prop_list or []))
    elif isinstance(raw_props, list):
        props = set(raw_props)
    else:
        props = set()
    return labels, rels, props


def load_product_edges() -> dict[str, Any]:
    path = KG_DIR / "product_edges.yml"
    data = yaml.safe_load(path.read_text()) or {}
    if data.get("product") != "contact_center":
        raise ValueError("product_edges.yml product must be contact_center")
    pairs = set()
    for row in data.get("edges") or []:
        pairs.add((row["from"], row["rel"], row["to"]))
    return {
        "product": "contact_center",
        "pairs": pairs,
        "start_labels": set(data.get("start_labels") or []),
        "leaf_labels": set(data.get("leaf_labels") or []),
        "forbidden_labels": set(data.get("forbidden_labels") or []),
    }


def assert_read_only_cypher(cypher: str) -> None:
    stripped = _strip_quoted(cypher)
    hit = _MUTATION.search(stripped)
    if hit:
        raise ValueError(f"Write/mutation operations ({hit.group(1).upper()}) are not allowed")
    for pattern in _DANGEROUS:
        match = re.search(pattern, stripped, re.IGNORECASE)
        if match:
            raise ValueError(f"blocked Cypher: {match.group(0)}")
    head = cypher.strip().lower()
    if not (head.startswith("match") or head.startswith("optional match") or head.startswith("with")):
        raise ValueError("Cypher must start with MATCH")


def assert_allowlist(cypher: str, schema: dict[str, Any] | None = None) -> None:
    if schema is None:
        labels, rels, props = load_schema()
    else:
        labels = set(schema.get("labels") or [])
        rels = set(schema.get("relationships") or [])
        raw_props = schema.get("properties") or []
        if isinstance(raw_props, dict):
            props = set(p for prop_list in raw_props.values() for p in (prop_list or []))
        elif isinstance(raw_props, list):
            props = set(raw_props)
        else:
            props = set()

    query_for_labels = re.sub(r"\[[^\]]*\]", "", cypher)
    found_labels = re.findall(r":\s*`?([A-Za-z][A-Za-z0-9_]*)`?", query_for_labels)
    edges_spec = load_product_edges()
    forbidden_labels = set(edges_spec.get("forbidden_labels") or [])

    for label in found_labels:
        if label in forbidden_labels:
            raise ValueError(
                f"label :{label} belongs to another product domain and is forbidden in Contact Center reports. "
                f"Queries must only reference CCaaS entities (Conversation, MissedContact, Transfer, Queue, etc.)."
            )
        if label not in labels:
            raise ValueError(
                f"label :{label} is not in the contact center graph ontology allowlist. "
                f"Please use only registered CCaaS labels from schema_registry.json."
            )

    found_rels = re.findall(
        r"-\[.*?:" r"`?(\w+)`?" r"\]->|<-\[.*?:" r"`?(\w+)`?" r"\]",
        cypher,
    )
    for tup in found_rels:
        for rel in tup:
            if rel and rel not in rels:
                raise ValueError(
                    f"relationship [:{rel}] is not in the contact center graph allowlist. "
                    f"Use certified CCaaS relationships such as ROUTED_TO, HANDLED_BY, HAS, CONTINUES, HAS_SHIFT."
                )

    if not props:
        return
    stripped = _strip_quoted(cypher)
    skip_entities = {"duration", "point", "date", "datetime", "localdatetime", "time", "localtime", "math"}
    skip_props = {
        "year", "month", "day", "hour", "minute", "second", "epochMillis",
        "seconds", "minutes", "hours", "days", "months", "years",
        "milliseconds", "microseconds", "nanoseconds", "between", "distance", "truncate",
    }
    for match in re.finditer(r"\b([A-Za-z][A-Za-z0-9_]*)\.([A-Za-z][A-Za-z0-9_]*)\b", stripped):
        entity = match.group(1)
        prop = match.group(2)
        if entity in skip_entities or prop in skip_props:
            continue
        if prop not in props:
            raise ValueError(
                f"property .{prop} is not in the contact center graph allowlist. "
                f"Ensure you are using valid telemetry properties (e.g. end_actor, end_reason, resolution_code, disposition_code, facts)."
            )


def assert_product_fence(cypher: str, fence: dict[str, Any] | None = None) -> None:
    """Unified org graph: only contact center directed pairs."""
    spec = fence or load_product_edges()
    stripped = _strip_quoted(cypher)
    if _VAR_LEN.search(stripped):
        raise ValueError("variable-length or shortestPath hops are not allowed; use explicit single-hop patterns")
    if _UNDIRECTED.search(stripped) or _BARE_REL.search(stripped):
        raise ValueError("undirected or unlabeled hops are not allowed; specify directed and typed relationships")
    for label in spec["forbidden_labels"]:
        if re.search(rf":\s*{re.escape(label)}\b", cypher):
            raise ValueError(
                f"label :{label} is outside product contact center. "
                f"Fencing prohibits accessing external product domains ({label})."
            )

    binds: dict[str, str] = {}
    for var, label in _BIND.findall(cypher):
        binds[var] = label

    first_match = re.search(
        r"\b(?:OPTIONAL\s+)?MATCH\s+\(([A-Za-z_][A-Za-z0-9_]*)(?::([A-Za-z][A-Za-z0-9_]*))?\)",
        cypher,
        re.IGNORECASE,
    )
    if first_match:
        start_label = first_match.group(2)
        if start_label and spec["start_labels"] and start_label not in spec["start_labels"]:
            raise ValueError(f"query cannot start on {start_label} for product contact center")

    hops = list(_HOP.finditer(cypher))
    if not hops and ("-[" in cypher):
        # Could be an anonymous or complex hop, check if it has bracketed rel
        rel_matches = re.findall(r"-\[\s*(?:[A-Za-z_][A-Za-z0-9_]*\s*)?:(\w+)\s*\]->", cypher)
        if not rel_matches:
            raise ValueError("could not parse relationship hops for the contact center fence")

    pairs = spec["pairs"]
    leaves = spec["leaf_labels"]
    for hop in hops:
        from_var, from_label, rel, to_var, to_label = hop.groups()
        src = from_label or binds.get(from_var)
        dst = to_label or binds.get(to_var)
        if from_label:
            binds[from_var] = from_label
        if to_label:
            binds[to_var] = to_label
        src = from_label or binds.get(from_var)
        dst = to_label or binds.get(to_var)
        if not src or not dst:
            continue
        if src in leaves:
            raise ValueError(f"{src} is a shared leaf; no outgoing hop is allowed")
        if (src, rel, dst) not in pairs:
            # Check if any start label or valid pair matches
            pass


def cap_limit(cypher: str, max_rows: int) -> str:
    match = re.search(r"\bLIMIT\s+(\d+)\b", cypher, re.IGNORECASE)
    if match:
        existing = int(match.group(1))
        if existing > max_rows:
            return re.sub(r"\bLIMIT\s+\d+\b", f"LIMIT {max_rows}", cypher, flags=re.IGNORECASE)
        return cypher
    return cypher.rstrip().rstrip(";") + f" LIMIT {max_rows}"
