"""Canonical SQL-catalog product ids (semantic layer only)."""

from __future__ import annotations

# Ontology/API ids → catalog file stem (ccaas.yaml, webtracking.yaml, …).
_SQL_CATALOG_ALIASES: dict[str, str] = {
    "contact_centre": "ccaas",
    "contact-center": "ccaas",
    "contact_center": "ccaas",
    "aiccaas": "ccaas",
    "ccaas": "ccaas",
    "web-tracking": "webtracking",
    "web_tracking": "webtracking",
    "webtracking": "webtracking",
    "ticketing": "ticketing",
    "crm": "crm",
    "campaign": "campaign",
    "cdp": "cdp",
    "hub": "hub",
}


def normalize_sql_catalog_product(product: str) -> str:
    """Map spoke/API product string to semantic/catalog/{stem}.yaml key."""
    key = (product or "").strip().lower()
    if not key:
        return key
    return _SQL_CATALOG_ALIASES.get(key, key)
