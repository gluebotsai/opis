#!/usr/bin/env python3
"""Apply human_ontology_neo4j.cypher to every tenant Neo4j database."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CYPHER_PATH = ROOT / "scripts" / "migrations" / "human_ontology_neo4j.cypher"


def _load_databases(explicit: list[str] | None) -> list[str]:
    if explicit:
        return explicit
    env = os.environ.get("NEO4J_TENANT_DATABASES", "").strip()
    if env:
        return [d.strip() for d in env.split(",") if d.strip()]
    single = os.environ.get("NEO4J_DATABASE", "neo4j").strip()
    return [single] if single else ["neo4j"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", action="append", default=None, help="Tenant DB name(s)")
    parser.add_argument("--dry-run", action="store_true", help="Print statements only")
    args = parser.parse_args()

    if not CYPHER_PATH.exists():
        print(f"Missing {CYPHER_PATH}", file=sys.stderr)
        return 1

    statements = [
        s.strip()
        for s in CYPHER_PATH.read_text(encoding="utf-8").split(";")
        if s.strip() and not s.strip().startswith("//")
    ]
    databases = _load_databases(args.database)

    try:
        from neo4j import GraphDatabase
    except ImportError:
        if args.dry_run:
            for db in databases:
                print(f"# database={db}")
                for stmt in statements:
                    print(stmt + ";")
            return 0
        print("neo4j driver not installed; use --dry-run or pip install neo4j", file=sys.stderr)
        return 1

    uri = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
    user = os.environ.get("NEO4J_USER", "neo4j")
    password = os.environ.get("NEO4J_PASSWORD", "")

    driver = GraphDatabase.driver(uri, auth=(user, password))
    try:
        for db in databases:
            print(f"Applying migration to {db} ({len(statements)} statements)...")
            with driver.session(database=db) as session:
                for stmt in statements:
                    if args.dry_run:
                        print(f"[{db}] {stmt[:80]}...")
                        continue
                    session.run(stmt).consume()
            print(f"Done: {db}")
    finally:
        driver.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
