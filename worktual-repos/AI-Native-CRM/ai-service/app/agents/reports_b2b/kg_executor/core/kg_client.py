"""Neo4j Knowledge Graph client for CRM B2B Graph."""

from __future__ import annotations

from typing import Any, Optional

from neo4j import GraphDatabase
from neo4j.time import Date, DateTime, Duration, Time

from app.config import get_settings

from .models import QueryResult

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
    "ae": "AED",
    "in": "INR",
    "ind": "INR",
}

_org_currency_cache: dict[str, str] = {}


def json_safe(value: Any) -> Any:
    """Turn Neo4j temporal values into JSON values before they leave the graph."""
    if isinstance(value, (DateTime, Date, Time)):
        return value.iso_format()
    if isinstance(value, Duration):
        return str(value)
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    return value


def normalize_org_db(org_id: str | int | None) -> str:
    """Normalize organization ID to tenant database name, e.g. 1012 -> org1012."""
    if org_id is None:
        org_id = "0"
    oid = str(org_id).strip()
    if oid.startswith("org_"):
        return f"org{oid[4:]}"
    if oid.startswith("org"):
        return oid
    return f"org{oid}"


def _mapped_currency(country: Any) -> str | None:
    raw = str(country or "").strip().lower()
    if not raw:
        return None
    if raw in {"in", "ind"} or "india" in raw:
        return "INR"
    if "united kingdom" in raw or "great britain" in raw:
        return "GBP"
    if "united states" in raw:
        return "USD"
    if "arab emirates" in raw:
        return "AED"
    return COUNTRY_TO_CURRENCY.get(raw)


def _currency_from_accounts(org_id: str | int | None) -> str | None:
    """Read accounts.organizations.country when the graph tenant has no location."""
    raw = str(org_id or "").strip()
    if raw.startswith("org_"):
        raw = raw[4:]
    elif raw.startswith("org"):
        raw = raw[3:]
    if not raw.isdigit():
        return None
    try:
        from app.agents.reports_b2b.core.db import fetch_warehouse_rows

        rows = fetch_warehouse_rows(
            "SELECT country FROM accounts.organizations WHERE id = %s::bigint LIMIT 1",
            (int(raw),),
        )
    except Exception:
        return None
    row = rows[0] if rows else None
    if not row:
        return None
    country = row.get("country") if isinstance(row, dict) else None
    return _mapped_currency(country)


def resolve_org_default_currency(org_id: str | int | None) -> str:
    """Tenant currency from the graph, then accounts.organizations.country."""
    db_name = normalize_org_db(org_id)
    if db_name in _org_currency_cache:
        return _org_currency_cache[db_name]

    explicit: str | None = None
    mapped: str | None = None
    try:
        client = Neo4jClient.get_instance()
        res = client.execute_cypher(
            cypher="MATCH (t:Tenant) RETURN t.country AS country, t.currency AS currency LIMIT 1",
            org_id=org_id,
        )
        if res.rows:
            explicit_curr = res.rows[0].get("currency")
            if explicit_curr and str(explicit_curr).strip():
                explicit = str(explicit_curr).upper().strip()
            mapped = _mapped_currency(res.rows[0].get("country"))
    except Exception:
        pass

    # A stored USD on the tenant is the old default when the country is not the US.
    if explicit and not (explicit == "USD" and mapped and mapped != "USD"):
        _org_currency_cache[db_name] = explicit
        return explicit
    if mapped:
        _org_currency_cache[db_name] = mapped
        return mapped

    from_accounts = _currency_from_accounts(org_id)
    if from_accounts:
        _org_currency_cache[db_name] = from_accounts
        return from_accounts
    if explicit:
        _org_currency_cache[db_name] = explicit
        return explicit
    return "USD"


class Neo4jClient:
    _instance: Optional["Neo4jClient"] = None

    def __init__(self) -> None:
        settings = get_settings()
        uri = settings.resolved_reports_neo4j_uri
        if not uri:
            raise RuntimeError(
                "Neo4j is not configured (set REPORTS_NEO4J_URI or NEO4J_URI)"
            )
        user = settings.resolved_reports_neo4j_user
        password = settings.resolved_reports_neo4j_password
        self._driver = GraphDatabase.driver(uri, auth=(user, password))

    @classmethod
    def get_instance(cls) -> "Neo4jClient":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset_instance(cls) -> None:
        if cls._instance is not None:
            try:
                cls._instance._driver.close()
            except Exception:
                pass
        cls._instance = None

    def execute_cypher(
        self,
        *,
        cypher: str,
        params: Optional[dict[str, Any]] = None,
        org_id: str | int | None = None,
    ) -> QueryResult:
        db_name = normalize_org_db(org_id)
        actual_params = dict(params or {})
        try:
            with self._driver.session(database=db_name) as session:
                result = session.run(cypher, actual_params)
                rows = [json_safe(dict(record)) for record in result]
                return QueryResult(status="success", rows=rows, row_count=len(rows), raw_query=cypher)
        except Exception as exc:
            return QueryResult(
                status="error",
                error=str(exc),
                error_type="REPLAN",
                rows=[],
                row_count=0,
                raw_query=cypher,
            )
