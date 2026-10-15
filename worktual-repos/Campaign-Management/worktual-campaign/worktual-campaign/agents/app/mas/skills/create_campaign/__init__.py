"""Register Creation / create_campaign module skills."""

from __future__ import annotations

from pathlib import Path

from app.mas.skills.registry import SkillRegistry
from app.mas.skills.types import SkillSpec

_PACKAGE = Path(__file__).resolve().parent

CREATE_CAMPAIGN_MODULE = "create_campaign"

# skill_id → executor_id (1:1 first slice)
SKILL_TO_EXECUTOR: dict[str, str] = {
    "campaign_brief": "brief_validation",
    "campaign_audience": "campaign_audience",
    "campaign_templates": "campaign_content",
    "campaign_launch": "launch_scheduling",
}

EXECUTOR_TO_SKILL: dict[str, str] = {
    "brief_validation": "campaign_brief",
    "campaign_audience": "campaign_audience",
    "campaign_content": "campaign_templates",
    "launch_scheduling": "campaign_launch",
}

_BRIEF_COMPLETE = frozenset()  # multi-gate; Domain switches skill
_AUDIENCE_COMPLETE = frozenset({"create_contact", "upload_temporary_contacts"})
_TEMPLATES_COMPLETE = frozenset({"build_campaign"})
_LAUNCH_COMPLETE = frozenset({"launch_campaign"})


def default_skill_for_executor(executor_id: str) -> str | None:
    return EXECUTOR_TO_SKILL.get(str(executor_id or "").strip().lower())


def register_create_campaign_skills(registry: SkillRegistry) -> None:
    registry.register(
        SkillSpec(
            module=CREATE_CAMPAIGN_MODULE,
            skill_id="campaign_brief",
            executor_id="brief_validation",
            tool_names=frozenset(
                {
                    "update_campaign_setup",
                    "suggest_campaign_names",
                    "plan_campaign_images",
                    "confirm_chat_images",
                    "set_email_ab",
                    "search_knowledge",
                }
            ),
            completion_tool_names=_BRIEF_COMPLETE,
            description=(
                "Save campaign meta, channels, audience_text, image-plan intent; "
                "suggest names when title missing; confirm chat image uploads; "
                "enable email A/B; ask next conversational gate."
            ),
            prompt_path=_PACKAGE / "campaign_brief.md",
        )
    )
    registry.register(
        SkillSpec(
            module=CREATE_CAMPAIGN_MODULE,
            skill_id="campaign_audience",
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
            description="Match, create, update, or temp-sheet contacts for this campaign.",
            prompt_path=_PACKAGE / "campaign_audience.md",
        )
    )
    registry.register(
        SkillSpec(
            module=CREATE_CAMPAIGN_MODULE,
            skill_id="campaign_templates",
            executor_id="campaign_content",
            tool_names=frozenset(
                {
                    "build_campaign",
                    "inspect_session_template",
                    "plan_campaign_images",
                    "confirm_chat_images",
                    "set_email_ab",
                    "search_knowledge",
                }
            ),
            completion_tool_names=_TEMPLATES_COMPLETE,
            description=(
                "Generate or regenerate channel templates (build_campaign); "
                "enable email A/B and regenerate variants when needed."
            ),
            prompt_path=_PACKAGE / "campaign_templates.md",
        )
    )
    registry.register(
        SkillSpec(
            module=CREATE_CAMPAIGN_MODULE,
            skill_id="campaign_launch",
            executor_id="launch_scheduling",
            tool_names=frozenset({"launch_campaign", "set_email_ab", "search_knowledge"}),
            completion_tool_names=_LAUNCH_COMPLETE,
            description=(
                "Launch or schedule the campaign after explicit user confirm; "
                "optionally set email A/B before send."
            ),
            prompt_path=_PACKAGE / "campaign_launch.md",
        )
    )


__all__ = [
    "CREATE_CAMPAIGN_MODULE",
    "EXECUTOR_TO_SKILL",
    "SKILL_TO_EXECUTOR",
    "default_skill_for_executor",
    "register_create_campaign_skills",
]
