"""Register Audience / contacts module skills."""

from __future__ import annotations

from pathlib import Path

from app.mas.skills.registry import SkillRegistry
from app.mas.skills.types import SkillSpec

_PACKAGE = Path(__file__).resolve().parent

# Panel sync is infrastructure — appended by registry.tools_for_skill, not listed in skill md.
PANEL_SYNC_TOOL = "SET_DRAFT_FIELDS"

_CREATE_COMPLETE = frozenset({"CREATE_SINGLE_CONTACT", "CREATE_BULK_CONTACT"})
_UPDATE_COMPLETE = frozenset({"UPDATE_SINGLE_CONTACT", "UPDATE_BULK_CONTACT"})
_VIEW_COMPLETE = frozenset({"VIEW_CONTACT", "QUERY_CONTACTS"})

# Skills that need Contact Setup panel sync during chat create/update.
_SKILLS_WITH_PANEL_SYNC = frozenset({"contact_creation", "contact_update"})


def register_contacts_skills(registry: SkillRegistry) -> None:
    registry.register(
        SkillSpec(
            module="contacts",
            skill_id="contact_creation",
            executor_id="contact",
            tool_names=frozenset(
                {
                    "CREATE_SINGLE_CONTACT",
                    "CREATE_BULK_CONTACT",
                    "GET_CONTACT_DETAIL",
                }
            ),
            completion_tool_names=_CREATE_COMPLETE,
            description="Create contacts via chat or sheet; check existence before create.",
            prompt_path=_PACKAGE / "contact_creation.md",
            extra={"panel_sync": True},
        )
    )
    registry.register(
        SkillSpec(
            module="contacts",
            skill_id="contact_update",
            executor_id="contact",
            tool_names=frozenset(
                {
                    "UPDATE_SINGLE_CONTACT",
                    "UPDATE_BULK_CONTACT",
                    "GET_CONTACT_DETAIL",
                }
            ),
            completion_tool_names=_UPDATE_COMPLETE,
            description="Update contacts via chat or sheet; find contact before update.",
            prompt_path=_PACKAGE / "contact_update.md",
            extra={"panel_sync": True},
        )
    )
    registry.register(
        SkillSpec(
            module="contacts",
            skill_id="contact_view",
            executor_id="contact",
            tool_names=frozenset({"VIEW_CONTACT", "QUERY_CONTACTS"}),
            completion_tool_names=_VIEW_COMPLETE,
            description="View or search contacts matching the user's request only.",
            prompt_path=_PACKAGE / "contact_view.md",
            extra={"panel_sync": False},
        )
    )


__all__ = [
    "PANEL_SYNC_TOOL",
    "register_contacts_skills",
    "_SKILLS_WITH_PANEL_SYNC",
]
