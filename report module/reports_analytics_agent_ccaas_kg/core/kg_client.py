"""Neo4j Knowledge Graph client for CCaaS Contact Center Graph."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional
from dotenv import load_dotenv
from neo4j import GraphDatabase

from .models import QueryResult

_env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_env_path)

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://10.180.0.126:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "Neo4j@789")


def normalize_org_db(org_id: str | int) -> str:
    """Normalize organization ID to tenant database name, e.g. 1012 -> org1012."""
    oid = str(org_id).strip()
    if oid.startswith("org_"):
        return f"org{oid[4:]}"
    if oid.startswith("org"):
        return oid
    return f"org{oid}"


class Neo4jClient:
    """Singleton Neo4j client connection."""
    _instance: Optional[Neo4jClient] = None

    def __init__(self, uri: str, user: str, password: str) -> None:
        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    @classmethod
    def get_instance(cls) -> Neo4jClient:
        if cls._instance is None:
            cls._instance = cls(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
        return cls._instance

    def execute_cypher(
        self,
        cypher: str,
        params: Optional[dict[str, Any]] = None,
        org_id: Optional[str | int] = None,
    ) -> QueryResult:
        """Execute a read-only Cypher query against the tenant database."""
        db_name = normalize_org_db(org_id) if org_id else "neo4j"
        parameters = params or {}

        try:
            with self.driver.session(database=db_name) as session:
                result = session.run(cypher, parameters)
                records = [record.data() for record in result]
                keys = list(records[0].keys()) if records else []
                return QueryResult(
                    status="success",
                    columns=keys,
                    rows=records,
                    row_count=len(records),
                    raw_query=cypher,
                )
        except Exception as exc:
            # Fallback to default 'neo4j' database if tenant database is missing
            if "Database does not exist" in str(exc) and db_name != "neo4j":
                try:
                    with self.driver.session(database="neo4j") as session:
                        result = session.run(cypher, parameters)
                        records = [record.data() for record in result]
                        keys = list(records[0].keys()) if records else []
                        return QueryResult(
                            status="success",
                            columns=keys,
                            rows=records,
                            row_count=len(records),
                            raw_query=cypher,
                        )
                except Exception as inner_exc:
                    return QueryResult(
                        status="error",
                        error=f"Neo4j execution error: {str(inner_exc)}",
                        error_type="DB_ERROR",
                        raw_query=cypher,
                    )

            return QueryResult(
                status="error",
                error=f"Neo4j execution error: {str(exc)}",
                error_type="DB_ERROR",
                raw_query=cypher,
            )
