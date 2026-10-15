"""Factual contacts/audience session state for MAS routing (not chat intent parsing)."""

from __future__ import annotations

import json
from typing import Any

from app.mas.runtime.contacts_setup_snapshot import live_session_facts
from app.mas.runtime.task_memory import get_mas_task
from app.mas.skills.state import get_active_skill_id, is_active_contact_creation


def contacts_pipeline_context(session: dict[str, Any] | None) -> str:
    """Factual contacts state for MAS routing — skill/draft facts only (chat memory is in mas runtime)."""
    if not isinstance(session, dict):
        return "contacts_state: (empty session)"

    facts = live_session_facts(session)
    task = get_mas_task(session)
    from app.mas.skills.state import SkillStateStore

    store = SkillStateStore()
    payload = {
        "active_skill_id": get_active_skill_id(session, "contacts"),
        "skill_session_state": store.summary_for_prompt(session, "contacts"),
        "active_executor": task.get("active_executor"),
        "active_domain": task.get("active_domain"),
        "draft_mode": facts.get("draft_mode"),
        "contact_create_in_progress": is_active_contact_creation(session),
        "live_session_facts": facts,
    }
    return "contacts_state:\n" + json.dumps(payload, ensure_ascii=False, default=str, indent=2)


__all__ = ["contacts_pipeline_context"]
