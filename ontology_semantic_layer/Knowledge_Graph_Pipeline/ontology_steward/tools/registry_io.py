"""Load steward registry files (types, promotion, taxonomy router, stop keys)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

STEWARD_ROOT = Path(__file__).resolve().parent.parent
REGISTRY_DIR = STEWARD_ROOT / "registry"
PROJECT_ROOT = STEWARD_ROOT.parent.parent
ENTITIES_PATH = PROJECT_ROOT / "ontology" / "definitions" / "entities.yml"

_entities_cache: dict[str, Any] | None = None


def _load(name: str) -> dict[str, Any]:
    path = REGISTRY_DIR / name
    if not path.exists():
        return {}
    with path.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    return data if isinstance(data, dict) else {}


def load_types() -> list[dict[str, Any]]:
    return list(_load("types.yml").get("types") or [])


def load_taxonomy_router() -> dict[str, Any]:
    return _load("taxonomy_router.yml")


def load_promotions() -> list[dict[str, Any]]:
    return list(_load("promotion.yml").get("promotions") or [])


def add_promotion(
    class_id: str,
    org: str,
    industry: str = "",
    graph_label: str = "",
) -> None:
    path = REGISTRY_DIR / "promotion.yml"
    doc = _load("promotion.yml")
    promotions = list(doc.get("promotions") or [])
    if any(p.get("class_id") == class_id for p in promotions):
        return
    promotions.append(
        {
            "class_id": class_id,
            "minted_by_org": org,
            "industry": industry,
            "graph_label": graph_label,
            "status": "tenant_only",
        }
    )
    doc["promotions"] = promotions
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(doc, fh, default_flow_style=False, sort_keys=False)


def load_stop_keys(org: str | None = None) -> set[str]:
    doc = _load("stop_keys.yml")
    keys = set(doc.get("global") or [])
    if org:
        by_org = doc.get("by_org") or {}
        for entry in by_org.get(org, []) or []:
            if isinstance(entry, str):
                keys.add(entry)
            elif isinstance(entry, dict) and entry.get("key"):
                keys.add(str(entry["key"]))
    return keys


def save_stop_keys(doc: dict[str, Any]) -> None:
    path = REGISTRY_DIR / "stop_keys.yml"
    with path.open("w", encoding="utf-8") as fh:
        yaml.safe_dump(doc, fh, default_flow_style=False, sort_keys=False)


def add_stop_key(org: str, table: str, key: str) -> None:
    doc = _load("stop_keys.yml")
    by_org = doc.setdefault("by_org", {})
    entries = list(by_org.get(org) or [])
    record = {"key": key, "table": table}
    if record not in entries and key not in {e.get("key") if isinstance(e, dict) else e for e in entries}:
        entries.append(record)
    by_org[org] = entries
    save_stop_keys(doc)


def load_entities_definitions() -> dict[str, Any]:
    """Read-only human ontology definitions (not stored on Neo4j nodes)."""
    global _entities_cache
    if _entities_cache is not None:
        return _entities_cache
    if not ENTITIES_PATH.exists():
        _entities_cache = {}
        return _entities_cache
    with ENTITIES_PATH.open(encoding="utf-8") as fh:
        data = yaml.safe_load(fh) or {}
    _entities_cache = data if isinstance(data, dict) else {}
    return _entities_cache


def entity_by_id(entity_id: str) -> dict[str, Any] | None:
    entities = (load_entities_definitions().get("entities") or {})
    return entities.get(entity_id)


def entity_for_table(table: str) -> dict[str, Any] | None:
    doc = load_entities_definitions()
    entities = doc.get("entities") or {}
    for spec in entities.values():
        if not isinstance(spec, dict):
            continue
        pg = spec.get("postgres_table")
        if pg == table:
            return spec
        if isinstance(pg, list) and table in pg:
            return spec
    for entry in doc.get("tables_excluded_from_graph") or []:
        if isinstance(entry, dict) and entry.get("table") == table:
            return {"postgres_table": table, "in_graph": False, "reason": entry.get("reason")}
    return None


def in_graph_labels() -> set[str]:
    entities = load_entities_definitions().get("entities") or {}
    out: set[str] = set()
    for spec in entities.values():
        if isinstance(spec, dict) and spec.get("in_graph") and spec.get("graph_label"):
            out.add(str(spec["graph_label"]))
    return out


def search_entities(query: str, limit: int = 10) -> list[dict[str, Any]]:
    q = query.lower()
    scored: list[tuple[int, tuple[str, dict]]] = []
    for eid, spec in (load_entities_definitions().get("entities") or {}).items():
        if not isinstance(spec, dict):
            continue
        hay = " ".join(
            str(spec.get(k, "")) for k in ("definition", "graph_label", "postgres_table")
        ).lower() + f" {eid.lower()}"
        score = sum(1 for token in q.split() if token in hay)
        if score or q in hay:
            scored.append((score, (eid, spec)))
    scored.sort(key=lambda x: -x[0])
    return [{"id": eid, **spec} for _, (eid, spec) in scored[:limit]]


def search_types(query: str, limit: int = 10) -> list[dict[str, Any]]:
    q = query.lower()
    scored: list[tuple[int, dict]] = []
    for t in load_types():
        hay = " ".join(
            str(t.get(k, "")) for k in ("class_id", "graph_label", "definition", "pack")
        ).lower()
        score = sum(1 for token in q.split() if token in hay)
        if score or q in hay:
            scored.append((score, t))
    scored.sort(key=lambda x: -x[0])
    return [t for _, t in scored[:limit]]


def route_for_industry(industry_type: str) -> tuple[str, dict[str, Any]]:
    router = load_taxonomy_router()
    it = (industry_type or "").lower().replace(" ", "_").replace("-", "_")
    for name, spec in (router.get("routes") or {}).items():
        for hint in spec.get("industry_types") or []:
            if hint.replace(" ", "_").replace("-", "_") in it or it in hint.replace(" ", "_"):
                return name, spec
    if "health" in it and "retail" not in it:
        return "healthcare_clinical", router["routes"]["healthcare_clinical"]
    if "auto" in it or "vehicle" in it or "fleet" in it or "dealer" in it:
        return "automotive_fleet", router["routes"]["automotive_fleet"]
    default = router.get("default_route", "ecommerce")
    return default, router["routes"][default]
