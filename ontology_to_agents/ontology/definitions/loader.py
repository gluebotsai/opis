"""Read-only loader for human entity definitions (replaces legacy graph_definitions)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError as exc:  # pragma: no cover
    raise ImportError("PyYAML is required") from exc

DEFINITIONS_PATH = Path(__file__).resolve().parent / "entities.yml"
_CACHE: dict[str, Any] | None = None


def load_definitions() -> dict[str, Any]:
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    if not DEFINITIONS_PATH.exists():
        _CACHE = {}
        return _CACHE
    with DEFINITIONS_PATH.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    _CACHE = data if isinstance(data, dict) else {}
    return _CACHE


def entity_definition(entity_id: str) -> dict[str, Any] | None:
    entities = load_definitions().get("entities") or {}
    spec = entities.get(entity_id)
    return spec if isinstance(spec, dict) else None


def taxonomy_terms(axis: str) -> list[str]:
    tax = (load_definitions().get("taxonomies") or {}).get(axis) or {}
    return list(tax.get("terms") or [])


RELATIONS_PATH = Path(__file__).resolve().parent / "relations.yml"
_RELATIONS_CACHE: list[dict[str, Any]] | None = None


def load_relations() -> list[dict[str, Any]]:
    global _RELATIONS_CACHE
    if _RELATIONS_CACHE is not None:
        return _RELATIONS_CACHE
    if not RELATIONS_PATH.exists():
        _RELATIONS_CACHE = []
        return _RELATIONS_CACHE
    with RELATIONS_PATH.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    rows = data.get("relations") or []
    _RELATIONS_CACHE = [r for r in rows if isinstance(r, dict)]
    return _RELATIONS_CACHE


def agent_visible_relations(product: str | None = None) -> list[dict[str, Any]]:
    rows = load_relations()
    if not product:
        return [r for r in rows if r.get("in_agent_slice")]
    return [
        r
        for r in rows
        if r.get("in_agent_slice") and (not r.get("product") or r.get("product") == product)
    ]
