# origin: ticketing_v2/core/loader.py
import os
import yaml
from pathlib import Path
from typing import Dict, Any

_BASE_DIR = Path(__file__).resolve().parent.parent
PRODUCT_DIR = _BASE_DIR / "product"

def get_product_path() -> Path:
    return PRODUCT_DIR

def load_yaml(rel_path: str) -> Dict[str, Any]:
    full_path = _BASE_DIR / rel_path
    if not full_path.exists():
        raise FileNotFoundError(f"Config file not found: {full_path}")
    with open(full_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}

def load_schema() -> Dict[str, Any]:
    return load_yaml("product/schema.yml")

def load_access() -> Dict[str, Any]:
    return load_yaml("product/access.yml")

def load_kpis() -> Dict[str, Any]:
    doc = load_yaml("product/kpis.yml")
    return doc.get("kpis", doc)

def load_enums() -> Dict[str, Any]:
    return load_yaml("product/enums.yml")

def load_thresholds() -> Dict[str, Any]:
    return load_yaml("product/thresholds.yml")

def load_currency_map() -> Dict[str, str]:
    return load_yaml("product/currency_map.yml")

def load_glossary() -> Dict[str, Any]:
    return load_yaml("product/glossary.yml")

def load_sql_template(kpi_id: str) -> str:
    path = _BASE_DIR / "product" / "sql" / f"{kpi_id}.sql"
    if not path.exists():
        raise FileNotFoundError(f"SQL template for KPI '{kpi_id}' not found at {path}")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def load_base_deal_template() -> str:
    path = _BASE_DIR / "product" / "sql" / "_base_deal.sql"
    with open(path, "r", encoding="utf-8") as f:
        return f.read()
