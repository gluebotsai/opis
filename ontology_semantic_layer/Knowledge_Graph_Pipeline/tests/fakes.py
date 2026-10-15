"""Test doubles.

``FakeNeo4j`` interprets the *exact* Cypher shapes cypher_builder emits -- node
upsert with extra labels and guarded relationship subqueries, relationship_only
upsert/delete, properties_on upsert/remove, node detach/soft delete.

This is deliberately not a Cypher engine. It exists so that the acceptance tests
that matter -- idempotency (5) and cross-tenant isolation (6) -- run in CI with no
Docker. Node identity is (label, key_property, key_value), which is exactly the
semantics a uniqueness constraint gives you, so "replay changes no node count"
is a real assertion here rather than a tautology.

Tests that genuinely need a server (PROFILE plan inspection, acceptance test 13)
are marked and skipped unless NEO4J_TEST_URI is set.
"""

from __future__ import annotations

import re
from collections import defaultdict

RE_NODE_MERGE = re.compile(r"^MERGE \(n:(\w+) \{(\w+): e\.key\}\)$")
RE_NODE_MATCH = re.compile(r"^MATCH \(n:(\w+) \{(\w+): e\.key\}\)$")
RE_SET_LABELS = re.compile(r"^SET n((?::\w+)+)$")
RE_GUARD = re.compile(r"^\s*WITH n, e WHERE e\.(\w+) IS NOT NULL$")
RE_TARGET_MERGE = re.compile(r"^\s*MERGE \((t\d+):(\w+) \{(\w+): e\.(\w+)\}\)$")
RE_EDGE_OUT = re.compile(r"^\s*MERGE \(n\)-\[:(\w+)\]->\((t\d+)\)$")
RE_EDGE_IN = re.compile(r"^\s*MERGE \(n\)<-\[:(\w+)\]-\((t\d+)\)$")
RE_REL_A = re.compile(r"^MERGE \(a:(\w+) \{(\w+): e\.from_key\}\)$")
RE_REL_B = re.compile(r"^MERGE \(b:(\w+) \{(\w+): e\.to_key\}\)$")
RE_REL_EDGE = re.compile(r"^MERGE \(a\)-\[:(\w+)\]->\(b\)$")
RE_REL_MATCH = re.compile(
    r"^MATCH \(a:(\w+) \{(\w+): e\.from_key\}\)-\[r:(\w+)\]->\(b:(\w+) \{(\w+): e\.to_key\}\)$"
)
RE_PROPS_ON_MERGE = re.compile(r"^MERGE \(n:(\w+) \{(\w+): e\.target_key\}\)$")
RE_PROPS_ON_MATCH = re.compile(r"^MATCH \(n:(\w+) \{(\w+): e\.target_key\}\)$")
RE_REMOVE = re.compile(r"^REMOVE n\.`([^`]+)`$")


class Graph:
    """One tenant's database."""

    def __init__(self, name: str):
        self.name = name
        self.nodes: dict[tuple, dict] = {}
        self.edges: set[tuple] = set()
        self.constraints: set[tuple[str, str]] = set()

    def merge_node(self, label: str, key_prop: str, key_value) -> dict:
        ident = (label, key_prop, key_value)
        node = self.nodes.get(ident)
        if node is None:
            node = self.nodes[ident] = {
                "labels": {label}, "props": {key_prop: key_value}, "id": ident,
            }
        return node

    def find_node(self, label: str, key_prop: str, key_value):
        return self.nodes.get((label, key_prop, key_value))

    def delete_node(self, ident: tuple) -> None:
        self.nodes.pop(ident, None)
        self.edges = {e for e in self.edges if e[0] != ident and e[2] != ident}

    def node_count(self, label: str | None = None) -> int:
        if label is None:
            return len(self.nodes)
        return sum(1 for n in self.nodes.values() if label in n["labels"])

    def edge_count(self, rel_type: str | None = None) -> int:
        if rel_type is None:
            return len(self.edges)
        return sum(1 for e in self.edges if e[1] == rel_type)


class _Tx:
    def __init__(self, graph: Graph, log: list):
        self.graph, self.log = graph, log

    def run(self, cypher: str, batch=None, **kw):
        self.log.append((self.graph.name, cypher, list(batch or [])))
        for row in batch or []:
            _apply(self.graph, cypher, row)
        return _Result()


class _Result:
    def consume(self):
        return self

    def single(self):
        return None


class _Session:
    def __init__(self, graph: Graph, log: list):
        self.graph, self.log = graph, log

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute_write(self, fn):
        return fn(_Tx(self.graph, self.log))

    def run(self, cypher, **kw):
        return _Tx(self.graph, self.log).run(cypher, **kw)


class FakeDriver:
    def __init__(self, store: dict, log: list):
        self.store, self.log = store, log

    def session(self, database: str = "neo4j", **kw):
        if database not in self.store:
            self.store[database] = Graph(database)
        return _Session(self.store[database], self.log)

    def close(self):
        pass


class FakePool:
    """Stands in for DriverPool. Every instance shares one store, keyed by database."""

    def __init__(self):
        self.store: dict[str, Graph] = {}
        self.log: list = []
        self._driver = FakeDriver(self.store, self.log)

    def get(self, instance=None):
        return self._driver

    @property
    def default_instance(self):
        return "instance-1"

    @property
    def metadata_database(self):
        return "cdcmeta"

    def graph(self, database: str) -> Graph:
        return self.store.setdefault(database, Graph(database))

    def close(self):
        pass


