"""Per-product metric SQL template registry for fallback execution."""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML required") from exc

_DIR = Path(__file__).resolve().parent / "kpi_templates"
_LEGACY = Path(__file__).resolve().parent / "metric_templates.yml"
_cache: dict[str, dict[str, Any]] = {}

# Per-metric execution metadata when not in template file
_METRIC_META: dict[str, dict[str, str]] = {
    "total_conversations": {
        "table": "mart_conversations",
        "time_column": "created_at",
        "row_scope_column": "assigned_agent_id",
    },
    "open_conversations": {
        "table": "mart_conversations",
        "time_column": "created_at",
        "row_scope_column": "assigned_agent_id",
    },
    "ai_containment_rate": {
        "table": "mart_conversations",
        "time_column": "created_at",
        "row_scope_column": "assigned_agent_id",
    },
    "average_handle_time": {
        "table": "mart_conversation_assignments",
        "time_column": "offered_at",
        "row_scope_column": "agent_id",
    },
    "missed_contact_rate": {
        "table": "mart_conversation_assignments",
        "time_column": "offered_at",
        "row_scope_column": "agent_id",
    },
    "sla_breach_rate": {
        "table": "mart_conversation_sla_state",
        "time_column": "updated_at",
        "row_scope_column": "",
    },
    "open_tickets_metric": {
        "table": "tickets",
        "time_column": "created_at",
        "row_scope_column": "assignee_id",
    },
    "sla_breach_rate_ticketing": {
        "table": "tickets",
        "time_column": "created_at",
        "row_scope_column": "assignee_id",
    },
}


def _load_product(product: str) -> dict[str, Any]:
    from sql_agent.product_aliases import normalize_sql_catalog_product

    key = normalize_sql_catalog_product(product)
    if key in _cache:
        return _cache[key]
    metrics: dict[str, Any] = {}
    path = _DIR / f"{key}.yml"
    if path.is_file():
        with path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        metrics = dict(data.get("metrics") or {})
    if key == "ccaas" and _LEGACY.is_file() and not metrics:
        with _LEGACY.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        metrics = dict(data.get("metrics") or {})
    _cache[key] = {"metrics": metrics}
    return _cache[key]


def list_templates(product: str) -> dict[str, Any]:
    """Return all metric templates for a product."""
    from sql_agent.product_aliases import normalize_sql_catalog_product

    product = normalize_sql_catalog_product(product)
    return dict(_load_product(product).get("metrics") or {})


def get_template(product: str, metric_id: str) -> dict[str, Any] | None:
    from sql_agent.product_aliases import normalize_sql_catalog_product

    product = normalize_sql_catalog_product(product)
    spec = (_load_product(product).get("metrics") or {}).get(metric_id)
    if not spec:
        return None
    meta = dict(_METRIC_META.get(metric_id) or {})
    return {**meta, **spec}


def clear_template_cache() -> None:
    _cache.clear()


def metric_meta(metric_id: str) -> dict[str, str]:
    return dict(_METRIC_META.get(metric_id) or {})
