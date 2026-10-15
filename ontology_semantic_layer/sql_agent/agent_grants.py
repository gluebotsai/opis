"""Agent metric grants for SQL agent policy (ontology YAML only)."""

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
from sql_agent.kpi_template_registry import list_templates
from sql_agent.ownership import agent_preset

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


def _product_key(product: str | None) -> str:
    return _PRODUCT_KEYS.get(
        normalize_product_id(product or ""),
        normalize_product_id(product or ""),
    )


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


def _expand_grant(spec: Any, product: str) -> list[str] | None:
    if spec == "*":
        return list(list_templates(product).keys())
    if spec is None:
        return None
    if isinstance(spec, list):
        return [str(m) for m in spec]
    return []


def grant_candidates(agent_id: str | None, product: str) -> list[str] | None:
    if not agent_id:
        return None
    if not GRANTS_PATH.is_file():
        return list(list_templates(product).keys())
    entry = _agent_entry(agent_id, product)
    if entry is None:
        return list(list_templates(product).keys())
    expanded = _expand_grant(entry.get("metrics"), product)
    return expanded if expanded is not None else list(list_templates(product).keys())


def visible_metrics_for_agent(agent_id: str, product: str) -> set[str]:
    candidates = grant_candidates(agent_id, product)
    if candidates is None:
        return set(list_templates(product).keys())
    return set(candidates)
