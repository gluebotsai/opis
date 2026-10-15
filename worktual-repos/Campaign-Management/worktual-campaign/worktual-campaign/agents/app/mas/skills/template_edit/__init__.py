"""Register template_edit module skills (edit-space)."""

from __future__ import annotations

from pathlib import Path

from app.mas.skills.registry import SkillRegistry
from app.mas.skills.types import SkillSpec

_PACKAGE = Path(__file__).resolve().parent

TEMPLATE_EDIT_MODULE = "template_edit"

# All skills share one executor; tools are scoped per skill.
TEMPLATE_EDIT_EXECUTOR = "template_edit"

SKILL_TO_EXECUTOR: dict[str, str] = {
    "edit_copy": TEMPLATE_EDIT_EXECUTOR,
    "edit_layout": TEMPLATE_EDIT_EXECUTOR,
    "edit_theme": TEMPLATE_EDIT_EXECUTOR,
    "edit_footer_links": TEMPLATE_EDIT_EXECUTOR,
    "edit_hero_image": TEMPLATE_EDIT_EXECUTOR,
    "redesign_template": TEMPLATE_EDIT_EXECUTOR,
    "launch_handoff": TEMPLATE_EDIT_EXECUTOR,
}

_KB = "search_knowledge"


def register_template_edit_skills(registry: SkillRegistry) -> None:
    registry.register(
        SkillSpec(
            module=TEMPLATE_EDIT_MODULE,
            skill_id="edit_copy",
            executor_id=TEMPLATE_EDIT_EXECUTOR,
            tool_names=frozenset(
                {
                    "apply_template_changes",
                    "show_current_template",
                    "save_template",
                    _KB,
                }
            ),
            description="Change template text (subject, headlines, body, CTA labels).",
            prompt_path=_PACKAGE / "edit_copy.md",
        )
    )
    registry.register(
        SkillSpec(
            module=TEMPLATE_EDIT_MODULE,
            skill_id="edit_layout",
            executor_id=TEMPLATE_EDIT_EXECUTOR,
            tool_names=frozenset(
                {
                    "apply_template_changes",
                    "show_current_template",
                    "save_template",
                    _KB,
                }
            ),
            description="Move, remove, insert, or reorder sections[] blocks.",
            prompt_path=_PACKAGE / "edit_layout.md",
        )
    )
    registry.register(
        SkillSpec(
            module=TEMPLATE_EDIT_MODULE,
            skill_id="edit_theme",
            executor_id=TEMPLATE_EDIT_EXECUTOR,
            tool_names=frozenset(
                {"set_email_theme", "show_current_template", "save_template", _KB}
            ),
            description="Change email colours, theme_id, or fonts.",
            prompt_path=_PACKAGE / "edit_theme.md",
        )
    )
    registry.register(
        SkillSpec(
            module=TEMPLATE_EDIT_MODULE,
            skill_id="edit_footer_links",
            executor_id=TEMPLATE_EDIT_EXECUTOR,
            tool_names=frozenset(
                {
                    "set_footer_social_links",
                    "show_current_template",
                    "save_template",
                    _KB,
                }
            ),
            description="Set or clear website and social footer URL rows.",
            prompt_path=_PACKAGE / "edit_footer_links.md",
        )
    )
    registry.register(
        SkillSpec(
            module=TEMPLATE_EDIT_MODULE,
            skill_id="edit_hero_image",
            executor_id=TEMPLATE_EDIT_EXECUTOR,
            tool_names=frozenset(
                {
                    "attach_uploaded_image",
                    "generate_hero_image",
                    "remove_hero_image",
                    "show_current_template",
                    "save_template",
                    _KB,
                }
            ),
            description="Upload, generate, refine, or remove hero/product images (rebuild URLs).",
            prompt_path=_PACKAGE / "edit_hero_image.md",
        )
    )
    registry.register(
        SkillSpec(
            module=TEMPLATE_EDIT_MODULE,
            skill_id="redesign_template",
            executor_id=TEMPLATE_EDIT_EXECUTOR,
            tool_names=frozenset(
                {
                    "redesign_template_with_designer",
                    "show_current_template",
                    "save_template",
                    _KB,
                }
            ),
            description="Full layout redesign via template designer (not tiny copy tweaks).",
            prompt_path=_PACKAGE / "redesign_template.md",
        )
    )
    registry.register(
        SkillSpec(
            module=TEMPLATE_EDIT_MODULE,
            skill_id="launch_handoff",
            executor_id=TEMPLATE_EDIT_EXECUTOR,
            tool_names=frozenset({"handoff_campaign_launch"}),
            description="Hand off to launch/schedule when the user wants to send.",
            prompt_path=_PACKAGE / "launch_handoff.md",
        )
    )


__all__ = [
    "SKILL_TO_EXECUTOR",
    "TEMPLATE_EDIT_EXECUTOR",
    "TEMPLATE_EDIT_MODULE",
    "register_template_edit_skills",
]
