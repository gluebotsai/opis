"""Product then tenant merge. Tenant files are optional."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

PACK_ROOT = Path(__file__).resolve().parent.parent
PRODUCT_DIR = PACK_ROOT / "product"
TENANTS_DIR = PACK_ROOT / "tenants"
ORGANIZATIONS_DIR = PACK_ROOT / "organizations"


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text()) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} must be a mapping")
    return data


def load_product() -> dict[str, Any]:
    return {
        "product": _read_yaml(PRODUCT_DIR / "product.yml"),
        "catalog": _read_yaml(PRODUCT_DIR / "catalog.yml"),
        "access": _read_yaml(PRODUCT_DIR / "access.yml"),
        "kpis": _read_yaml(PRODUCT_DIR / "kpis.yml"),
        "sql_dir": PRODUCT_DIR / "sql",
    }


def load_tenant(organization_id: str | int | None) -> dict[str, Any]:
    if organization_id is None:
        return {}
    name = f"org_{organization_id}"
    folders = [ORGANIZATIONS_DIR / name, TENANTS_DIR / name]
    folder = next((p for p in folders if p.is_dir()), None)
    if folder is None:
        return {}
    tenant_doc: dict[str, Any] = {}
    for fname in ("tenant.yml", "tenant_thresholds.yml"):
        path = folder / fname
        if path.exists():
            tenant_doc = _read_yaml(path)
            break
    return {
        "tenant": tenant_doc,
        "sql_dir": folder / "sql" if (folder / "sql").is_dir() else None,
    }


def _kpi_map(kpis_doc: dict[str, Any]) -> dict[str, Any]:
    raw = kpis_doc.get("kpis") or {}
    if not isinstance(raw, dict):
        raise ValueError("kpis.yml kpis must be a mapping")
    return dict(raw)


def merge_effective(organization_id: str | int | None) -> dict[str, Any]:
    product = load_product()
    tenant = load_tenant(organization_id)
    kpis = _kpi_map(product["kpis"])
    access = deepcopy(product["access"])
    overlay = tenant.get("tenant") or {}

    overrides = ((overlay.get("kpis") or {}).get("override")) or {}
    adds = ((overlay.get("kpis") or {}).get("add")) or {}
    if not isinstance(overrides, dict) or not isinstance(adds, dict):
        raise ValueError("tenant kpis.add / kpis.override must be mappings")

    for kpi_id in overrides:
        if kpi_id not in kpis:
            raise ValueError(f"tenant override of unknown KPI {kpi_id}")
        kpis.pop(kpi_id)
    kpis.update(overrides)
    for kpi_id, card in adds.items():
        if kpi_id in kpis and kpi_id not in overrides:
            raise ValueError(f"tenant add collides with product KPI {kpi_id}")
        kpis[kpi_id] = card

    tenant_access = overlay.get("access")
    if tenant_access:
        # Tighten only: overlay keys replace matching leaves; never introduce a wider grant.
        access = _tighten_access(access, tenant_access)

    sql_files = {p.stem: p for p in product["sql_dir"].glob("*.sql") if p.stem != "_base_ticket"}
    tenant_sql_dir = tenant.get("sql_dir")
    if tenant_sql_dir:
        for p in tenant_sql_dir.glob("*.sql"):
            sql_files[p.stem] = p

    missing = set(kpis) - set(sql_files)
    extra = set(sql_files) - set(kpis)
    if missing or extra:
        raise ValueError(f"KPI/SQL mismatch missing={sorted(missing)} extra={sorted(extra)}")

    kg = load_kg()
    return {
        "product": product["product"],
        "catalog": product["catalog"],
        "access": access,
        "kpis": kpis,
        "sql_files": sql_files,
        "base_ticket_sql": (product["sql_dir"] / "_base_ticket.sql").read_text(),
        "thresholds": overlay.get("thresholds") or {},
        "organization_id": organization_id,
        "kg_measures": kg["measures"],
        "kg_cypher_files": kg["cypher_files"],
        "kg_neo4j": kg["neo4j"],
        "kg_schema": kg["schema"],
        "kg_concepts": kg["concepts"],
    }


def load_kg() -> dict[str, Any]:
    kg_dir = PRODUCT_DIR / "kg"
    measures_doc = _read_yaml(kg_dir / "measures.yml")
    measures = measures_doc.get("measures") or {}
    if not isinstance(measures, dict):
        raise ValueError("product/kg/measures.yml measures must be a mapping")
    cypher_dir = kg_dir / "cypher"
    cypher_files = {p.stem: p for p in cypher_dir.glob("*.cypher")}
    missing = set(measures) - set(cypher_files)
    extra = set(cypher_files) - set(measures)
    if missing or extra:
        raise ValueError(f"KG measure/cypher mismatch missing={sorted(missing)} extra={sorted(extra)}")
    schema_path = kg_dir / "schema_registry.json"
    concepts_path = kg_dir / "concept_cards.json"
    schema = {}
    concepts: list[Any] = []
    if schema_path.exists():
        import json

        schema = json.loads(schema_path.read_text())
    if concepts_path.exists():
        import json

        concepts = json.loads(concepts_path.read_text())
    return {
        "measures": measures,
        "cypher_files": cypher_files,
        "neo4j": _read_yaml(kg_dir / "neo4j.yml"),
        "schema": schema,
        "concepts": concepts,
    }


def _tighten_access(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    out = deepcopy(base)
    matrix = overlay.get("matrix")
    if matrix:
        for level, roles in matrix.items():
            if level not in out.get("matrix", {}):
                raise ValueError(f"tenant access cannot add scope level {level}")
            for role, grant in roles.items():
                current = out["matrix"][level].get(role)
                if current == "deny":
                    continue
                if grant == "deny" or grant == "ticket_count_in_my_queues":
                    out["matrix"][level][role] = grant
                elif grant == current:
                    continue
                else:
                    raise ValueError(f"tenant access cannot widen {level}/{role} from {current} to {grant}")
    return out
