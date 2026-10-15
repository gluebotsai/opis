"""In-memory skill registry — register / update / delete / resolve tools."""

from __future__ import annotations

from typing import Any

from app.mas.skills.types import SkillSpec

SKILL_ACTIONS = frozenset(
    {
        "continue",
        "switch",
        "pause_and_switch",
        "complete",
        "resume",
        "new_task",
        "cancelled",
    }
)


class SkillRegistry:
    def __init__(self) -> None:
        self._specs: dict[tuple[str, str], SkillSpec] = {}

    def register(self, spec: SkillSpec) -> SkillSpec:
        key = spec.key
        if key in self._specs:
            raise ValueError(f"Skill already registered: {key[0]}/{key[1]}")
        self._validate_tools(spec)
        self._specs[key] = spec
        return spec

    def update(self, module: str, skill_id: str, **patch: Any) -> SkillSpec:
        key = (str(module).strip().lower(), str(skill_id).strip().lower())
        existing = self._specs.get(key)
        if not existing:
            raise KeyError(f"Unknown skill: {module}/{skill_id}")
        data = {
            "module": existing.module,
            "skill_id": existing.skill_id,
            "executor_id": patch.get("executor_id", existing.executor_id),
            "tool_names": patch.get("tool_names", existing.tool_names),
            "description": patch.get("description", existing.description),
            "prompt_path": patch.get("prompt_path", existing.prompt_path),
            "completion_tool_names": patch.get(
                "completion_tool_names", existing.completion_tool_names
            ),
            "extra": patch.get("extra", existing.extra),
        }
        updated = SkillSpec(**data)
        self._validate_tools(updated)
        self._specs[key] = updated
        return updated

    def delete(self, module: str, skill_id: str) -> bool:
        key = (str(module).strip().lower(), str(skill_id).strip().lower())
        if key not in self._specs:
            return False
        del self._specs[key]
        return True

    def get(self, module: str, skill_id: str) -> SkillSpec | None:
        key = (str(module).strip().lower(), str(skill_id).strip().lower())
        return self._specs.get(key)

    def list_module(self, module: str) -> list[SkillSpec]:
        mod = str(module).strip().lower()
        return sorted(
            [s for s in self._specs.values() if s.module == mod],
            key=lambda s: s.skill_id,
        )

    def tools_for_skill(
        self,
        module: str,
        skill_id: str,
        *,
        session: dict[str, Any] | None = None,
    ) -> list:
        spec = self.get(module, skill_id)
        if not spec:
            return []
        _ = session
        names = set(spec.tool_names)
        mod = str(spec.module or "").strip().lower()
        if mod == "contacts":
            from app.agents.contacts.tools.schemas import contact_tool_schemas_for_names
            from app.mas.skills.contacts import PANEL_SYNC_TOOL

            if spec.extra.get("panel_sync"):
                names.add(PANEL_SYNC_TOOL)
            return contact_tool_schemas_for_names(names)
        if mod == "monitoring":
            from app.agents.monitoring.tools.schemas import (
                monitoring_tool_schemas_for_names,
            )

            return monitoring_tool_schemas_for_names(names)
        if mod == "reports":
            from app.agents.reports.tools.schemas import reports_tool_schemas_for_names

            return reports_tool_schemas_for_names(names)
        if mod in ("create_campaign", "library_run"):
            from app.agents.create_campaign.tools import (
                create_campaign_tool_schemas_for_names,
            )

            return create_campaign_tool_schemas_for_names(names)
        if mod == "whatsapp_approved":
            from app.agents.whatsapp_approved.tools.schemas import (
                whatsapp_approved_tool_schemas_for_names,
            )

            return whatsapp_approved_tool_schemas_for_names(names)
        if mod == "template_edit":
            from app.agents.template_library.edit_tools import (
                template_edit_tool_schemas_for_names,
            )

            return template_edit_tool_schemas_for_names(names)
        return []

    def prompt_for_skill(self, module: str, skill_id: str) -> str:
        spec = self.get(module, skill_id)
        if not spec or not spec.prompt_path:
            return ""
        path = spec.prompt_path
        if not path.is_file():
            return ""
        return path.read_text(encoding="utf-8").strip()

    @staticmethod
    def _validate_tools(spec: SkillSpec) -> None:
        mod = str(spec.module or "").strip().lower()
        if mod == "contacts":
            from app.agents.contacts.tools.schemas import _CONTACT_TOOL_INDEX

            index = _CONTACT_TOOL_INDEX
        elif mod == "monitoring":
            from app.agents.monitoring.tools.schemas import _MONITORING_TOOL_INDEX

            index = _MONITORING_TOOL_INDEX
        elif mod == "reports":
            from app.agents.reports.tools.schemas import _REPORTS_TOOL_INDEX

            index = _REPORTS_TOOL_INDEX
        elif mod in ("create_campaign", "library_run"):
            from app.agents.create_campaign.tools import _TOOL_INDEX

            index = _TOOL_INDEX
        elif mod == "whatsapp_approved":
            from app.agents.whatsapp_approved.tools.schemas import (
                _WHATSAPP_APPROVED_TOOL_INDEX,
            )

            index = _WHATSAPP_APPROVED_TOOL_INDEX
        elif mod == "template_edit":
            from app.agents.template_library.edit_tools import _EDIT_TOOL_INDEX

            index = _EDIT_TOOL_INDEX
        else:
            raise ValueError(f"Skill module {mod!r} has no tool index")
        unknown = [n for n in spec.tool_names if n not in index]
        if unknown:
            raise ValueError(f"Skill {spec.skill_id} references unknown tools: {unknown}")


_default_registry: SkillRegistry | None = None


def get_skill_registry() -> SkillRegistry:
    global _default_registry
    if _default_registry is None:
        _default_registry = SkillRegistry()
        from app.mas.skills.contacts import register_contacts_skills
        from app.mas.skills.create_campaign import register_create_campaign_skills
        from app.mas.skills.library_run import register_library_run_skills
        from app.mas.skills.monitoring import register_monitoring_skills
        from app.mas.skills.reports import register_reports_skills
        from app.mas.skills.template_edit import register_template_edit_skills
        from app.mas.skills.whatsapp_approved import register_whatsapp_approved_skills

        register_contacts_skills(_default_registry)
        register_monitoring_skills(_default_registry)
        register_reports_skills(_default_registry)
        register_create_campaign_skills(_default_registry)
        register_library_run_skills(_default_registry)
        register_template_edit_skills(_default_registry)
        register_whatsapp_approved_skills(_default_registry)
    return _default_registry
