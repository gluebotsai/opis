"""Skill manifests — how the domain knows what each executor does."""

from __future__ import annotations

from typing import Any, TypedDict


class Skill(TypedDict, total=False):
    id: str
    does: str
    needs: list[str]
    provides: list[str]
    failure: str  # soft | hard


_SKILLS: dict[str, Skill] = {}


def register_skill(skill: Skill) -> None:
    eid = str(skill.get("id") or "").strip()
    if not eid:
        raise ValueError("skill.id is required")
    _SKILLS[eid] = skill


def all_skills() -> dict[str, Skill]:
    return dict(_SKILLS)


def get_skill(executor_id: str) -> Skill | None:
    return _SKILLS.get(executor_id)


def find_provider(need: str) -> str | None:
    """First registered executor that provides this need."""
    want = str(need or "").strip()
    if not want:
        return None
    for eid, skill in _SKILLS.items():
        provides = skill.get("provides") or []
        if want in provides:
            return eid
    return None


def skill_failure_mode(executor_id: str) -> str:
    skill = _SKILLS.get(executor_id) or {}
    mode = str(skill.get("failure") or "hard").strip().lower()
    return mode if mode in ("soft", "hard") else "hard"


def skill_to_dict(skill: Skill) -> dict[str, Any]:
    return dict(skill)
