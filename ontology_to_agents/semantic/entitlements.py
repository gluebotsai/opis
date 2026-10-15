"""Tenant entitlements from accounts DB (source of truth) with dev fallbacks."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

try:
    import psycopg2
except ImportError:  # pragma: no cover
    psycopg2 = None  # type: ignore[assignment]

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

TENANTS_DIR = Path(__file__).resolve().parents[1] / "tenants"

# Catalog spoke id -> billing SKU (accounts.active_products.product_id)
SPOKE_TO_SKU: dict[str, str] = {
    "contact_centre": "contact-center",
    "contact-center": "contact-center",
    "ccaas": "contact-center",
    "aiccaas": "contact-center",
    "crm": "crm",
    "ticketing": "ticketing",
    "campaign": "campaign",
    "cdp": "cdp",
    "webtracking": "web-tracking",
    "web-tracking": "web-tracking",
    "hub": "hub",
}

# Billing SKU -> channel bucket key in TenantEntitlements.channels
SKU_TO_CHANNEL_PRODUCT: dict[str, str] = {
    "contact-center": "ccaas",
    "crm": "crm",
    "campaign": "campaign",
    "ticketing": "ticketing",
    "cdp": "cdp",
    "web-tracking": "webtracking",
}

# Product context key -> channel list key in TenantEntitlements.channels
PRODUCT_CHANNEL_KEY: dict[str, str] = {
    "ccaas": "ccaas",
    "contact_centre": "ccaas",
    "aiccaas": "ccaas",
    "campaign": "campaign",
    "crm": "crm",
    "ticketing": "ticketing",
    "cdp": "cdp",
    "webtracking": "webtracking",
}

# setup_channel_configs.channel_type (+ social provider) -> capability channel term
CHANNEL_TYPE_TO_CAPABILITY: dict[str, str] = {
    "email": "email",
    "web_chat": "webchat",
    "webchat": "webchat",
    "chat": "webchat",
    "voice": "call",
    "sms": "sms",
}

SOCIAL_PROVIDER_TO_CAPABILITY: dict[str, str] = {
    "whatsapp": "whatsapp",
    "facebook": "facebook",
    "instagram": "instagram",
}

_entitlements_cache: dict[str, Any] = {}


@dataclass
class TenantEntitlements:
    organization_id: int
    skus: list[str] = field(default_factory=list)
    channels: dict[str, list[str]] = field(default_factory=dict)
    features: dict[str, list[str]] = field(default_factory=dict)
    version: str = ""

    def has_sku(self, sku: str) -> bool:
        return sku in self.skus

    def channels_for_product(self, product: str | None) -> list[str]:
        if not product:
            return []
        key = PRODUCT_CHANNEL_KEY.get(product.strip().lower(), product.strip().lower())
        return list(self.channels.get(key) or [])

    def features_for_product(self, product: str | None) -> list[str]:
        if not product:
            return []
        key = PRODUCT_CHANNEL_KEY.get(product.strip().lower(), product.strip().lower())
        return list(self.features.get(key) or [])


def clear_entitlements_cache() -> None:
    _entitlements_cache.clear()


def capability_channel(channel_type: str | None, provider: str | None = None) -> str | None:
    """Map onboarding channel config to semantic capability channel id."""
    ct = (channel_type or "").strip().lower().replace("-", "_")
    if ct == "social":
        prov = (provider or "").strip().lower()
        return SOCIAL_PROVIDER_TO_CAPABILITY.get(prov)
    return CHANNEL_TYPE_TO_CAPABILITY.get(ct)


def bucket_channels_by_product(
    rows: list[tuple[str, Any, str | None]],
) -> dict[str, list[str]]:
    """Group capability channels by product bucket from setup_channel_configs rows."""
    buckets: dict[str, set[str]] = {}
    for channel_type, product_ids_raw, provider in rows:
        cap_ch = capability_channel(channel_type, provider)
        if not cap_ch:
            continue
        product_ids: list[str] = []
        if isinstance(product_ids_raw, list):
            product_ids = [str(p) for p in product_ids_raw if p]
        elif product_ids_raw:
            product_ids = [str(product_ids_raw)]
        for sku in product_ids:
            bucket = SKU_TO_CHANNEL_PRODUCT.get(sku.strip().lower())
            if not bucket:
                continue
            buckets.setdefault(bucket, set()).add(cap_ch)
    return {k: sorted(v) for k, v in buckets.items()}


def _load_dotenv() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip("'").strip('"'))


def _pg_conn():
    if psycopg2 is None:
        return None
    _load_dotenv()
    host = os.environ.get("pg_host") or os.environ.get("PG_HOST")
    if not host:
        return None
    from semantic.pg_pool import checkout_connection

    return checkout_connection()


def _release_pg_conn(conn: Any) -> None:
    if conn is None:
        return
    from semantic.pg_pool import release_connection

    release_connection(conn)


def _version_hash(payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def _tenant_yaml_fallback(organization_id: int) -> TenantEntitlements | None:
    path = TENANTS_DIR / f"org{organization_id}" / "semantic.yaml"
    if not path.is_file():
        return None
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    spokes = data.get("enabledSpokes") or []
    skus = sorted(
        {SPOKE_TO_SKU.get(str(s).strip().lower(), str(s)) for s in spokes if s}
    )
    if not skus:
        return None
    channels = dict(data.get("channels") or {})
    features = dict(data.get("features") or {})
    payload = {"skus": skus, "channels": channels, "features": features}
    return TenantEntitlements(
        organization_id=organization_id,
        skus=skus,
        channels={str(k): list(v) for k, v in channels.items()},
        features={str(k): list(v) for k, v in features.items()},
        version=f"yaml:{_version_hash(payload)}",
    )


def _load_skus_from_db(organization_id: int) -> list[str]:
    """Org-purchased products from accounts.active_products (onboarding source of truth)."""
    conn = _pg_conn()
    if conn is None:
        return []
    skus: set[str] = set()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT product_id
                FROM accounts.active_products
                WHERE organization_id = %s
                  AND product_id IS NOT NULL
                  AND payment_confirmed_at IS NOT NULL
                  AND COALESCE(change_type, '') NOT IN ('removed', 'cancelled', 'churned')
                """,
                (organization_id,),
            )
            for row in cur.fetchall():
                if row[0]:
                    skus.add(str(row[0]))
    except Exception:
        pass
    finally:
        _release_pg_conn(conn)
    return sorted(skus)


