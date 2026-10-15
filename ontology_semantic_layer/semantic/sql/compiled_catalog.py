"""Load compiled SQL agent catalogs (marts + staging + joins + synonyms)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML required") from exc

COMPILED_DIR = Path(__file__).resolve().parents[1] / "catalog" / "compiled"
_cache: dict[str, dict[str, Any]] = {}


def clear_compiled_cache() -> None:
    _cache.clear()


def load_compiled_catalog(product: str) -> dict[str, Any]:
    """Return compiled catalog for product; falls back to SQL catalog slice."""
    from semantic.sql.product_aliases import normalize_sql_catalog_product

    key = normalize_sql_catalog_product(product)
    if key in _cache:
        return _cache[key]

    path = COMPILED_DIR / f"{key}.yml"
    if path.is_file():
        with path.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        _cache[key] = data
        return data

    # Fallback: derive a tight slice from the hand-maintained catalog.
    from semantic.sql.catalog_loader import load_product_catalog

    base = load_product_catalog(key)
    tables = []
    for tbl in base.get("tables") or []:
        if tbl.get("sql_agent_only") is True:
            continue
        tables.append(
            {
                "name": tbl.get("name"),
                "schema": tbl.get("schema") or base.get("default_schema"),
                "grain": tbl.get("grain"),
                "preferred_source": "mart",
                "sql_agent_read": True,
                "columns": [
                    c.get("name") if isinstance(c, dict) else str(c)
                    for c in (tbl.get("columns") or [])
                ],
                "semantic_dimensions": list(tbl.get("semantic_dimensions") or []),
            }
        )
    data = {
        "product": key,
        "engine": base.get("engine") or "postgres",
        "default_schema": base.get("default_schema"),
        "tenant_column": base.get("tenant_column") or "organization_id",
        "tables": tables,
        "synonyms": _default_synonyms(key),
    }
    _cache[key] = data
    return data


def planner_slice(product: str, *, max_tables: int = 12) -> dict[str, Any]:
    """Compact catalog view for LLM / planner prompts."""
    cat = load_compiled_catalog(product)
    tables = list(cat.get("tables") or [])[:max_tables]
    return {
        "product": cat.get("product"),
        "default_schema": cat.get("default_schema"),
        "synonyms": cat.get("synonyms") or {},
        "tables": [
            {
                "name": t.get("name"),
                "schema": t.get("schema"),
                "grain": t.get("grain"),
                "columns": (t.get("columns") or [])[:20],
            }
            for t in tables
        ],
    }


def _default_synonyms(product: str) -> dict[str, str]:
    common = {"team": "queue_name", "agent": "assignee_name"}
    if product == "ticketing":
        return {**common, "escalation": "action", "history": "audit_event"}
    if product == "ccaas":
        return {**common, "conversation": "mart_conversations"}
    return common


def warm_compiled_catalogs(products: tuple[str, ...] | None = None) -> list[str]:
    """Preload compiled catalogs at API start."""
    loaded: list[str] = []
    for product in products or (
        "ticketing",
        "ccaas",
        "crm",
        "campaign",
        "webtracking",
        "cdp",
    ):
        try:
            load_compiled_catalog(product)
            loaded.append(product)
        except Exception:
            pass
    return loaded
