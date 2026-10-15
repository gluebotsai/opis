"""Resolve compiled dbt/MetricFlow manifest directories under semantic/dbt/."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

_REPO_ROOT = Path(__file__).resolve().parents[2]
MANIFEST_ROOT = os.environ.get(
    "MANIFEST_ROOT",
    str(_REPO_ROOT / "semantic" / "dbt"),
)

PRODUCT_DIR = {
    "ccaas": "ccaas",
    "contact_centre": "ccaas",
    "aiccaas": "ccaas",
    "ticketing": "ticketing",
    "crm": "crm",
    "campaign": "campaign",
    "webtracking": "webtracking",
}


class ManifestNotFoundError(Exception):
    pass


def product_folder(product: str) -> str:
    key = (product or "").strip().lower()
    return PRODUCT_DIR.get(key, key)


def ensure_semantic_manifest(project_dir: str) -> Optional[str]:
    target_dir = os.path.join(project_dir, "target")
    manifest_path = os.path.join(target_dir, "manifest.json")
    semantic_manifest_path = os.path.join(target_dir, "semantic_manifest.json")

    if not os.path.exists(manifest_path) and not os.path.exists(semantic_manifest_path):
        return None

    if not os.path.exists(manifest_path) and os.path.exists(semantic_manifest_path):
        return semantic_manifest_path

    m_time = os.path.getmtime(manifest_path)
    sm_time = (
        os.path.getmtime(semantic_manifest_path)
        if os.path.exists(semantic_manifest_path)
        else 0
    )

    if sm_time >= m_time:
        return semantic_manifest_path

    try:
        with open(manifest_path, encoding="utf-8") as fh:
            compiled = json.load(fh)

        sm_models = []
        for node in compiled.get("nodes", {}).values():
            if node.get("resource_type") != "semantic_model":
                continue
            sm_models.append(
                {
                    "name": node.get("name"),
                    "defaults": node.get("defaults"),
                    "description": node.get("description"),
                    "node_relation": node.get("relation_name"),
                    "primary_entity": node.get("primary_entity"),
                    "entities": node.get("entities", []),
                    "measures": node.get("measures", []),
                    "dimensions": node.get("dimensions", []),
                }
            )

        metrics = []
        for node in compiled.get("metrics", {}).values():
            metrics.append(
                {
                    "name": node.get("name"),
                    "description": node.get("description"),
                    "type": node.get("type"),
                    "type_params": node.get("type_params"),
                    "label": node.get("label"),
                }
            )

        compiled_sm = {"semantic_models": sm_models, "metrics": metrics}
        os.makedirs(target_dir, exist_ok=True)
        tmp_path = semantic_manifest_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(compiled_sm, fh, indent=2)
        os.replace(tmp_path, semantic_manifest_path)
        logger.info(
            "Synced semantic_manifest.json at %s (models=%s metrics=%s)",
            semantic_manifest_path,
            len(sm_models),
            len(metrics),
        )
        return semantic_manifest_path
    except Exception as exc:
        logger.error("Failed to compile semantic_manifest.json: %s", exc)
        if os.path.exists(semantic_manifest_path):
            return semantic_manifest_path
        return manifest_path if os.path.exists(manifest_path) else None


def resolve_manifest_dir(product: str, organization_id: str) -> str:
    folder = product_folder(product)
    tenant_dbt_dir = os.path.join(
        MANIFEST_ROOT, folder, f"tenant_{organization_id}", "dbt"
    )
    default_dbt_dir = os.path.join(MANIFEST_ROOT, folder, "default", "dbt")
    legacy_dbt_dir = os.path.join(MANIFEST_ROOT, folder, "dbt")

    for candidate in (tenant_dbt_dir, default_dbt_dir, legacy_dbt_dir):
        has_manifest = (
            os.path.isfile(os.path.join(candidate, "target", "semantic_manifest.json"))
            or os.path.isfile(os.path.join(candidate, "target", "manifest.json"))
        )
        if has_manifest:
            ensure_semantic_manifest(candidate)
            return candidate

    raise ManifestNotFoundError(
        f"No compiled manifest for product='{product}' org='{organization_id}'. "
        f"Run `dbt parse` in semantic/dbt/{folder}/default/dbt first."
    )


def get_db_dialect(product: str) -> str:
    if product_folder(product) == "webtracking":
        return "clickhouse"
    return "postgres"
