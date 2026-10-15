"""Metric scope policies for SQL agent (ontology/metric_policies.yml only)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

POLICIES_PATH = Path(__file__).resolve().parents[1] / "ontology" / "metric_policies.yml"

_policies_cache: dict[str, Any] | None = None

_PRODUCT_ALIASES: dict[str, str] = {
    "contact_centre": "ccaas",
    "contact-center": "ccaas",
    "aiccaas": "ccaas",
    "ccaas": "ccaas",
    "crm": "crm",
    "ticketing": "ticketing",
    "campaign": "campaign",
    "webtracking": "webtracking",
    "web-tracking": "webtracking",
    "cdp": "cdp",
}


def _normalize_product(product: str | None) -> str | None:
    if not product:
        return None
    key = str(product).strip().lower().replace("-", "_")
    return _PRODUCT_ALIASES.get(key, key)


def _load_policies() -> dict[str, Any]:
    global _policies_cache
    if _policies_cache is None:
        with POLICIES_PATH.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        _policies_cache = data.get("metrics") or {}
    return _policies_cache


def clear_policies_cache() -> None:
    global _policies_cache
    _policies_cache = None


def get_metric_policy(metric_id: str, product: str | None = None) -> dict[str, Any]:
    raw = dict(_load_policies().get(metric_id) or {})
    if "on" not in raw and True in raw:
        raw["on"] = raw.pop(True)

    norm = _normalize_product(product)
    overlay: dict[str, Any] | None = None
    if norm:
        products_block = raw.get("products") or {}
        overlay = products_block.get(norm) or products_block.get(product or "")

    merged = {**raw, **(overlay or {})}
    merged.pop("products", None)
    return merged
