"""Metric capability catalog — product, engine, entitlements, role gates.

Formulas stay in MetricFlow. Capabilities drive slice packing and query enforcement.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

from semantic.lookup import get_metric_policy, get_metric_schema

CAPABILITIES_PATH = (
    Path(__file__).resolve().parents[1] / "ontology" / "metric_capabilities.yml"
)

_ROLE_RANK: dict[str, int] = {
    "agent": 1,
    "supervisor": 2,
    "manager": 2,
    "team_lead": 2,
    "admin": 3,
}

_SOURCE_TO_PRODUCT: dict[str, str] = {
    "aiccaas": "ccaas",
    "crm": "crm",
    "ticketing": "ticketing",
    "campaign": "campaign",
    "webtracking": "webtracking",
}

_SOURCE_TO_SKU: dict[str, str] = {
    "aiccaas": "contact-center",
    "crm": "crm",
    "ticketing": "ticketing",
    "campaign": "campaign",
    "webtracking": "web-tracking",
    "cdp": "cdp",
}

_CHANNEL_CLONE_METRICS: dict[str, list[str]] = {
    "whatsapp_volume": ["whatsapp"],
    "instagram_volume": ["instagram"],
    "facebook_volume": ["facebook"],
    "email_volume": ["email"],
    "call_volume": ["call", "voice"],
    "webchat_volume": ["webchat"],
    "social_media_volume": ["whatsapp", "instagram", "facebook"],
}

_SUPERVISOR_METRICS: frozenset[str] = frozenset(
    {
        "human_agent_occupancy_rate_presence",
        "human_agent_occupancy_rate_capacity",
        "total_active_agent_count",
        "total_agent_capacity",
    }
)

_WFM_FEATURE_METRICS: frozenset[str] = frozenset(
    {
        "human_agent_occupancy_rate_presence",
        "human_agent_occupancy_rate_capacity",
    }
)

_capabilities_cache: dict[str, Any] | None = None


def clear_capabilities_cache() -> None:
    global _capabilities_cache
    _capabilities_cache = None


def _load_overrides() -> dict[str, Any]:
    global _capabilities_cache
    if _capabilities_cache is None:
        if CAPABILITIES_PATH.is_file():
            with CAPABILITIES_PATH.open(encoding="utf-8") as fh:
                data = yaml.safe_load(fh) or {}
            _capabilities_cache = data.get("metrics") or {}
        else:
            _capabilities_cache = {}
    return _capabilities_cache


def role_rank(role: str | None) -> int:
    if not role:
        return _ROLE_RANK["agent"]
    key = str(role).strip().lower().replace(" ", "_").replace("/", "_")
    if key in _ROLE_RANK:
        return _ROLE_RANK[key]
    for name, rank in _ROLE_RANK.items():
        if name in key:
            return rank
    return _ROLE_RANK["agent"]


def get_metric_capabilities(
    metric_id: str, product: str | None = None
) -> dict[str, Any]:
    """Return capability dict for a certified metric (explicit override + inference)."""
    from ontology.slice import normalize_product_id

    overrides = _load_overrides().get(metric_id) or {}
    req_norm = normalize_product_id(product) if product else None
    if overrides.get("capabilities"):
        cap = dict(overrides["capabilities"])
    elif isinstance(overrides, dict) and overrides.get("product"):
        override_prod = normalize_product_id(str(overrides["product"]))
        if req_norm and override_prod != req_norm:
            try:
                schema_probe = get_metric_schema(metric_id, product=req_norm)
                if schema_probe.get("sources"):
                    cap = {k: v for k, v in overrides.items() if k != "product"}
                else:
                    cap = dict(overrides)
            except ValueError:
                cap = dict(overrides)
        else:
            cap = dict(overrides)
    else:
        cap = {}

    try:
        schema = get_metric_schema(metric_id, product=product)
        source = str(schema.get("source") or "")
        if not source and schema.get("sources"):
            for src_key in schema["sources"]:
                source = str(src_key)
                break
    except ValueError:
        source = ""

    product = cap.get("product") or _SOURCE_TO_PRODUCT.get(source, source or "ccaas")
    engine = cap.get("engine") or (
        "clickhouse" if product == "webtracking" else "postgres"
    )
    requires_skus = cap.get("requires_skus")
    if requires_skus is None:
        sku = _SOURCE_TO_SKU.get(source)
        requires_skus = [sku] if sku else []

    requires_channels = cap.get("requires_channels")
    if requires_channels is None:
        requires_channels = list(_CHANNEL_CLONE_METRICS.get(metric_id, []))

    requires_features = list(cap.get("requires_features") or [])
    if metric_id in _WFM_FEATURE_METRICS and "wfm" not in requires_features:
        requires_features.append("wfm")

    min_role = cap.get("min_role")
    if min_role is None:
        min_role = "supervisor" if metric_id in _SUPERVISOR_METRICS else "agent"

    channel_scoped = cap.get("channel_scoped")
    if channel_scoped is None:
        policy = get_metric_policy(metric_id, product=product)
        dims = policy.get("dims") or policy.get("group_by") or []
        channel_scoped = (
            "channel" in dims
            and metric_id not in _CHANNEL_CLONE_METRICS
            and product in ("ccaas", "campaign", "contact_centre")
        )

    grain = cap.get("grain") or (
        "contact" if str(metric_id).startswith(("crm_", "cca_", "cmp_", "tk_", "web_"))
        else "operational"
    )

    return {
        "product": product,
        "engine": engine,
        "grain": grain,
        "requires_skus": [str(s) for s in requires_skus],
        "requires_channels": [str(c) for c in requires_channels],
        "requires_features": [str(f) for f in requires_features],
        "min_role": str(min_role),
        "channel_scoped": bool(channel_scoped),
    }


def resolve_execution_product(
    metric_ids: list[str], request_product: str
) -> tuple[str, str]:
    """Return (capability_product, engine) for manifest routing."""
    from ontology.slice import normalize_product_id

    if not metric_ids:
        raise ValueError("metric_ids required")

    req = normalize_product_id(request_product)
    products: list[str] = []
    engines: list[str] = []
    for mid in metric_ids:
        cap = get_metric_capabilities(mid, product=req)
        cap_prod = normalize_product_id(str(cap.get("product") or req))
        products.append(cap_prod)
        engines.append(str(cap.get("engine") or "postgres"))

    if len(set(products)) > 1:
        raise ValueError(
            "Cannot combine metrics from different products in one query."
        )
    if len(set(engines)) > 1:
        raise ValueError(
            "Cannot combine metrics from different engines in one query."
        )

    cap_product = products[0]
    engine = engines[0]
    if cap_product != req:
        raise ValueError(
            f"Metric(s) require product '{cap_product}', not '{req}'."
        )
    return cap_product, engine
