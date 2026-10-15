"""Export MAS skill packs as CCaaS-compatible skill objects."""

from __future__ import annotations

from typing import Any

from app.mas.catalog import domain_for_executor
from app.mas.skills.registry import get_skill_registry
from app.sft_catalog.registry import CatalogAgentRef

# Domain / executor → skill registry modules to include.
_DOMAIN_SKILL_MODULES: dict[str, tuple[str, ...]] = {
    "audience": ("contacts",),
    "creation": ("create_campaign",),
    "recommendation_run": ("create_campaign",),
    "library_run": ("library_run",),
    "optimization": ("monitoring", "reports"),
}

_EXECUTOR_SKILL_MODULES: dict[str, tuple[str, ...]] = {
    "contact": ("contacts",),
    "audience_selection": ("contacts",),
    "audience_pull": ("contacts",),
    "brief_validation": ("create_campaign",),
    "campaign_audience": ("create_campaign", "library_run"),
    "campaign_content": ("create_campaign", "library_run"),
    "launch_scheduling": ("create_campaign", "library_run"),
    "recommendation": ("create_campaign",),
    "monitoring": ("monitoring",),
    "recovery": ("monitoring",),
    "analytics": ("reports",),
}


def skills_for_ref(ref: CatalogAgentRef) -> list[dict[str, Any]]:
    modules: tuple[str, ...] = ()
    if ref.layer == "domain":
        modules = _DOMAIN_SKILL_MODULES.get(ref.id, ())
    elif ref.layer == "executor":
        modules = _EXECUTOR_SKILL_MODULES.get(ref.id, ())
        if not modules:
            domain = domain_for_executor(ref.id) or ""
            modules = _DOMAIN_SKILL_MODULES.get(domain, ())
    if not modules:
        return []

    registry = get_skill_registry()
    out: list[dict[str, Any]] = []
    for mod in modules:
        for spec in registry.list_module(mod):
            if ref.layer == "executor" and str(spec.executor_id or "") != ref.id:
                continue
            body = ""
            missing = True
            if spec.prompt_path and spec.prompt_path.is_file():
                body = spec.prompt_path.read_text(encoding="utf-8").strip()
                missing = False
            extra = dict(spec.extra or {})
            out.append(
                {
                    "id": spec.skill_id,
                    "name": spec.skill_id.replace("_", " ").replace("-", " ").title(),
                    "description": spec.description or "",
                    "version": int(extra.get("version") or 1),
                    "required": bool(extra.get("required", False)),
                    "triggers": list(extra.get("triggers") or []),
                    "toolsPreferred": sorted(spec.tool_names),
                    "workflow": list(extra.get("workflow") or []),
                    "rules": list(extra.get("rules") or []),
                    "body": body,
                    "missing": missing,
                    "module": mod,
                    "executor_id": spec.executor_id,
                }
            )
    return out
