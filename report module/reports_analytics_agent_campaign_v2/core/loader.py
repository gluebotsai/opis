"""Product YAML load. No KG files in this build."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import yaml

PACK_ROOT = Path(__file__).resolve().parent.parent
PRODUCT_DIR = PACK_ROOT / "product"
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
        "access": _read_yaml(PRODUCT_DIR / "access.yml"),
        "kpis": _read_yaml(PRODUCT_DIR / "kpis.yml"),
        "dimensions": _read_yaml(PRODUCT_DIR / "dimensions.yml"),
        "sql_dir": PRODUCT_DIR / "sql",
    }


def _kpi_map(kpis_doc: dict[str, Any]) -> dict[str, Any]:
    raw = kpis_doc.get("kpis") or {}
    if not isinstance(raw, dict):
        raise ValueError("kpis.yml kpis must be a mapping")
    return dict(raw)


def merge_effective(organization_id: str | int | None) -> dict[str, Any]:
    product = load_product()
    kpis = _kpi_map(product["kpis"])
    access = deepcopy(product["access"])
    sql_files = {
        p.stem: p
        for p in product["sql_dir"].glob("*.sql")
        if not p.stem.startswith("_")
    }
    missing = set(kpis) - set(sql_files)
    extra = set(sql_files) - set(kpis)
    if missing or extra:
        raise ValueError(f"KPI/SQL mismatch missing={sorted(missing)} extra={sorted(extra)}")
    base_campaign = (product["sql_dir"] / "_base_campaign.sql").read_text()
    delivery = (product["sql_dir"] / "_delivery_outcome.sql").read_text()
    return {
        "product": product["product"],
        "access": access,
        "kpis": kpis,
        "dimensions": product["dimensions"],
        "sql_files": sql_files,
        "base_campaign_sql": base_campaign,
        "delivery_outcome_sql": delivery,
        "organization_id": organization_id,
    }
