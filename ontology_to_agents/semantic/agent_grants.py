"""Runtime agent metric grants (ontology/agent_metrics.yml)."""

from __future__ import annotations

import fnmatch
from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

from ontology.slice import normalize_product_id
from semantic.metrics.catalog import list_product_metrics
from semantic.ownership import (
    agent_preset,
    is_reporting_mas_agent,
    list_certified_for_product,
    load_ownership,
    mas_catalog_for_agent,
    reporting_agent_for_product,
)

ROOT = Path(__file__).resolve().parents[1]
GRANTS_PATH = ROOT / "ontology" / "agent_metrics.yml"

_PRODUCT_KEYS = {
    "contact_centre": "contact_centre",
    "ccaas": "contact_centre",
    "aiccaas": "contact_centre",
    "ticketing": "ticketing",
    "crm": "crm",
    "campaign": "campaign",
    "cdp": "cdp",
    "webtracking": "webtracking",
}


@lru_cache(maxsize=1)
def load_grants() -> dict[str, Any]:
    if not GRANTS_PATH.is_file():
        return {}
    with GRANTS_PATH.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def clear_grants_cache() -> None:
    load_grants.cache_clear()


def _product_key(product: str | None) -> str:
    return _PRODUCT_KEYS.get(normalize_product_id(product or ""), normalize_product_id(product or ""))


def _agent_entry(agent_id: str, product: str) -> dict[str, Any] | None:
    cfg = load_grants()
    products = cfg.get("products") or {}
    bucket = products.get(_product_key(product)) or {}
    if agent_id in bucket:
        return bucket[agent_id]
    preset = agent_preset(agent_id)
    if preset and preset in bucket:
        return bucket[preset]
    return None


def headline_metrics_for_agent(agent_id: str | None, product: str | None = None) -> list[str]:
    if not agent_id:
        return []
    entry = _agent_entry(agent_id, product or "")
    if entry and entry.get("headlines"):
        return list(entry["headlines"])
    cfg = load_grants()
    headlines = cfg.get("headline_metrics") or {}
    preset = agent_preset(agent_id) or agent_id
    if preset in headlines:
        return list(headlines[preset])
    if agent_id in headlines:
        return list(headlines[agent_id])
    return []


def _expand_grant(spec: Any, product: str) -> list[str] | None:
    if spec == "*":
        ids = list_product_metrics(product)
        if ids:
            return ids
        return list_certified_for_product(product)
    if spec is None:
        return None
    if isinstance(spec, list):
        return [str(m) for m in spec]
    return []


def grant_candidates(agent_id: str | None, product: str) -> list[str] | None:
    """Metric id candidates for agent; None = use legacy slice/ownership path."""
    if not agent_id:
        return None
    if is_reporting_mas_agent(agent_id, product):
        mas = mas_catalog_for_agent(agent_id, product)
        return list(mas) if mas else []
    if not GRANTS_PATH.is_file():
        return None
    entry = _agent_entry(agent_id, product)
    if entry is None:
        preset = agent_preset(agent_id)
        rep = reporting_agent_for_product(product)
        if rep and preset == rep:
            return list_certified_for_product(product)
        return []
    return _expand_grant(entry.get("metrics"), product)


def webtracking_catalog_for_agent(agent_id: str) -> list[str] | None:
    ownership = load_ownership()
    mapping = (ownership.get("registry_reporting") or {}).get("webtracking")
    if mapping is None:
        return None
    all_web = list_certified_for_product("webtracking")
    # Compact aliases share the reporting catalog.
    aliases = {
        "webtracking.analytics",
        "webtracking.reporting_mas",
        "wt.reporting_mas",
    }
    if isinstance(mapping, str):
        if (
            agent_id == mapping
            or agent_preset(agent_id) == mapping
            or agent_id in aliases
            or agent_preset(agent_id) in aliases
        ):
            return all_web
        return None
    if not isinstance(mapping, dict) or agent_id not in mapping:
        if agent_id in aliases:
            return all_web
        return None
    patterns = mapping.get(agent_id) or []
    if "*" in patterns:
        return all_web
    return [
        m
        for m in all_web
        if any(fnmatch.fnmatch(m, pat) for pat in patterns)
    ]


def compute_agent_entitlements_from_grants() -> dict[str, list[str]]:
    cfg = load_grants()
    products = cfg.get("products") or {}
    out: dict[str, list[str]] = {}
    for product, agents in products.items():
        for agent_id, entry in (agents or {}).items():
            expanded = _expand_grant((entry or {}).get("metrics"), str(product))
            if expanded is not None:
                out[str(agent_id)] = sorted(set(expanded))
    return out
