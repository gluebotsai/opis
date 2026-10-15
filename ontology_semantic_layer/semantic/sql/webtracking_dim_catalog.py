"""Union of categorical dimensions from webtracking semantic_layer.yml.

Used so every certified webtracking metric can group_by / filter catalog dims.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required") from exc

SEMANTIC_LAYER_PATH = (
    Path(__file__).resolve().parents[1]
    / "dbt"
    / "webtracking"
    / "default"
    / "dbt"
    / "models"
    / "semantic_layer"
    / "semantic_layer.yml"
)

# Prefer session grain when a dim exists on multiple models.
_MART_PRIORITY = (
    "mart_web_sessions",
    "mart_page_views",
    "mart_form_events",
    "mart_conversion_events",
    "mart_interaction_events",
    "mart_web_visitors",
    "mart_product_interactions",
    "mart_performance_events",
    "mart_error_events",
    "mart_custom_events",
    "mart_cookie_operations",
    "mart_replay_chunks",
    "mart_web_sites",
    "mart_known_users",
    "mart_ecommerce_daily",
)

_SKIP_DIMS = frozenset(
    {
        "organization_id",
        "website_id",  # injected by extra_where, not a chat group_by
    }
)

_JOIN_KEYS = ("session_id", "visitor_id")


class DimensionNotJoinable(ValueError):
    def __init__(self, dimension: str, table: str) -> None:
        super().__init__(
            f"Dimension '{dimension}' is not joinable onto '{table}'."
        )
        self.code = "dimension_not_joinable"
        self.dimension = dimension
        self.table = table


def _ref_to_mart(ref: str) -> str:
    text = str(ref or "").strip()
    # ref('mart_web_sessions')
    if "ref(" in text:
        inner = text.split("ref(", 1)[-1]
        inner = inner.strip(" )")
        return str(inner).strip("'\"")
    return text


@lru_cache(maxsize=1)
def load_webtracking_dim_catalog() -> dict[str, Any]:
    raw = yaml.safe_load(SEMANTIC_LAYER_PATH.read_text(encoding="utf-8")) or {}
    mart_dims: dict[str, set[str]] = {}
    dim_to_marts: dict[str, list[str]] = {}
    for model in raw.get("semantic_models") or []:
        mart = _ref_to_mart(str(model.get("model") or ""))
        if not mart:
            continue
        cols: set[str] = set(mart_dims.get(mart) or set())
        for dim in model.get("dimensions") or []:
            name = str(dim.get("name") or "").strip()
            dtype = str(dim.get("type") or "").strip().lower()
            if not name or dtype == "time" or name in _SKIP_DIMS:
                continue
            cols.add(name)
            dim_to_marts.setdefault(name, [])
            if mart not in dim_to_marts[name]:
                dim_to_marts[name].append(mart)
        for ent in model.get("entities") or []:
            expr = str(ent.get("expr") or ent.get("name") or "").strip()
            if expr and expr not in _SKIP_DIMS:
                cols.add(expr)
        mart_dims[mart] = cols

    def _owner(dim: str) -> str | None:
        marts = dim_to_marts.get(dim) or []
        for preferred in _MART_PRIORITY:
            if preferred in marts:
                return preferred
        return marts[0] if marts else None

    dim_to_mart = {d: _owner(d) for d in dim_to_marts if _owner(d)}
    all_dims = sorted(dim_to_mart.keys())
    return {
        "dims": all_dims,
        "mart_dims": {k: frozenset(v) for k, v in mart_dims.items()},
        "dim_to_mart": dim_to_mart,
    }


def webtracking_catalog_dims() -> list[str]:
    return list(load_webtracking_dim_catalog()["dims"])


def mart_has_dim(table: str, dim: str) -> bool:
    catalog = load_webtracking_dim_catalog()
    cols = catalog["mart_dims"].get(table) or frozenset()
    return dim in cols


def owner_mart_for_dim(dim: str) -> str | None:
    return load_webtracking_dim_catalog()["dim_to_mart"].get(dim)


def join_key_for_tables(metric_table: str, owner_table: str) -> str | None:
    catalog = load_webtracking_dim_catalog()
    left = catalog["mart_dims"].get(metric_table) or frozenset()
    right = catalog["mart_dims"].get(owner_table) or frozenset()
    for key in _JOIN_KEYS:
        if key in left and key in right:
            return key
    return None
