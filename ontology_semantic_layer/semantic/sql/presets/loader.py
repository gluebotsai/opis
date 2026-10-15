"""Load runtime SQL agent presets (compact Super catalog + executor slices)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML required") from exc

from semantic.sql.compiled_catalog import load_compiled_catalog
from semantic.sql.product_aliases import normalize_sql_catalog_product

PRESETS_PATH = Path(__file__).resolve().parent / "catalog.yml"
_cache: dict[str, dict[str, Any]] | None = None


def clear_preset_cache() -> None:
    global _cache
    _cache = None


def _load_all() -> dict[str, dict[str, Any]]:
    global _cache
    if _cache is not None:
        return _cache
    with PRESETS_PATH.open(encoding="utf-8") as fh:
        doc = yaml.safe_load(fh) or {}
    _cache = {str(k): dict(v) for k, v in (doc.get("presets") or {}).items()}
    return _cache


def list_select_columns(
    intent: str,
    requested: list[str] | None,
    spec: dict[str, Any],
) -> list[str]:
    defaults = [str(c) for c in (spec.get("default_select") or []) if c]
    extras = [str(c) for c in (requested or []) if c]
    if str(intent or "list") != "list":
        return extras or defaults or ["*"]
    if not defaults:
        return extras or ["*"]
    seen: set[str] = set()
    out: list[str] = []
    for col in defaults + extras:
        if col in seen or col == "*":
            continue
        seen.add(col)
        out.append(col)
    return out or ["*"]


def load_preset(preset_id: str) -> dict[str, Any]:
    presets = _load_all()
    key = (preset_id or "").strip()
    if key not in presets:
        raise KeyError(f"Unknown preset '{preset_id}'")
    return presets[key]


def list_preset_summaries(*, product: str | None = None) -> list[dict[str, str]]:
    """Compact preset list for Super Gemma prompt."""
    presets = _load_all()
    prod = normalize_sql_catalog_product(product) if product else None
    out: list[dict[str, str]] = []
    for preset_id, spec in presets.items():
        p = str(spec.get("product") or "")
        if prod and p not in ("any", prod):
            continue
        out.append(
            {
                "preset_id": preset_id,
                "product": p,
                "purpose": str(spec.get("purpose") or ""),
            }
        )
    return out


def _table_meta(product: str, table_name: str) -> dict[str, Any] | None:
    cat = load_compiled_catalog(product)
    for tbl in cat.get("tables") or []:
        if tbl.get("name") == table_name:
            return tbl
    return None


def _joins_for_tables(product: str, tables: list[str]) -> list[dict[str, Any]]:
    cat = load_compiled_catalog(product)
    names = set(tables)
    out: list[dict[str, Any]] = []
    for join in cat.get("joins") or []:
        if join.get("from") in names or join.get("to") in names:
            out.append(join)
    return out


def preset_executor_slice(preset_id: str) -> dict[str, Any]:
    """Full columns/PK/FK slice for one preset (executor prompt)."""
    spec = load_preset(preset_id)
    product = str(spec.get("product") or "")
    tables = list(spec.get("tables") or [])
    if product == "any":
        return {
            "preset_id": preset_id,
            "product": product,
            "purpose": spec.get("purpose"),
            "certified_only": True,
            "templates": _certified_template_stubs(),
        }

    table_docs: list[dict[str, Any]] = []
    for name in tables:
        meta = _table_meta(product, name)
        if not meta:
            continue
        table_docs.append(
            {
                "name": name,
                "schema": meta.get("schema"),
                "grain": meta.get("grain"),
                "primary_key": meta.get("primary_key"),
                "foreign_keys": meta.get("foreign_keys") or [],
                "columns": list(meta.get("columns") or []),
                "row_scope_column": meta.get("row_scope_column"),
                "tenant_column": meta.get("tenant_column") or "organization_id",
            }
        )
    return {
        "preset_id": preset_id,
        "product": product,
        "purpose": spec.get("purpose"),
        "default_table": spec.get("default_table"),
        "default_select": list(spec.get("default_select") or []),
        "tables": table_docs,
        "joins": _joins_for_tables(product, tables),
        "templates": _certified_template_stubs(product) if spec.get("certified_only") else [],
    }


def _certified_template_stubs(product: str | None = None) -> list[dict[str, str]]:
    from semantic.sql.metric_template_registry import list_templates

    stubs: list[dict[str, str]] = []
    products = [product] if product and product != "any" else (
        "ticketing",
        "ccaas",
        "crm",
        "campaign",
        "webtracking",
    )
    for prod in products:
        for mid, spec in (list_templates(prod) or {}).items():
            stubs.append(
                {
                    "template_id": mid,
                    "product": prod,
                    "table": str(spec.get("table") or ""),
                    "result_column": str(spec.get("result_column") or mid),
                }
            )
    return stubs


def warm_presets() -> list[str]:
    return list(_load_all().keys())
