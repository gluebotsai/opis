"""Resolve certified metric ids for ask_semantic / get_metric_schema.

Formulas stay in MetricFlow YAML. This module only maps agent ids → source metric.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

SEMANTIC_DIR = Path(__file__).resolve().parent
REGISTRY_PATH = SEMANTIC_DIR / "metric_registry.yml"
POLICIES_PATH = Path(__file__).resolve().parents[1] / "ontology" / "metric_policies.yml"

_policies_cache: dict[str, Any] | None = None
_registry_cache: dict[str, Any] | None = None

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
    """Drop cached metric_policies.yml (reload on next get_metric_policy)."""
    global _policies_cache
    _policies_cache = None


def clear_registry_cache() -> None:
    """Drop cached metric_registry.yml (reload on next get_metric_schema)."""
    global _registry_cache
    _registry_cache = None


def warm_lookup_caches() -> None:
    """Load policies + registry into memory (API startup)."""
    _load_policies()
    _load()


def get_metric_policy(metric_id: str, product: str | None = None) -> dict[str, Any]:
    raw = dict(_load_policies().get(metric_id) or {})
    # YAML 1.1 treats unquoted `on:` as boolean True — normalize for callers.
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


def get_allowed_dims(metric_id: str, product: str | None = None) -> list[str]:
    policy = get_metric_policy(metric_id, product=product)
    dims = [str(d) for d in (policy.get("dims") or policy.get("group_by") or [])]
    norm = _normalize_product(product)
    if norm in ("webtracking",):
        from semantic.sql.webtracking_dim_catalog import webtracking_catalog_dims

        merged = list(dict.fromkeys([*dims, *webtracking_catalog_dims()]))
        return merged
    return dims


def _load() -> dict[str, Any]:
    global _registry_cache
    if _registry_cache is None:
        with REGISTRY_PATH.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        if not isinstance(data, dict):
            raise ValueError(f"{REGISTRY_PATH} must contain a YAML mapping")
        _registry_cache = data
    return _registry_cache


_PRODUCT_TO_REGISTRY_SOURCE: dict[str, str] = {
    "ccaas": "aiccaas",
    "contact_centre": "aiccaas",
    "contact_center": "aiccaas",
    "aiccaas": "aiccaas",
    "crm": "crm",
    "ticketing": "ticketing",
    "campaign": "campaign",
    "webtracking": "webtracking",
    "web_tracking": "webtracking",
    "cdp": "cdp",
}


def resolve_metric_alias(metric_id: str) -> str:
    """Map legacy/alias metric ids to canonical registry keys when needed."""
    registry = _load().get("metrics") or {}
    row = registry.get(metric_id) or {}
    alias = row.get("alias_of")
    if alias and alias in registry:
        return str(alias)
    return metric_id


def get_metric_schema(metric_id: str, product: str | None = None) -> dict[str, Any]:
    """Return registry row for an agent-facing metric id.

    Raises ValueError if unknown. Callers should reject uncertified ids
    before hitting MetricFlow.
    """
    registry = _load().get("metrics") or {}
    if metric_id not in registry:
        known = ", ".join(sorted(registry))
        raise ValueError(f"Unknown metric '{metric_id}'. Known: {known}")
    row = dict(registry[metric_id])
    if not row.get("source_metric"):
        row["source_metric"] = metric_id
    sources = row.get("sources")
    norm = _normalize_product(product)
    if sources and norm:
        source_key = _PRODUCT_TO_REGISTRY_SOURCE.get(norm, norm)
        src_row = sources.get(source_key)
        if src_row:
            row = {**row, **src_row, "source": source_key}
    row["id"] = metric_id
    return row


def is_certified(metric_id: str) -> bool:
    try:
        from semantic.metrics.catalog import is_in_catalog

        if is_in_catalog(metric_id):
            return True
    except Exception:
        pass
    try:
        return bool(get_metric_schema(metric_id).get("certified"))
    except ValueError:
        return False


def list_certified() -> list[str]:
    try:
        from semantic.metrics.catalog import list_product_metrics

        seen: set[str] = set()
        for prod in ("ticketing", "ccaas", "crm", "campaign", "webtracking"):
            for mid in list_product_metrics(prod):
                seen.add(mid)
        if seen:
            return sorted(seen)
    except Exception:
        pass
    metrics = _load().get("metrics") or {}
    return [
        k
        for k, v in metrics.items()
        if isinstance(v, dict) and v.get("certified") and v.get("prompt") is not False
    ]
