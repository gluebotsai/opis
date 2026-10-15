"""Route entity hints and origin products to executor products."""

from __future__ import annotations

_ENTITY_TO_PRODUCT: dict[str, str] = {
    "conversation": "ccaas",
    "interaction": "ccaas",
    "ticket": "ticketing",
    "deal": "crm",
    "account": "crm",
    "contact": "cdp",
    "customer": "cdp",
    "campaign": "campaign",
    "message": "campaign",
    "messagedelivery": "campaign",
    "session": "webtracking",
    "visitor": "webtracking",
    "pageview": "webtracking",
}

_ORIGIN_TO_PRODUCT: dict[str, str] = {
    "contact_centre": "ccaas",
    "contact-center": "ccaas",
    "contact_center": "ccaas",
    "ccaas": "ccaas",
    "aiccaas": "ccaas",
    "crm": "crm",
    "ticketing": "ticketing",
    "campaign": "campaign",
    "webtracking": "webtracking",
    "web-tracking": "webtracking",
}

_ENTITY_DEFAULT_TABLE: dict[str, str] = {
    "conversation": "mart_conversations",
    "interaction": "mart_conversations",
    "ticket": "mart_tickets",
    "deal": "mart_deals",
    "contact": "mart_contacts",
    "campaign": "mart_campaign_overview",
    "session": "mart_web_sessions",
    "visitor": "mart_web_visitors",
}


def normalize_product(raw: str) -> str:
    return _ORIGIN_TO_PRODUCT.get(raw.strip().lower(), raw.strip().lower())


def route_product(entity_hint: str | None, origin_product: str) -> str:
    if entity_hint:
        key = entity_hint.strip().lower()
        if key in _ENTITY_TO_PRODUCT:
            return _ENTITY_TO_PRODUCT[key]
    return normalize_product(origin_product)


def default_table(entity_hint: str | None, product: str) -> str:
    if entity_hint:
        key = entity_hint.strip().lower()
        if key in _ENTITY_DEFAULT_TABLE:
            return _ENTITY_DEFAULT_TABLE[key]
    defaults = {
        "ccaas": "mart_conversations",
        "ticketing": "tickets",
        "crm": "mart_deals",
        "campaign": "mart_campaign_overview",
        "webtracking": "mart_web_sessions",
    }
    return defaults.get(product, "mart_conversations")
