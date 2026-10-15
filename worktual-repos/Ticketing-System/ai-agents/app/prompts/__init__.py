"""Prompt package.

Native coworker: per-specialist builders in `builder`
(Role → Goal → Instructions → Context → Output → Guardrails).
Legacy lean/intent/NLU stub: `systems` (not used by native tool loop).
"""

from app.prompts.builder import (
    SPECIALIST_PROMPT_BUILDERS,
    build_admin_prompt,
    build_customers_prompt,
    build_general_prompt,
    build_kb_prompt,
    build_macros_prompt,
    build_specialist_prompt,
    build_supervisor_prompt,
    build_teams_prompt,
    build_tickets_prompt,
    sectioned_system_prompt,
)
from app.prompts.systems import *  # noqa: F403

__all__ = [
    "SPECIALIST_PROMPT_BUILDERS",
    "build_admin_prompt",
    "build_customers_prompt",
    "build_general_prompt",
    "build_kb_prompt",
    "build_macros_prompt",
    "build_specialist_prompt",
    "build_supervisor_prompt",
    "build_teams_prompt",
    "build_tickets_prompt",
    "sectioned_system_prompt",
]
