#!/usr/bin/env python3
"""Generate semantic/catalog/{product}.yaml for MetricFlow + future SQL agent."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
DBT = ROOT / "semantic" / "dbt"
OUT_DIR = ROOT / "semantic" / "catalog"

PRODUCTS: dict[str, dict[str, Any]] = {
    "ticketing": {
        "schema_suffix": "ticketing_marts",
        "engine": "postgres",
        "marts_schema": DBT / "ticketing/default/dbt/models/marts/schema.yml",
        "semantic": DBT / "ticketing/default/dbt/models/semantic_layer/semantic_layer.yml",
        "registry_source": "ticketing",
    },
    "crm": {
        "schema_suffix": "crm_marts",
        "engine": "postgres",
        "marts_schema": DBT / "crm/default/dbt/models/marts/schema.yml",
        "semantic": DBT / "crm/default/dbt/models/semantic_layer/semantic_layer.yml",
        "registry_source": "crm",
    },
    "ccaas": {
        "schema_suffix": "ccass_marts_aiccaas",
        "engine": "postgres",
        "marts_schema": DBT / "ccaas/default/dbt/models/marts/schema.yml",
        "semantic": DBT / "ccaas/default/dbt/models/semantic_layer/semantic_layer.yml",
        "registry_source": "aiccaas",
    },
    "campaign": {
        "schema_suffix": "campaign_marts",
        "engine": "postgres",
        "marts_schema": DBT / "campaign/default/dbt/models/marts/_campaign__marts.yml",
        "semantic_models": DBT / "campaign/default/dbt/models/semantic_layer/semantic_models.yml",
        "semantic_metrics": DBT / "campaign/default/dbt/models/semantic_layer/metrics.yml",
        "registry_source": "campaign",
    },
    "webtracking": {
        "schema_suffix": "webtracking_marts",
        "engine": "clickhouse",
        "marts_schema": DBT / "webtracking/default/dbt/models/marts/schema.yml",
        "semantic": DBT / "webtracking/default/dbt/models/semantic_layer/semantic_layer.yml",
        "registry_source": "webtracking",
    },
}


def _load(path: Path) -> dict:
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _parse_semantic_models(data: dict) -> list[dict]:
    return list(data.get("semantic_models") or [])


def _model_ref_name(ref: str) -> str:
    # ref('mart_tickets') -> mart_tickets
    if ref.startswith("ref("):
        return ref.split("'")[1] if "'" in ref else ref
    return ref


def _tables_from_schema(schema_path: Path) -> dict[str, dict]:
    data = _load(schema_path)
    out: dict[str, dict] = {}
    for model in data.get("models") or []:
        if not isinstance(model, dict):
            continue
        name = model.get("name")
        if not name:
            continue
        meta = dict(model.get("meta") or {})
        cols: list[dict] = []
        for col in model.get("columns") or []:
            if not isinstance(col, dict):
                continue
            entry = {"name": col.get("name")}
            if col.get("description"):
                entry["description"] = col["description"]
            if (col.get("meta") or {}).get("pii"):
                entry["pii"] = True
            cols.append(entry)
        out[name] = {
            "description": model.get("description"),
            "grain": meta.get("grain"),
            "purpose": meta.get("purpose"),
            "tenant_column": meta.get("tenant_column", "organization_id"),
            "row_scope_column": meta.get("row_scope_column"),
            "sql_agent_only": meta.get("sql_agent_only", False),
            "columns": cols,
        }
    return out


def _semantic_index(product_cfg: dict) -> dict[str, dict]:
    if product_cfg.get("semantic"):
        models = _parse_semantic_models(_load(product_cfg["semantic"]))
    else:
        models = _parse_semantic_models(_load(product_cfg["semantic_models"]))
    idx: dict[str, dict] = {}
    for sm in models:
        ref = sm.get("model") or ""
        mart = _model_ref_name(str(ref))
        dims = [d.get("name") for d in (sm.get("dimensions") or []) if isinstance(d, dict)]
        measures = [m.get("name") for m in (sm.get("measures") or []) if isinstance(m, dict)]
        idx[mart] = {
            "semantic_model": sm.get("name"),
            "description": sm.get("description"),
            "dimensions": [d for d in dims if d],
            "measures": measures,
        }
    return idx


def _metrics_for_product(registry: dict, source_key: str) -> list[str]:
    metrics = registry.get("metrics") or {}
    return sorted(
        k for k, v in metrics.items()
        if isinstance(v, dict) and v.get("source") == source_key
    )


def build_product_catalog(product: str, cfg: dict, registry: dict, policies: dict, thresholds: dict) -> dict:
    tables_raw = _tables_from_schema(cfg["marts_schema"])
    sem_idx = _semantic_index(cfg)
    metric_ids = _metrics_for_product(registry, cfg["registry_source"])

    tables: list[dict] = []
    for mart_name, table_meta in sorted(tables_raw.items()):
        sem = sem_idx.get(mart_name, {})
        tables.append(
            {
                "name": mart_name,
                "schema": cfg["schema_suffix"],
                "engine": cfg["engine"],
                **{k: v for k, v in table_meta.items() if v is not None},
                "semantic_model": sem.get("semantic_model"),
                "semantic_dimensions": sem.get("dimensions"),
                "semantic_measures": sem.get("measures"),
            }
        )

    # Semantic models whose mart is not in schema.yml (still document)
    for mart_name, sem in sem_idx.items():
        if mart_name not in tables_raw:
            tables.append(
                {
                    "name": mart_name,
                    "schema": cfg["schema_suffix"],
                    "engine": cfg["engine"],
                    "tenant_column": "organization_id",
                    "semantic_model": sem.get("semantic_model"),
                    "semantic_dimensions": sem.get("dimensions"),
                    "semantic_measures": sem.get("measures"),
                    "note": "Mart schema.yml entry missing — add meta block",
                }
            )

    metric_refs = []
    for mid in metric_ids:
        pol = (policies.get("metrics") or {}).get(mid) or {}
        th = (thresholds.get("metrics") or {}).get(mid) or {}
        metric_refs.append(
            {
                "id": mid,
                "label": pol.get("label"),
                "on": pol.get("on"),
                "dims": pol.get("dims") or pol.get("group_by"),
                "kind": th.get("kind"),
                "direction": th.get("direction"),
                "via": "ask_semantic",
            }
        )

    return {
        "product": product,
        "engine": cfg["engine"],
        "default_schema": cfg["schema_suffix"],
        "tenant_column": "organization_id",
        "tables": tables,
        "certified_metrics": metric_refs,
    }


def main() -> None:
    registry = _load(ROOT / "semantic" / "metric_registry.yml")
    policies = _load(ROOT / "ontology" / "metric_policies.yml")
    thresholds = _load(ROOT / "semantic" / "metric_thresholds.yml")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for product, cfg in PRODUCTS.items():
        if not cfg.get("marts_schema") and not cfg.get("semantic"):
            continue
        if cfg.get("marts_schema") and not cfg["marts_schema"].is_file():
            print(f"skip {product}: missing {cfg['marts_schema']}")
            continue
        catalog = build_product_catalog(product, cfg, registry, policies, thresholds)
        out_path = OUT_DIR / f"{product}.yaml"
        out_path.write_text(
            yaml.safe_dump(catalog, sort_keys=False, allow_unicode=True, width=100),
            encoding="utf-8",
        )
        print(f"Wrote {out_path} — {len(catalog['tables'])} tables, {len(catalog['certified_metrics'])} metrics")


if __name__ == "__main__":
    main()
