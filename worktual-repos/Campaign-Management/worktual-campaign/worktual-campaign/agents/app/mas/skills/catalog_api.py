"""MAS skill catalog — list/get/update/remove for Product MCP bridge."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.mas.skills.registry import get_skill_registry
from app.mas.skills.state import get_active_skill_id
from app.mas.skills.types import SkillSpec


def _skill_to_json(spec: SkillSpec) -> dict[str, Any]:
    body = ""
    missing = True
    if spec.prompt_path and spec.prompt_path.is_file():
        body = spec.prompt_path.read_text(encoding="utf-8").strip()
        missing = False
    extra = dict(spec.extra or {})
    return {
        "id": spec.skill_id,
        "module": spec.module,
        "executor_id": spec.executor_id,
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
        "completion_tools": sorted(spec.completion_tool_names),
    }


def list_skills_catalog(*, module: str | None = None) -> list[dict[str, Any]]:
    registry = get_skill_registry()
    if module:
        specs = registry.list_module(module)
    else:
        specs = []
        seen: set[tuple[str, str]] = set()
        for mod in (
            "contacts",
            "monitoring",
            "reports",
            "create_campaign",
            "library_run",
            "whatsapp_approved",
            "template_edit",
        ):
            for spec in registry.list_module(mod):
                if spec.key in seen:
                    continue
                seen.add(spec.key)
                specs.append(spec)
    return [_skill_to_json(s) for s in specs]


def get_skill_catalog(module: str, skill_id: str) -> dict[str, Any] | None:
    spec = get_skill_registry().get(module, skill_id)
    if not spec:
        return None
    return _skill_to_json(spec)


def update_skill_in_system(
    module: str,
    skill_id: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    registry = get_skill_registry()
    spec = registry.get(module, skill_id)
    if not spec:
        raise KeyError(f"Unknown skill: {module}/{skill_id}")

    body = patch.get("body")
    if isinstance(body, str) and spec.prompt_path:
        path = Path(spec.prompt_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body.strip() + "\n", encoding="utf-8")

    extra = dict(spec.extra or {})
    for key in ("triggers", "workflow", "rules", "version", "required"):
        if key in patch and patch[key] is not None:
            extra[key] = patch[key]

    reg_patch: dict[str, Any] = {}
    if patch.get("description") is not None:
        reg_patch["description"] = str(patch["description"])
    if patch.get("tool_names") is not None:
        reg_patch["tool_names"] = frozenset(patch["tool_names"])
    if patch.get("executor_id") is not None:
        reg_patch["executor_id"] = str(patch["executor_id"])
    if extra != spec.extra:
        reg_patch["extra"] = extra

    if reg_patch:
        registry.update(module, skill_id, **reg_patch)

    updated = registry.get(module, skill_id)
    assert updated
    return _skill_to_json(updated)


def remove_skill_from_system(module: str, skill_id: str) -> bool:
    return get_skill_registry().delete(module, skill_id)


def list_active_skills_for_session(
    session: dict[str, Any],
) -> list[dict[str, Any]]:
    modules = (
        "contacts",
        "monitoring",
        "reports",
        "create_campaign",
        "library_run",
        "whatsapp_approved",
    )
    out: list[dict[str, Any]] = []
    for mod in modules:
        sid = get_active_skill_id(session, mod)
        if not sid:
            continue
        spec = get_skill_registry().get(mod, sid)
        if spec:
            row = _skill_to_json(spec)
            row["active_module"] = mod
            out.append(row)
    return out
