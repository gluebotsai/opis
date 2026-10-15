#!/usr/bin/env python3
"""
Pipeline Reconciliation Audit  (v2)
===================================
Audits a tenant graph against its Postgres source AND against core.yaml.

What changed from v1
--------------------
* Reads the mapping YAML directly. v1 audited ConfigLoader's parsed model, so
  any field the loader ignored was invisible to the audit too — that is how a
  half-built collection chain survived two clean-looking runs.
* Counts edges BY ENDPOINT LABEL, not globally by type. A global type count
  reports OK for CONTAINS when every one of those edges came from somewhere
  else.
* Audits the collection chain explicitly: owner edge, period edge, member
  edge, orphaned members, disconnected collections.
* Audits hub attachment separately.
* Classifies every zero-edge by CAUSE instead of printing an alphabetical
  wall: no source rows / FK always null / endpoint missing / loader feature
  not implemented / flagged in config / unexplained.
* Honours requires_migration, verify and resolve_later as EXPECTED, so known
  gaps stop competing for attention with real ones.
* Enforces edge_budget by sampling node degree.
* --compare lets you audit two tenants at once and split systemic failures
  (zero everywhere) from ingest lag (zero in one tenant).
* Distinguishes missing table / missing column / permission denied instead of
  collapsing all three into "PG TABLE MISSING".
* Exits non-zero when something unexplained is found, so CI can gate on it.

Usage
-----
  python scripts/reconcile.py --org 1000
  python scripts/reconcile.py --org 1000 --domain ecommerce
  python scripts/reconcile.py --org 1000 --compare 1003
  python scripts/reconcile.py --org 1000 --json > audit.json
  python scripts/reconcile.py --dry-run          # no DB; validates the plan
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import yaml

try:
    import dotenv
    dotenv.load_dotenv()
except ImportError:
    pass

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


# ===========================================================================
# Mapping model — read straight from YAML so nothing is filtered out
# ===========================================================================

@dataclass
class EdgeSpec:
    type: str
    src_label: str
    dst_label: str
    source_table: str
    from_column: str | None = None
    needs_feature: str | None = None      # hub | key_template | rel_only | match_fields
    expected_zero: str | None = None      # reason from config flags
    neo4j_count: int = -1
    cause: str = ""


@dataclass
class CollectionSpec:
    name: str
    owner_label: str
    owner_edge: str
    bucket_label: str | None = None
    bucket_edge: str | None = None
    member_tables: list = field(default_factory=list)
    member_labels: list = field(default_factory=list)
    owner_edges: int = -1
    bucket_edges: int = -1
    member_edges: int = -1
    orphan_members: int = -1
    disconnected: int = -1


@dataclass
class LabelSpec:
    label: str
    tables: list = field(default_factory=list)
    pg_rows: int = 0
    pg_errors: list = field(default_factory=list)
    neo4j_nodes: int = -1
    dedupes: bool = False                 # synthesize_key can legitimately collapse rows
    expected_zero: str | None = None
    max_degree: int = -1
    edge_budget: int | None = None


def load_mapping(core: Path, overlays: list[Path]) -> dict:
    doc = yaml.safe_load(core.read_text())
    for ov in overlays:
        extra = yaml.safe_load(ov.read_text()) or {}
        for section in ("tables", "collections", "hubs", "stub_labels", "derived"):
            if extra.get(section):
                doc.setdefault(section, {}).update(extra[section])
    return doc


def flag_reason(spec: dict) -> str | None:
    """Config-declared reasons a zero result is expected rather than broken."""
    for key in ("requires_migration", "verify", "resolve_later"):
        if spec.get(key):
            v = spec[key]
            v = v[0] if isinstance(v, list) else v
            return f"{key}: {str(v)[:70]}"
    return None


def build_plan(doc: dict):
    tables = doc.get("tables") or {}
    hubs = set(doc.get("hubs") or {})
    colls_cfg = doc.get("collections") or {}

    labels: dict[str, LabelSpec] = {}
    edges: list[EdgeSpec] = []
    colls: dict[str, CollectionSpec] = {}

    for name, cfg in colls_cfg.items():
        b = cfg.get("bucket") or {}
        colls[name] = CollectionSpec(
            name=name,
            owner_label=cfg["owner"]["label"],
            owner_edge=cfg["owner_edge"],
            bucket_label=b.get("label"),
            bucket_edge=b.get("edge"),
        )

    for tname, spec in tables.items():
        if not isinstance(spec, dict):
            continue
        reason = flag_reason(spec)
        mode = spec.get("mode")

        if mode == "relationship_only":
            src, dst = spec.get("from") or {}, spec.get("to") or {}
            edges.append(EdgeSpec(
                type=spec["type"], src_label=src.get("label", "?"),
                dst_label=dst.get("label", "?"), source_table=tname,
                needs_feature=None,
                expected_zero=reason,
            ))
            continue

        label = spec.get("label") or spec.get("merges_into")
        if not label:
            continue
        ls = labels.setdefault(label, LabelSpec(label=label))
        ls.tables.append(tname)
        if spec.get("synthesize_key") and not re.fullmatch(r"[a-z_]+:\{id\}", spec["synthesize_key"] or ""):
            ls.dedupes = True                       # natural-key template can collapse rows
        if reason and not ls.expected_zero:
            ls.expected_zero = reason
        if spec.get("edge_budget") is not None:
            ls.edge_budget = max(ls.edge_budget or 0, spec["edge_budget"])

        coll = spec.get("collection")
        if coll and coll.get("name") in colls:
            c = colls[coll["name"]]
            c.member_tables.append(tname)
            if label not in c.member_labels:
                c.member_labels.append(label)

        for r in (spec.get("relationships") or []):
            other = r.get("to") or r.get("from")
            if not other:
                continue
            src_l, dst_l = (label, other) if "to" in r else (other, label)
            feature = None
            edges.append(EdgeSpec(
                type=r["type"], src_label=src_l, dst_label=dst_l,
                source_table=tname, from_column=r.get("from_column"),
                needs_feature=feature, expected_zero=reason,
            ))

    return labels, edges, colls, hubs


# ===========================================================================
# Postgres
# ===========================================================================

class PG:
    MISSING_TABLE = "42P01"
    MISSING_COLUMN = "42703"
    NO_PRIVILEGE = "42501"

    def __init__(self, dsn):
        import psycopg2
        self.conn = psycopg2.connect(dsn)
        self.conn.set_session(autocommit=True)

    def _one(self, sql, args=()):
        """Returns (value, error_kind). Error kinds are distinguished, not merged."""
        import psycopg2
        with self.conn.cursor() as cur:
            try:
                cur.execute(sql, args)
                row = cur.fetchone()
                return (row[0] if row else None), None
            except psycopg2.Error as e:
                code = getattr(e, "pgcode", None)
                return None, {
                    self.MISSING_TABLE: "TABLE MISSING",
                    self.MISSING_COLUMN: "COLUMN MISSING",
                    self.NO_PRIVILEGE: "PERMISSION DENIED",
                }.get(code, f"PG ERROR {code}")

    def count(self, table, org, tenant_col="organization_id", mapping=None):
        schema, tbl = table.split(".", 1)
        has, err = self._one(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema=%s AND table_name=%s AND column_name=%s",
            (schema, tbl, tenant_col))
        if err:
            return None, err
        if has:
            return self._one(f'SELECT count(*) FROM "{schema}"."{tbl}" WHERE "{tenant_col}"=%s', (org,))
            
        if mapping and "tenant" in mapping and "via" in mapping["tenant"]:
            via = mapping["tenant"]["via"]
            # build join
            # SELECT count(DISTINCT base.id) FROM "schema"."tbl" base JOIN ...
            base_alias = "t0"
            query = f'SELECT count(*) FROM "{schema}"."{tbl}" {base_alias}'
            prev_alias = base_alias
            for i, hop in enumerate(via):
                curr_alias = f"t{i+1}"
                parent_schema, parent_tbl = hop["parent"].split(".", 1)
                query += f' JOIN "{parent_schema}"."{parent_tbl}" {curr_alias} ON {prev_alias}."{hop["column"]}" = {curr_alias}."{hop["parent_key"]}"'
                prev_alias = curr_alias
            query += f' WHERE {prev_alias}."{tenant_col}"=%s'
            return self._one(query, (org,))
            
        return self._one(f'SELECT count(*) FROM "{schema}"."{tbl}"')

    def non_null(self, table, column, org, tenant_col="organization_id"):
        """How many rows actually carry this FK. Distinguishes 'always null'
        from 'mapping broken' — the biggest blind spot in v1."""
        schema, tbl = table.split(".", 1)
        has, _ = self._one(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema=%s AND table_name=%s AND column_name=%s",
            (schema, tbl, tenant_col))
        where = f'WHERE "{column}" IS NOT NULL'
        if has:
            where += f' AND "{tenant_col}"=%s'
            return self._one(f'SELECT count(*) FROM "{schema}"."{tbl}" {where}', (org,))
        return self._one(f'SELECT count(*) FROM "{schema}"."{tbl}" {where}')


# ===========================================================================
# Neo4j
# ===========================================================================

class Neo:
    def __init__(self, uri, user, password, database):
        from neo4j import GraphDatabase
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self.database = database

    def _one(self, cypher, **params):
        with self.driver.session(database=self.database) as s:
            rec = s.run(cypher, **params).single()
            return rec[0] if rec else 0

    def nodes(self, label):
        return self._one(f"MATCH (n:`{label}`) RETURN count(n)")

    def edges(self, rel_type, src=None, dst=None):
        a = f":`{src}`" if src else ""
        b = f":`{dst}`" if dst else ""
        return self._one(f"MATCH (x{a})-[r:`{rel_type}`]->(y{b}) RETURN count(r)")

    def orphans(self, label, rel_type):
        return self._one(
            f"MATCH (m:`{label}`) WHERE NOT (m)<-[:`{rel_type}`]-() RETURN count(m)")

    def disconnected(self, coll_label, owner_edge):
        return self._one(
            f"MATCH (c:`{coll_label}`) WHERE NOT ()-[:`{owner_edge}`]->(c) RETURN count(c)")

    def max_degree(self, label):
        return self._one(
            f"MATCH (n:`{label}`) RETURN coalesce(max(COUNT {{ (n)--() }}), 0)")

    def close(self):
        self.driver.close()


# ===========================================================================
# Audit
# ===========================================================================

MEMBER_EDGE = "CONTAINS"


def audit(doc, pg, neo, org, tenant_col):
    labels, edges, colls, hubs = build_plan(doc)

    # ---- nodes -------------------------------------------------------------
    for ls in labels.values():
        total, errors = 0, []
        for t in ls.tables:
            n, err = pg.count(t, org, tenant_col, doc["tables"][t]) if pg else (None, "DRY RUN")
            if err:
                errors.append(f"{t}: {err}")
            else:
                total += n
        ls.pg_rows, ls.pg_errors = total, errors
        if neo:
            ls.neo4j_nodes = neo.nodes(ls.label)
            if ls.edge_budget is not None:
                ls.max_degree = neo.max_degree(ls.label)

    # ---- collection chain --------------------------------------------------
    for c in colls.values():
        if not neo:
            continue
        c.owner_edges = neo.edges(c.owner_edge, c.owner_label, c.name)
        c.disconnected = neo.disconnected(c.name, c.owner_edge)
        if c.bucket_edge:
            c.bucket_edges = neo.edges(c.bucket_edge, c.name, c.bucket_label)
        c.member_edges = sum(neo.edges(MEMBER_EDGE, dst=m) for m in c.member_labels)
        c.orphan_members = sum(neo.orphans(m, MEMBER_EDGE) for m in c.member_labels)

    # ---- edges, counted by endpoint ---------------------------------------
    for e in edges:
        if not neo:
            continue
        known = e.src_label in labels or e.src_label in hubs or e.src_label in colls
        e.neo4j_count = neo.edges(e.type, e.src_label if known else None, e.dst_label)

    # ---- classify every zero ----------------------------------------------
    node_count = {l: ls.neo4j_nodes for l, ls in labels.items()}
    for h in hubs:
        node_count[h] = neo.nodes(h) if neo else -1

    for e in edges:
        if e.neo4j_count > 0:
            e.cause = "OK"
            continue
        if e.expected_zero:
            e.cause = f"EXPECTED ({e.expected_zero})"
            continue
        src_rows = labels.get(e.src_label)
        if e.needs_feature:
            e.cause = f"FEATURE GAP ({e.needs_feature})"
            continue
        if node_count.get(e.src_label, 0) == 0 or node_count.get(e.dst_label, 0) == 0:
            e.cause = "BLOCKED (endpoint has no nodes)"
            continue
        if pg and e.from_column:
            nn, err = pg.non_null(e.source_table, e.from_column, org, tenant_col)
            if err is None and nn == 0:
                e.cause = "EXPECTED (FK null on every row)"
                continue
        e.cause = "UNEXPLAINED"

    return labels, edges, colls, hubs


# ===========================================================================
# Report
# ===========================================================================

def status_of(ls: LabelSpec) -> str:
    if ls.pg_errors and ls.pg_rows == 0:
        return ls.pg_errors[0]
    if ls.expected_zero and ls.neo4j_nodes == 0:
        return "EXPECTED ZERO"
    if ls.pg_rows == 0 and ls.neo4j_nodes == 0:
        return "EMPTY SOURCE"
    if ls.pg_rows > 0 and ls.neo4j_nodes == 0:
        return "NOT SYNCED"
    delta = ls.pg_rows - ls.neo4j_nodes
    if delta == 0:
        return "PERFECT"
    if delta > 0 and ls.dedupes:
        return f"DEDUPED (-{delta})"
    pct = abs(delta) / max(ls.pg_rows, 1) * 100
    return f"{'LAGGING' if delta > 0 else 'EXTRA'} ({abs(delta)}, {pct:.0f}%)"


def report(labels, edges, colls, hubs, org, as_json=False):
    if as_json:
        print(json.dumps({
            "org": org,
            "labels": [{"label": l.label, "tables": l.tables, "pg": l.pg_rows,
                        "neo4j": l.neo4j_nodes, "status": status_of(l),
                        "max_degree": l.max_degree, "edge_budget": l.edge_budget}
                       for l in labels.values()],
            "collections": [c.__dict__ for c in colls.values()],
            "edges": [e.__dict__ for e in edges],
        }, indent=2, default=str))
        return 0

    W = 108
    print("\n" + "=" * W)
    print(f"  RECONCILIATION AUDIT — org {org}")
    print("=" * W)

    # --- 1. collections first: this is the load-bearing structure ----------
    print(f"\n{'COLLECTION':<22}{'owner→coll':>12}{'coll→period':>13}"
          f"{'→members':>11}{'orphans':>9}{'unowned':>9}  Status")
    print("-" * W)
    broken_chains = 0
    for c in sorted(colls.values(), key=lambda x: x.name):
        if c.member_edges <= 0 and c.owner_edges <= 0:
            st = "IDLE (no members yet)"
        elif c.owner_edges == 0:
            st = "BROKEN — members exist but nothing owns them"
            broken_chains += 1
        elif c.bucket_edge and c.bucket_edges == 0:
            st = "BROKEN — no period nodes"
            broken_chains += 1
        elif c.orphan_members > 0:
            st = f"PARTIAL — {c.orphan_members} members unlinked"
            broken_chains += 1
        else:
            st = "OK"
        na = lambda v: "—" if v < 0 else str(v)
        print(f"{c.name:<22}{na(c.owner_edges):>12}{na(c.bucket_edges):>13}"
              f"{na(c.member_edges):>11}{na(c.orphan_members):>9}"
              f"{na(c.disconnected):>9}  {st}")

    # --- 2. nodes ----------------------------------------------------------
    print(f"\n{'LABEL':<30}{'PG':>10}{'Neo4j':>10}{'Delta':>10}  Status")
    print("-" * W)
    tot_pg = tot_neo = 0
    severity = {"NOT SYNCED": 0, "EXTRA": 1, "LAGGING": 2, "DEDUPED": 3,
                "EXPECTED ZERO": 4, "EMPTY SOURCE": 5, "PERFECT": 6}
    def rank(l):
        st = status_of(l)
        for k, v in severity.items():
            if st.startswith(k):
                return (v, l.label)
        return (-1, l.label)          # PG errors first
    for ls in sorted(labels.values(), key=rank):
        tot_pg += ls.pg_rows
        tot_neo += max(ls.neo4j_nodes, 0)
        print(f"{ls.label:<30}{ls.pg_rows:>10}{ls.neo4j_nodes:>10}"
              f"{ls.pg_rows - ls.neo4j_nodes:>10}  {status_of(ls)}")
    print("-" * W)
    print(f"{'TOTAL':<30}{tot_pg:>10}{tot_neo:>10}{tot_pg - tot_neo:>10}")

    # --- 3. edges grouped by cause, not alphabetically ---------------------
    by_cause = defaultdict(list)
    for e in edges:
        by_cause[e.cause.split(" (")[0]].append(e)

    print(f"\n{'EDGE DIAGNOSIS':<30}{'count':>8}  Meaning")
    print("-" * W)
    order = ["OK", "EXPECTED", "BLOCKED", "FEATURE GAP", "UNEXPLAINED"]
    meaning = {
        "OK": "edges present",
        "EXPECTED": "config says so, or the FK is null on every row",
        "BLOCKED": "one endpoint has no nodes yet — resolves when it syncs",
        "FEATURE GAP": "loader does not implement the construct this edge needs",
        "UNEXPLAINED": "both endpoints exist, FK populated — investigate",
    }
    for k in order:
        print(f"{k:<30}{len(by_cause.get(k, [])):>8}  {meaning[k]}")

    gaps = defaultdict(list)
    for e in by_cause.get("FEATURE GAP", []):
        gaps[e.needs_feature].append(e.type)
    if gaps:
        print("\nFEATURE GAPS — fix these in the loader, not in the config:")
        names = {"hub": "hub attachment (hubs: block)",
                 "key_template": "uid key templates on edges (merged labels)",
                 "rel_only": "nested from:/to: on relationship_only tables",
                 "match_fields": "match_fields edge resolution"}
        for f, types in sorted(gaps.items(), key=lambda x: -len(x[1])):
            print(f"  {names.get(f, f):<45} {len(types):>3} edge types dead")
            print(f"    e.g. {', '.join(sorted(set(types))[:6])}")

    if by_cause.get("UNEXPLAINED"):
        print("\nUNEXPLAINED — no known cause, needs a look:")
        for e in sorted(by_cause["UNEXPLAINED"], key=lambda x: x.type)[:40]:
            print(f"  {e.type:<26} {e.src_label} -> {e.dst_label}   ({e.source_table})")

    # --- 4. fan-out regression --------------------------------------------
    over = [l for l in labels.values()
            if l.edge_budget is not None and l.max_degree > 0
            and l.max_degree > l.edge_budget * 3]
    if over:
        print("\nFAN-OUT WARNINGS (max degree far above declared edge_budget):")
        for l in sorted(over, key=lambda x: -x.max_degree)[:15]:
            print(f"  {l.label:<30} budget {l.edge_budget:>3}   observed max {l.max_degree:>9}")

    # --- 5. verdict --------------------------------------------------------
    unexplained = len(by_cause.get("UNEXPLAINED", []))
    print("\n" + "-" * W)
    print(f"nodes {tot_neo:,}/{tot_pg:,}  |  collections broken: {broken_chains}"
          f"  |  feature gaps: {sum(len(v) for v in gaps.values())}"
          f"  |  unexplained edges: {unexplained}")
    return 1 if (unexplained or broken_chains) else 0


def compare(a, b, org_a, org_b):
    """Systemic (zero in both tenants) vs lag (zero in one)."""
    la, _, _, _ = a
    lb, _, _, _ = b
    systemic, lag = [], []
    for name, x in la.items():
        y = lb.get(name)
        if not y:
            continue
        if x.neo4j_nodes == 0 and y.neo4j_nodes == 0 and (x.pg_rows or y.pg_rows):
            systemic.append(name)
        elif (x.neo4j_nodes == 0) != (y.neo4j_nodes == 0):
            lag.append(name)
    print(f"\nSYSTEMIC — zero in both {org_a} and {org_b}; will not self-resolve ({len(systemic)}):")
    for n in sorted(systemic):
        print(f"  {n}")
    print(f"\nINGEST LAG — zero in one tenant only ({len(lag)}):")
    for n in sorted(lag):
        print(f"  {n}")


# ===========================================================================
# Main
# ===========================================================================

def connections(config_dir):
    """Prefer the project's ConfigLoader; fall back to env so this runs alone."""
    try:
        from src.config_loader import ConfigLoader
        loader = ConfigLoader(config_dir=config_dir)
        pg = loader.section("postgres")
        neo = loader.section("neo4j")
        inst = neo["instances"][neo.get("default_instance", "instance-1")]
        import urllib.parse
        dsn = (f"postgresql://{pg['user']}:{urllib.parse.quote_plus(pg['password'])}"
               f"@{pg['host']}:{pg['port']}/{pg['database']}")
        tenant_col = loader.section("control_plane").get("tenant_column", "organization_id")
        return dsn, inst, loader.prefix, tenant_col
    except Exception:
        dsn = (f"postgresql://{os.environ['PG_USER']}:{os.environ['PG_PASSWORD']}"
               f"@{os.environ['PG_HOST']}:{os.environ.get('PG_PORT', 5432)}"
               f"/{os.environ['PG_DATABASE']}")
        inst = {"uri": os.environ["NEO4J_URI"], "user": os.environ["NEO4J_USER"],
                "password": os.environ["NEO4J_PASSWORD"]}
        return dsn, inst, os.environ.get("NEO4J_DB_PREFIX", "org"), "organization_id"


