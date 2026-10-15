"""Load semantic/metrics/<product>.yml catalogs."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required: pip install pyyaml") from exc

from ontology.slice import normalize_product_id

METRICS_DIR = Path(__file__).resolve().parent

_PRODUCT_ALIASES = {
    "contact_centre": "ccaas",
    "ccaas": "ccaas",
    "aiccaas": "ccaas",
    "ticketing": "ticketing",
    "crm": "crm",
    "campaign": "campaign",
    "webtracking": "webtracking",
    "web-tracking": "webtracking",
}


def _catalog_path(product: str) -> Path:
    key = _PRODUCT_ALIASES.get(normalize_product_id(product), normalize_product_id(product))
    direct = METRICS_DIR / f"{key}.yml"
    if direct.is_file():
        return direct
    tpl = Path(__file__).resolve().parents[1] / "sql" / "metric_templates" / f"{key}.yml"
    if tpl.is_file():
        return tpl
    return direct


@lru_cache(maxsize=16)
def _load_product_catalog(product: str) -> dict[str, Any]:
    path = _catalog_path(product)
    if not path.is_file():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return data.get("metrics") or {}


def clear_metrics_catalog_cache() -> None:
    _load_product_catalog.cache_clear()
    _all_catalog_metric_ids.cache_clear()


def list_product_metrics(product: str) -> list[str]:
    metrics = _load_product_catalog(product)
    return sorted(str(k) for k in metrics.keys())


def get_product_metric(metric_id: str, product: str) -> dict[str, Any] | None:
    row = _load_product_catalog(product).get(metric_id)
    return dict(row) if isinstance(row, dict) else None


@lru_cache(maxsize=1)
def _all_catalog_metric_ids() -> frozenset[str]:
    seen: set[str] = set()
    for prod in ("ticketing", "ccaas", "crm", "campaign", "webtracking", "cdp"):
        seen.update(list_product_metrics(prod))
    return frozenset(seen)


def is_in_catalog(metric_id: str) -> bool:
    return metric_id in _all_catalog_metric_ids()


def get_sql_template(product: str, metric_id: str) -> dict[str, Any] | None:
    row = get_product_metric(metric_id, product)
    if not row or not row.get("sql"):
        return None
    return row


def warm_metrics_catalog() -> None:
    """Preload all product metric YAML catalogs."""
    for prod in ("ticketing", "ccaas", "crm", "campaign", "webtracking", "cdp"):
        _load_product_catalog(prod)
    _all_catalog_metric_ids()
