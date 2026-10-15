"""Generic module skill selector — LLM picks skill + action from memory and state."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class SkillPick:
    ok: bool
    executor_id: str = ""
    skill_id: str = ""
    skill_action: str = "continue"
    restated_query: str = ""
    change_summary: str = ""
    direct_reply: str = ""
    error: str = ""
    llm: dict[str, Any] | None = None
    user_confirmed: bool | None = None
    needs_domain: str = ""
    preferred_executor: str = ""


async def select_audience_skill(
    *,
    package_dir: Path,
    query: str,
    session: dict[str, Any] | None,
    module_hint: str = "",
) -> SkillPick:
    """Audience module: Domain LLM selects executor + contact skill."""
    from app.mas.runtime.llm_loop import llm_pick_audience_executor

    raw = await llm_pick_audience_executor(
        package_dir=package_dir,
        query=query,
        session=session,
        module_hint=module_hint,
    )
    if not raw.get("ok"):
        return SkillPick(
            ok=False,
            error=str(raw.get("error") or "Skill selection failed"),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    direct = str(raw.get("direct_reply") or "").strip()
    if direct:
        return SkillPick(
            ok=True,
            direct_reply=direct,
            change_summary=str(raw.get("change_summary") or ""),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    pick = SkillPick(
        ok=True,
        executor_id=str(raw.get("executor_id") or "").strip().lower(),
        restated_query=str(raw.get("restated_query") or query).strip(),
        change_summary=str(raw.get("change_summary") or ""),
        llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
    )
    if raw.get("user_confirmed") is not None:
        pick.user_confirmed = bool(raw.get("user_confirmed"))
    if pick.executor_id == "contact":
        pick.skill_id = str(raw.get("skill_id") or "").strip().lower()
        pick.skill_action = str(raw.get("skill_action") or "continue").strip().lower()
    return pick


async def select_optimization_skill(
    *,
    package_dir: Path,
    query: str,
    session: dict[str, Any] | None,
    module_hint: str = "",
    task_spec: dict[str, Any] | None = None,
) -> SkillPick:
    """Optimization module: Domain LLM selects executor + monitoring skill when needed."""
    from app.mas.runtime.llm_loop import llm_pick_optimization_executor

    raw = await llm_pick_optimization_executor(
        package_dir=package_dir,
        query=query,
        session=session,
        module_hint=module_hint,
        task_spec=task_spec,
    )
    if not raw.get("ok"):
        return SkillPick(
            ok=False,
            error=str(raw.get("error") or "Skill selection failed"),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    direct = str(raw.get("direct_reply") or "").strip()
    if direct:
        return SkillPick(
            ok=True,
            direct_reply=direct,
            change_summary=str(raw.get("change_summary") or ""),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    pick = SkillPick(
        ok=True,
        executor_id=str(raw.get("executor_id") or "").strip().lower(),
        restated_query=str(raw.get("restated_query") or query).strip(),
        change_summary=str(raw.get("change_summary") or ""),
        llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
    )
    if raw.get("user_confirmed") is not None:
        pick.user_confirmed = bool(raw.get("user_confirmed"))
    if pick.executor_id in ("monitoring", "recovery"):
        pick.skill_id = str(raw.get("skill_id") or "").strip().lower()
        pick.skill_action = str(raw.get("skill_action") or "continue").strip().lower()
    if pick.executor_id == "analytics":
        pick.skill_id = str(raw.get("skill_id") or "").strip().lower()
        pick.skill_action = str(raw.get("skill_action") or "continue").strip().lower()
    return pick


async def select_creation_skill(
    *,
    package_dir: Path,
    query: str,
    session: dict[str, Any] | None,
    default_executor: str = "brief_validation",
) -> SkillPick:
    """Creation module: Domain LLM selects executor + create-campaign skill (or handoff)."""
    from app.mas.runtime.llm_loop import llm_pick_creation_action

    raw = await llm_pick_creation_action(
        package_dir=package_dir,
        query=query,
        default_executor=default_executor,
        session=session,
    )
    if raw.get("kind") == "direct_reply":
        return SkillPick(
            ok=True,
            direct_reply=str(raw.get("direct_reply") or "").strip(),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    if raw.get("kind") == "needs_domain":
        return SkillPick(
            ok=True,
            needs_domain=str(raw.get("domain_id") or "").strip().lower(),
            preferred_executor=str(raw.get("preferred_executor") or "").strip().lower(),
            restated_query=str(raw.get("restated_query") or query).strip(),
            change_summary=str(raw.get("change_summary") or ""),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    pick = SkillPick(
        ok=True,
        executor_id=str(raw.get("executor_id") or "").strip().lower(),
        restated_query=str(raw.get("restated_query") or query).strip(),
        change_summary=str(raw.get("change_summary") or ""),
        llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
    )
    if raw.get("user_confirmed") is not None:
        pick.user_confirmed = bool(raw.get("user_confirmed"))
    if pick.executor_id in (
        "brief_validation",
        "campaign_audience",
        "campaign_content",
        "launch_scheduling",
    ):
        pick.skill_id = str(raw.get("skill_id") or "").strip().lower()
        pick.skill_action = str(raw.get("skill_action") or "continue").strip().lower()
    return pick


async def select_recommendation_run_skill(
    *,
    package_dir: Path,
    query: str,
    session: dict[str, Any] | None,
    default_executor: str = "brief_validation",
) -> SkillPick:
    """Recommendation-run: Domain LLM selects shared create-campaign skill (or handoff)."""
    from app.mas.runtime.llm_loop import llm_pick_recommendation_run_action

    raw = await llm_pick_recommendation_run_action(
        package_dir=package_dir,
        query=query,
        default_executor=default_executor,
        session=session,
    )
    if raw.get("kind") == "direct_reply":
        return SkillPick(
            ok=True,
            direct_reply=str(raw.get("direct_reply") or "").strip(),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    if raw.get("kind") == "needs_domain":
        return SkillPick(
            ok=True,
            needs_domain=str(raw.get("domain_id") or "").strip().lower(),
            preferred_executor=str(raw.get("preferred_executor") or "").strip().lower(),
            restated_query=str(raw.get("restated_query") or query).strip(),
            change_summary=str(raw.get("change_summary") or ""),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    pick = SkillPick(
        ok=True,
        executor_id=str(raw.get("executor_id") or "").strip().lower(),
        restated_query=str(raw.get("restated_query") or query).strip(),
        change_summary=str(raw.get("change_summary") or ""),
        llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
    )
    if raw.get("user_confirmed") is not None:
        pick.user_confirmed = bool(raw.get("user_confirmed"))
    pick.skill_id = str(raw.get("skill_id") or "").strip().lower()
    pick.skill_action = str(raw.get("skill_action") or "continue").strip().lower()
    return pick


async def select_whatsapp_approved_run_skill(
    *,
    package_dir: Path,
    query: str,
    session: dict[str, Any] | None,
    default_executor: str = "campaign_audience",
) -> SkillPick:
    """Approved WA run: Domain LLM picks create + approved send skills (or handoff)."""
    from app.mas.runtime.llm_loop import llm_pick_whatsapp_approved_run_action

    raw = await llm_pick_whatsapp_approved_run_action(
        package_dir=package_dir,
        query=query,
        default_executor=default_executor,
        session=session,
    )
    if raw.get("kind") == "direct_reply":
        return SkillPick(
            ok=True,
            direct_reply=str(raw.get("direct_reply") or "").strip(),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    if raw.get("kind") == "needs_domain":
        return SkillPick(
            ok=True,
            needs_domain=str(raw.get("domain_id") or "").strip().lower(),
            preferred_executor=str(raw.get("preferred_executor") or "").strip().lower(),
            restated_query=str(raw.get("restated_query") or query).strip(),
            change_summary=str(raw.get("change_summary") or ""),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    pick = SkillPick(
        ok=True,
        executor_id=str(raw.get("executor_id") or "").strip().lower(),
        restated_query=str(raw.get("restated_query") or query).strip(),
        change_summary=str(raw.get("change_summary") or ""),
        llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
    )
    if raw.get("user_confirmed") is not None:
        pick.user_confirmed = bool(raw.get("user_confirmed"))
    pick.skill_id = str(raw.get("skill_id") or "").strip().lower()
    pick.skill_action = str(raw.get("skill_action") or "continue").strip().lower()
    return pick


async def select_library_run_skill(
    *,
    package_dir: Path,
    query: str,
    session: dict[str, Any] | None,
    default_executor: str = "brief_validation",
) -> SkillPick:
    """Library-run: Domain LLM selects isolated library_* skill (or handoff)."""
    from app.mas.runtime.llm_loop import llm_pick_library_run_action

    raw = await llm_pick_library_run_action(
        package_dir=package_dir,
        query=query,
        default_executor=default_executor,
        session=session,
    )
    if raw.get("kind") == "direct_reply":
        return SkillPick(
            ok=True,
            direct_reply=str(raw.get("direct_reply") or "").strip(),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    if raw.get("kind") == "needs_domain":
        return SkillPick(
            ok=True,
            needs_domain=str(raw.get("domain_id") or "").strip().lower(),
            preferred_executor=str(raw.get("preferred_executor") or "").strip().lower(),
            restated_query=str(raw.get("restated_query") or query).strip(),
            change_summary=str(raw.get("change_summary") or ""),
            llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
        )
    pick = SkillPick(
        ok=True,
        executor_id=str(raw.get("executor_id") or "").strip().lower(),
        restated_query=str(raw.get("restated_query") or query).strip(),
        change_summary=str(raw.get("change_summary") or ""),
        llm=raw.get("llm") if isinstance(raw.get("llm"), dict) else None,
    )
    if raw.get("user_confirmed") is not None:
        pick.user_confirmed = bool(raw.get("user_confirmed"))
    pick.skill_id = str(raw.get("skill_id") or "").strip().lower()
    pick.skill_action = str(raw.get("skill_action") or "continue").strip().lower()
    return pick


__all__ = [
    "SkillPick",
    "select_audience_skill",
    "select_optimization_skill",
    "select_creation_skill",
    "select_recommendation_run_skill",
    "select_whatsapp_approved_run_skill",
    "select_library_run_skill",
]