# --------------------------------------------------------------------------
# the interpreter
# --------------------------------------------------------------------------

def _apply(graph: Graph, cypher: str, e: dict) -> None:
    lines = [ln for ln in cypher.splitlines() if ln.strip()]
    n = None
    n_ident = None
    targets: dict[str, dict] = {}
    guard_ok = True
    a = b = None
    rel_match = None

    for line in lines:
        stripped = line.strip()
        if stripped == "UNWIND $batch AS e" or stripped in ("WITH n, e", "}", "CALL {", "CALL (n, e) {"):
            if stripped in ("CALL {", "CALL (n, e) {"):
                guard_ok = True
            continue

        m = RE_NODE_MERGE.match(stripped)
        if m:
            label, key_prop = m.group(1), m.group(2)
            n = graph.merge_node(label, key_prop, e["key"])
            n_ident = n["id"]
            continue

        m = RE_NODE_MATCH.match(stripped)
        if m:
            n = graph.find_node(m.group(1), m.group(2), e["key"])
            n_ident = n["id"] if n else None
            if n is None:
                return
            continue

        if stripped == "SET n += e.props":
            if n is not None:
                n["props"].update(e.get("props") or {})
            continue

        m = RE_SET_LABELS.match(stripped)
        if m and n is not None:
            n["labels"].update(x for x in m.group(1).split(":") if x)
            continue

        if stripped == "DETACH DELETE n":
            if n_ident:
                graph.delete_node(n_ident)
            return

        if stripped == "SET n.deleted_at = e.ts":
            if n is not None:
                n["props"]["deleted_at"] = e.get("ts")
            return

        m = RE_GUARD.match(line)
        if m:
            guard_ok = e.get(m.group(1)) is not None
            continue

        m = RE_TARGET_MERGE.match(line)
        if m and guard_ok:
            var, label, key_prop, payload_key = m.groups()
            targets[var] = graph.merge_node(label, key_prop, e[payload_key])
            continue

        m = RE_EDGE_OUT.match(line)
        if m and guard_ok and n is not None:
            graph.edges.add((n["id"], m.group(1), targets[m.group(2)]["id"]))
            continue

        m = RE_EDGE_IN.match(line)
        if m and guard_ok and n is not None:
            graph.edges.add((targets[m.group(2)]["id"], m.group(1), n["id"]))
            continue

        m = RE_REL_A.match(stripped)
        if m:
            a = graph.merge_node(m.group(1), m.group(2), e["from_key"])
            continue

        m = RE_REL_B.match(stripped)
        if m:
            b = graph.merge_node(m.group(1), m.group(2), e["to_key"])
            continue

        m = RE_REL_EDGE.match(stripped)
        if m and a and b:
            graph.edges.add((a["id"], m.group(1), b["id"]))
            continue

        m = RE_REL_MATCH.match(stripped)
        if m:
            fl, fk, rtype, tl, tk = m.groups()
            src = graph.find_node(fl, fk, e["from_key"])
            dst = graph.find_node(tl, tk, e["to_key"])
            rel_match = (src["id"], rtype, dst["id"]) if src and dst else None
            continue

        if stripped == "DELETE r":
            if rel_match:
                graph.edges.discard(rel_match)
            return

        m = RE_PROPS_ON_MERGE.match(stripped)
        if m:
            n = graph.merge_node(m.group(1), m.group(2), e["target_key"])
            n_ident = n["id"]
            continue

        m = RE_PROPS_ON_MATCH.match(stripped)
        if m:
            n = graph.find_node(m.group(1), m.group(2), e["target_key"])
            if n is None:
                return
            continue

        m = RE_REMOVE.match(stripped)
        if m and n is not None:
            n["props"].pop(m.group(1), None)
            continue


# --------------------------------------------------------------------------
# Debezium message construction
# --------------------------------------------------------------------------

def envelope(after=None, before=None, op="c", ts_ms=1_700_000_000_000, schema=None):
    """Build a Debezium message with schemas.enable=true wrapping."""
    payload = {"before": before, "after": after, "op": op, "ts_ms": ts_ms,
               "source": {"connector": "postgresql"}}
    return {"schema": schema or {"fields": []}, "payload": payload}


def value_schema(fields: dict) -> dict:
    """Build the ``after`` half of a Debezium value schema.  {column: logical_type}"""
    return {
        "type": "struct",
        "fields": [
            {"field": "after", "type": "struct",
             "fields": [{"field": c, "name": t} for c, t in fields.items()]}
        ],
    }


class FakeRegistry:
    """Minimal registry double."""

    def __init__(self, orgs):
        self._by_tenant = {}
        for o in orgs:
            if getattr(o, "tenant_id", None):
                self._by_tenant[str(o.tenant_id)] = o
            if getattr(o, "organization_id", None):
                self._by_tenant[str(o.organization_id)] = o

    def lookup(self, tenant_id):
        return self._by_tenant.get(str(tenant_id)) if tenant_id is not None else None

    def all(self):
        return list(self._by_tenant.values())

    def active(self):
        return [o for o in self._by_tenant.values() if o.active]
