"""Skills for approved WhatsApp template run (content / whatsapp_approved_send)."""

from __future__ import annotations

from pathlib import Path

from app.mas.skills.registry import SkillRegistry
from app.mas.skills.types import SkillSpec

_PACKAGE = Path(__file__).resolve().parent

_AUDIENCE_TOOLS = frozenset(
    {
        "FILTER_CONTACTS",
        "SET_AUDIENCE",
        "UPLOAD_TEMPORARY_CONTACTS",
    }
)
_LAUNCH_TOOLS = frozenset(
    {
        "SEND_APPROVED_TEMPLATE",
        "LAUNCH_APPROVED_CAMPAIGN",
    }
)


def default_skill_for_executor(executor_id: str) -> str | None:
    eid = str(executor_id or "").strip().lower()
    if eid == "whatsapp_approved_send":
        return "approved_audience"
    return None


def register_whatsapp_approved_skills(registry: SkillRegistry) -> None:
    registry.register(
        SkillSpec(
            module="whatsapp_approved",
            skill_id="approved_run_brief",
            executor_id="whatsapp_approved_send",
            tool_names=frozenset(),
            completion_tool_names=frozenset(),
            description="Confirm approved template + explain send vs launch paths.",
            prompt_path=_PACKAGE / "approved_run_brief.md",
        )
    )
    registry.register(
        SkillSpec(
            module="whatsapp_approved",
            skill_id="approved_audience",
            executor_id="whatsapp_approved_send",
            tool_names=_AUDIENCE_TOOLS,
            completion_tool_names=_AUDIENCE_TOOLS,
            description="Audience via CRM, phones, or temporary CSV sheet.",
            prompt_path=_PACKAGE / "approved_audience.md",
        )
    )
    registry.register(
        SkillSpec(
            module="whatsapp_approved",
            skill_id="approved_launch",
            executor_id="whatsapp_approved_send",
            tool_names=_LAUNCH_TOOLS,
            completion_tool_names=_LAUNCH_TOOLS,
            description="Direct send or scheduled Monitoring campaign launch.",
            prompt_path=_PACKAGE / "approved_launch.md",
        )
    )


__all__ = ["default_skill_for_executor", "register_whatsapp_approved_skills"]
