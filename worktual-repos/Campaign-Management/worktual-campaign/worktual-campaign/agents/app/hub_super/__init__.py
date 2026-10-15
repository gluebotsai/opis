"""Hub Super Agent — autonomous multi-skill router for A2A hub tasks."""

from app.hub_super.orchestrator import agent_card, run_hub_task
from app.hub_super.skill_catalog import SKILL_DEFS, INTENT_PIPELINES

__all__ = [
    "INTENT_PIPELINES",
    "SKILL_DEFS",
    "agent_card",
    "run_hub_task",
]
