"""Verify org-scoped slice includes/excludes steward class ids."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import yaml


def _tenant_modules(semantic_root: Path, org: str) -> list[str]:
    sem_path = semantic_root / "tenants" / f"org{org}" / "semantic.yaml"
    extras: list[str] = []
    if sem_path.exists():
        sem = yaml.safe_load(sem_path.read_text(encoding="utf-8")) or {}
        extras = list(sem.get("extra_modules") or [])
    return ["core"] + extras


def check_slice_scope(
    semantic_root: Path,
    org: str,
    class_id: str,
    industry_pack: str,
    exclude_org: str | None = None,
    compare_tenant: str | None = None,
    compare_industry_pack: str = "ecommerce",
) -> dict[str, Any]:
    """Return whether class_id appears in slice for org and is absent for exclude_org."""
    sys.path.insert(0, str(semantic_root))
    from ontology.slice import fetch_ontology_slice

    ontology_root = semantic_root / "ontology"
    tenant = f"org{org}"
    modules = _tenant_modules(semantic_root, org)
    pack = fetch_ontology_slice(
        modules=modules,
        tenant=tenant,
        industry_pack=industry_pack,
        root=ontology_root,
    )
    prompt = pack.as_prompt()
    slug = class_id.replace("wt:", "")
    included = class_id in prompt or slug in prompt

    excluded = True
    other_org = exclude_org or compare_tenant
    if other_org:
        other_tenant_path = semantic_root / "tenants" / f"org{other_org}" / "semantic.yaml"
        if other_tenant_path.exists():
            other_modules = _tenant_modules(semantic_root, other_org)
            other = fetch_ontology_slice(
                modules=other_modules,
                tenant=f"org{other_org}",
                industry_pack=compare_industry_pack if compare_tenant else "ecommerce",
                root=ontology_root,
            )
            other_prompt = other.as_prompt()
            excluded = class_id not in other_prompt and slug not in other_prompt

    return {
        "org": org,
        "class_id": class_id,
        "modules": modules,
        "included": included,
        "excluded_other": excluded,
    }
