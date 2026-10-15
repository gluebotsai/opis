"""Neo4j Knowledge Graph client for CRM B2B Graph."""

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
DEFAULT_ORG_ID = os.getenv("DEFAULT_ORG_ID", "1003")


def normalize_org_db(org_id: str | int | None) -> str:
    """Normalize organization ID to tenant database name, e.g. 1012 -> org1012."""
    if org_id is None:
        org_id = DEFAULT_ORG_ID
    oid = str(org_id).strip()
    if oid.startswith("org_"):
        return f"org{oid[4:]}"
    if oid.startswith("org"):
        return oid
    return f"org{oid}"


COUNTRY_TO_CURRENCY: dict[str, str] = {
    "india": "INR",
    "united states": "USD",
    "usa": "USD",
    "us": "USD",
    "united kingdom": "GBP",
    "uk": "GBP",
    "great britain": "GBP",
    "gb": "GBP",
    "germany": "EUR",
    "france": "EUR",
    "spain": "EUR",
    "italy": "EUR",
    "netherlands": "EUR",
    "ireland": "EUR",
    "australia": "AUD",
    "canada": "CAD",
    "singapore": "SGD",
    "united arab emirates": "AED",
    "uae": "AED",
}

_org_currency_cache: dict[str, str] = {}


def resolve_org_default_currency(org_id: str | int | None) -> str:
    """Resolve default currency dynamically based on main organization location (Tenant.country)."""
    db_name = normalize_org_db(org_id)
    if db_name in _org_currency_cache:
        return _org_currency_cache[db_name]

    client = Neo4jClient.get_instance()
    try:
        res = client.execute_cypher("MATCH (t:Tenant) RETURN t.country AS country, t.currency AS currency LIMIT 1", org_id=org_id)
        if res.rows:
            explicit_curr = res.rows[0].get("currency")
            if explicit_curr and str(explicit_curr).strip():
                curr = str(explicit_curr).upper().strip()
                _org_currency_cache[db_name] = curr
                return curr

            country = str(res.rows[0].get("country") or "").lower().strip()
            curr = COUNTRY_TO_CURRENCY.get(country, "USD")
            _org_currency_cache[db_name] = curr
            return curr
    except Exception:
        pass

    fallback = "INR" if "1003" in str(org_id) else "USD"
    _org_currency_cache[db_name] = fallback
    return fallback


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
        db_name = normalize_org_db(org_id)
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
            return QueryResult(
                status="error",
                error=f"Neo4j execution error: {str(exc)}",
                error_type="DB_ERROR",
                raw_query=cypher,
            )