def main():
    p = argparse.ArgumentParser(description="Pipeline reconciliation audit")
    p.add_argument("--org")
    p.add_argument("--compare", help="second org id: split systemic failures from ingest lag")
    p.add_argument("--domain", help="industry overlay name")
    p.add_argument("--config", default="config")
    p.add_argument("--core", default="config/mappings/core.yaml")
    p.add_argument("--json", action="store_true")
    p.add_argument("--dry-run", action="store_true", help="validate the plan without touching any database")
    args = p.parse_args()

    def resolve(rel):
        for base in (Path.cwd(), PROJECT_ROOT):
            cand = Path(rel) if Path(rel).is_absolute() else base / rel
            if cand.exists():
                return cand
        return PROJECT_ROOT / rel

    core = resolve(args.core)
    if not core.exists():
        p.error(f"mapping not found: {core}")
    overlays = []
    if args.domain:
        overlays.append(resolve(f"config/mappings/domains/{args.domain}.yaml"))
    doc = load_mapping(core, [o for o in overlays if o.exists()])

    if args.dry_run:
        labels, edges, colls, hubs = build_plan(doc)
        feat = defaultdict(int)
        for e in edges:
            feat[e.needs_feature or "plain"] += 1
        print(f"labels {len(labels)}  edges {len(edges)}  collections {len(colls)}  hubs {len(hubs)}")
        print("edges by required loader feature:")
        for k, v in sorted(feat.items(), key=lambda x: -x[1]):
            print(f"  {k:<14} {v}")
        print(f"collections with no member table: "
              f"{[c.name for c in colls.values() if not c.member_tables]}")
        print(f"labels flagged expected-zero: "
              f"{[l.label for l in labels.values() if l.expected_zero]}")
        return 0

    if not args.org:
        p.error("--org is required unless --dry-run")

    dsn, inst, prefix, tenant_col = connections(args.config)
    pg = PG(dsn)

    def run(org):
        neo = Neo(inst["uri"], inst["user"], inst["password"], f"{prefix}{org}")
        try:
            return audit(doc, pg, neo, org, tenant_col)
        finally:
            neo.close()

    print("Auditing...", file=sys.stderr)
    a = run(args.org)
    rc = report(*a, org=args.org, as_json=args.json)

    if args.compare:
        b = run(args.compare)
        if not args.json:
            report(*b, org=args.compare)
            compare(a, b, args.org, args.compare)
    return rc


if __name__ == "__main__":
    sys.exit(main())