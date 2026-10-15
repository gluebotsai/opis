"""Executor registry — add a new executor here + optional recipe step."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from app.mas.phase2_compose.executors import (
    brand_guidelines,
    compliance,
    compose,
    image,
    knowledge,
    plan,
)
from app.mas.phase2_compose.skills import Skill, all_skills, register_skill
from app.mas.phase2_compose.workspace import Workspace

Runner = Callable[[dict[str, Any], Workspace], Awaitable[dict[str, Any]]]

_RUNNERS: dict[str, Runner] = {}


def register(skill: Skill, runner: Runner) -> None:
    eid = str(skill.get("id") or "").strip()
    register_skill(skill)
    _RUNNERS[eid] = runner


def _bootstrap() -> None:
    if _RUNNERS:
        return
    register(knowledge.SKILL, knowledge.run)
    register(brand_guidelines.SKILL, brand_guidelines.run)
    register(plan.SKILL, plan.run)
    register(compliance.SKILL_PLAN, compliance.run_plan)
    register(image.SKILL, image.run)
    register(compose.SKILL, compose.run)
    register(compliance.SKILL_HTML, compliance.run_html)


def registered_ids() -> list[str]:
    _bootstrap()
    return list(_RUNNERS.keys())


async def run_executor(executor_id: str, ctx: dict[str, Any], workspace: Workspace) -> dict[str, Any]:
    _bootstrap()
    runner = _RUNNERS.get(executor_id)
    if runner is None:
        return {
            "ok": False,
            "status": "failed",
            "executor_id": executor_id,
            "error": f"Unknown executor_id: {executor_id}",
            "payload": {},
            "warnings": [],
        }
    return await runner(ctx, workspace)


def catalog() -> dict[str, Skill]:
    _bootstrap()
    return all_skills()
