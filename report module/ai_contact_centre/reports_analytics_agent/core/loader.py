"""Load this pack's product/ YAML. Do not read another spoke's catalog."""

from __future__ import annotations

from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

PACK_ROOT = Path(__file__).resolve().parent.parent
PRODUCT_DIR = PACK_ROOT / "product"


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
        "schema": _read_yaml(PRODUCT_DIR / "schema.yml"),
        "intake": _read_yaml(PRODUCT_DIR / "intake.yml"),
        "sql_dir": PRODUCT_DIR / "sql",
        "hitl_dir": PRODUCT_DIR / "hitl",
    }


@lru_cache(maxsize=8)
def hitl_object(kpi_id: str) -> str:
    path = PRODUCT_DIR / "hitl" / f"{kpi_id}.yml"
    data = _read_yaml(path)
    return str(data.get("object") or "conversation")


def merge_effective(organization_id: str | int | None = None) -> dict[str, Any]:
    product = load_product()
    kpis_doc = product["kpis"]
    raw = kpis_doc.get("kpis") or {}
    if not isinstance(raw, dict):
        raise ValueError("kpis.yml kpis must be a mapping")
    kpis = dict(raw)
    sql_files = {
        p.stem: p
        for p in product["sql_dir"].glob("*.sql")
        if not p.stem.startswith("_")
    }
    missing = set(kpis) - set(sql_files)
    extra = set(sql_files) - set(kpis)
    if missing or extra:
        raise ValueError(f"KPI/SQL mismatch missing={sorted(missing)} extra={sorted(extra)}")
    return {
        "product": product["product"],
        "access": deepcopy(product["access"]),
        "kpis": kpis,
        "dimensions": product["dimensions"],
        "schema": product["schema"],
        "sql_files": sql_files,
        "organization_id": organization_id,
    }
