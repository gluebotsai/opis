"""Register library_run module skills — isolated from create_campaign skill prompts."""

from __future__ import annotations

from pathlib import Path

from app.mas.skills.registry import SkillRegistry
from app.mas.skills.types import SkillSpec

_PACKAGE = Path(__file__).resolve().parent

LIBRARY_RUN_MODULE = "library_run"

SKILL_TO_EXECUTOR: dict[str, str] = {
    "library_brief": "brief_validation",
    "library_audience": "campaign_audience",
    "library_templates": "campaign_content",
    "library_launch": "launch_scheduling",
}

EXECUTOR_TO_SKILL: dict[str, str] = {
    "brief_validation": "library_brief",
    "campaign_audience": "library_audience",
    "campaign_content": "library_templates",
    "launch_scheduling": "library_launch",
}

_BRIEF_COMPLETE = frozenset()
_AUDIENCE_COMPLETE = frozenset({"create_contact", "upload_temporary_contacts"})
_TEMPLATES_COMPLETE = frozenset({"build_campaign"})
_LAUNCH_COMPLETE = frozenset({"launch_campaign"})


def default_library_skill_for_executor(executor_id: str) -> str | None:
    return EXECUTOR_TO_SKILL.get(str(executor_id or "").strip().lower())


def register_library_run_skills(registry: SkillRegistry) -> None:
    registry.register(
        SkillSpec(
            module=LIBRARY_RUN_MODULE,
            skill_id="library_brief",
            executor_id="brief_validation",
            tool_names=frozenset(
                {
                    "update_campaign_setup",
                    "plan_campaign_images",
                    "confirm_chat_images",
                    "search_knowledge",
                }
            ),
            completion_tool_names=_BRIEF_COMPLETE,
            description=(
                "Align campaign intent and channel scope with library creative baseline; "
                "do not build templates."
            ),
            prompt_path=_PACKAGE / "library_brief.md",
        )
    )
    registry.register(
        SkillSpec(
            module=LIBRARY_RUN_MODULE,
            skill_id="library_audience",
            executor_id="campaign_audience",
            tool_names=frozenset(
                {
                    "check_contacts",
                    "create_contact",
                    "upload_temporary_contacts",
                    "update_contact",
                    "confirm_chat_images",
                    "search_knowledge",
                }
            ),
            completion_tool_names=_AUDIENCE_COMPLETE,
            description="Match, create, update, or temp-sheet contacts for this library-run campaign.",
            prompt_path=_PACKAGE / "library_audience.md",
        )
    )
    registry.register(
        SkillSpec(
            module=LIBRARY_RUN_MODULE,
            skill_id="library_templates",
            executor_id="campaign_content",
            tool_names=frozenset(
                {
                    "build_campaign",
                    "inspect_session_template",
                    "plan_campaign_images",
                    "confirm_chat_images",
                    "search_knowledge",
                }
            ),
            completion_tool_names=_TEMPLATES_COMPLETE,
            description=(
                "Adopt or adapt library baseline creatives; fill missing channels; "
                "honor content/design/image modes."
            ),
            prompt_path=_PACKAGE / "library_templates.md",
        )
    )
    registry.register(
        SkillSpec(
            module=LIBRARY_RUN_MODULE,
            skill_id="library_launch",
            executor_id="launch_scheduling",
            tool_names=frozenset({"launch_campaign", "search_knowledge"}),
            completion_tool_names=_LAUNCH_COMPLETE,
            description="Launch or schedule after explicit confirm.",
            prompt_path=_PACKAGE / "library_launch.md",
        )
    )


__all__ = [
    "LIBRARY_RUN_MODULE",
    "SKILL_TO_EXECUTOR",
    "EXECUTOR_TO_SKILL",
    "default_library_skill_for_executor",
    "register_library_run_skills",
]