def _load_channels_by_product(organization_id: int) -> dict[str, list[str]]:
    """Configured channels from accounts.setup_channel_configs (+ social provider)."""
    conn = _pg_conn()
    if conn is None:
        return {}
    rows: list[tuple[str, Any, str | None]] = []
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT c.channel_type, c.product_ids, s.provider
                FROM accounts.setup_channel_configs c
                LEFT JOIN accounts.setup_social_configs s
                    ON s.channel_config_id = c.id
                WHERE c.organization_id = %s
                  AND lower(coalesce(c.status::text, '')) = 'active'
                """,
                (organization_id,),
            )
            rows = [(str(r[0] or ""), r[1], r[2]) for r in cur.fetchall()]
    except Exception:
        pass
    finally:
        _release_pg_conn(conn)
    return bucket_channels_by_product(rows)


def load_tenant_entitlements(organization_id: int) -> TenantEntitlements:
    """Load org SKUs/channels/features. Fail closed when unknown unless dev fallback."""
    cache_key = str(organization_id)
    if cache_key in _entitlements_cache:
        return _entitlements_cache[cache_key]

    skus = _load_skus_from_db(organization_id)
    channels: dict[str, list[str]] = {}
    features: dict[str, list[str]] = {}

    if skus:
        channels = _load_channels_by_product(organization_id)
        yaml_ent = _tenant_yaml_fallback(organization_id)
        if yaml_ent and yaml_ent.channels:
            for key, chs in yaml_ent.channels.items():
                merged = set(channels.get(key) or [])
                merged.update(str(c).lower() for c in chs)
                channels[key] = sorted(merged)
        if "contact-center" in skus:
            features.setdefault("ccaas", [])
            if "wfm" not in features["ccaas"]:
                features["ccaas"].append("wfm")
        ent = TenantEntitlements(
            organization_id=organization_id,
            skus=skus,
            channels=channels,
            features=features,
            version=_version_hash({"skus": skus, "channels": channels, "features": features}),
        )
        _entitlements_cache[cache_key] = ent
        return ent

    yaml_ent = _tenant_yaml_fallback(organization_id)
    if yaml_ent is not None:
        _entitlements_cache[cache_key] = yaml_ent
        return yaml_ent

    if os.environ.get("ENTITLEMENTS_DEV_FALLBACK", "").strip() in ("1", "true", "yes"):
        dev = TenantEntitlements(
            organization_id=organization_id,
            skus=[
                "contact-center",
                "crm",
                "ticketing",
                "campaign",
                "cdp",
                "web-tracking",
            ],
            channels={
                "ccaas": [
                    "whatsapp",
                    "email",
                    "instagram",
                    "facebook",
                    "call",
                    "webchat",
                ]
            },
            features={"ccaas": ["wfm"]},
            version="dev:all",
        )
        _entitlements_cache[cache_key] = dev
        return dev

    empty = TenantEntitlements(
        organization_id=organization_id,
        skus=[],
        channels={},
        features={},
        version="empty",
    )
    _entitlements_cache[cache_key] = empty
    return empty


_SKU_TO_HUB_PRODUCT: dict[str, str] = {
    "contact-center": "contact_centre",
    "crm": "crm",
    "ticketing": "ticketing",
    "campaign": "campaign",
    "cdp": "cdp",
    "web-tracking": "webtracking",
}


_SPOKE_PRODUCT_SKU: dict[str, str] = {
    "contact_centre": "contact-center",
    "ccaas": "contact-center",
    "ticketing": "ticketing",
    "crm": "crm",
    "campaign": "campaign",
    "webtracking": "web-tracking",
    "cdp": "cdp",
}


def spoke_product_entitled(organization_id: int, product: str) -> bool:
    """True when org has purchased the spoke SKU (fail closed for unsubscribed spokes)."""
    from ontology.slice import normalize_product_id

    norm = normalize_product_id(product)
    sku = _SPOKE_PRODUCT_SKU.get(norm)
    if not sku:
        return True
    ent = load_tenant_entitlements(organization_id)
    if not ent.skus:
        return False
    return ent.has_sku(sku)


def intersect_hub_products(
    organization_id: int, requested_products: list[str]
) -> list[str]:
    """Hub body products[] intersected with entitled SKUs (catalog hub keys)."""
    from ontology.slice import get_catalog, normalize_hub_products

    ent = load_tenant_entitlements(organization_id)
    if not ent.skus:
        return []
    entitled_keys = {_SKU_TO_HUB_PRODUCT.get(sku, sku) for sku in ent.skus}
    try:
        normalized = normalize_hub_products(requested_products, get_catalog().catalog)
    except ValueError:
        return []
    return [p for p in normalized if p in entitled_keys]
