"""Shared MAS runtime context for Super, Domain, and Executor prompts."""

from __future__ import annotations

import json
from typing import Any

from app.mas.runtime.task_memory import get_mas_task


def recent_routing_history(
    session: dict[str, Any] | None,
    *,
    limit: int = 8,
) -> list[dict[str, str]]:
    """Last N user/assistant turns for Super/Domain/Executor (from llm_memory)."""
    if not isinstance(session, dict):
        return []
    from app.session_store import get_llm_memory

    mem = get_llm_memory(session)
    turns: list[dict[str, str]] = []
    for row in mem:
        if not isinstance(row, dict):
            continue
        role = str(row.get("role") or "").strip().lower()
        if role not in ("user", "assistant"):
            continue
        if row.get("tool_calls"):
            continue
        content = str(row.get("content") or "").strip()
        if not content:
            continue
        turns.append({"role": role, "content": content})
    if len(turns) <= limit:
        return turns
    return turns[-limit:]


def build_mas_runtime_context(
    session: dict[str, Any] | None,
    *,
    module_hint: str = "",
) -> str:
    """Live facts every MAS layer may read — routing hints only, not Python routing."""
    from app.mas.runtime.temporal_context import build_temporal_context_block

    temporal = build_temporal_context_block(session if isinstance(session, dict) else None)
    if not isinstance(session, dict):
        return f"module_hint: (none)\nmas_task: (empty session)\n\n{temporal}"

    from app.industry_packs.loader import normalize_campaign_profile

    task = get_mas_task(session)
    draft = session.get("draft_contact") if isinstance(session.get("draft_contact"), dict) else {}
    profile = normalize_campaign_profile(session.get("campaign_profile"))
    pack = session.get("company_pack") if isinstance(session.get("company_pack"), dict) else {}
    seed = str(pack.get("seed_industry_type") or "").strip()
    industry_type = str(profile.get("industry_type") or seed or "")
    industry_context = {
        "mode": profile.get("mode") or "b2b",
        "industry": profile.get("industry") or "",
        "industry_type": industry_type,
    }
    steps = list(task.get("steps") or [])[-3:]
    step_lines = []
    for row in steps:
        if not isinstance(row, dict):
            continue
        step_lines.append(
            f"- {row.get('executor_id')}: {row.get('action_status')} — "
            f"{str(row.get('message') or '')[:120]}"
        )

    parts = [
        temporal,
        f"module_hint: {str(module_hint or session.get('module') or '').strip() or '(none)'}",
        f"active_domain: {task.get('active_domain')!r}",
        f"active_executor: {task.get('active_executor')!r}",
        f"draft_mode: {session.get('draft_mode')!r}",
        f"focus_contact_id: {session.get('focus_contact_id')!r}",
        (
            "draft_contact: "
            + json.dumps(
                {
                    k: str(draft.get(k) or "").strip()
                    for k in (
                        "first_name",
                        "last_name",
                        "email",
                        "phone",
                        "company_name",
                        "city",
                    )
                }
                | {
                    "pack_fields_skipped": [
                        p.strip()
                        for p in str(draft.get("pack_fields_skipped") or "").split(",")
                        if p.strip()
                    ]
                },
                ensure_ascii=False,
            )
        ),
        "recent_mas_steps:\n" + ("\n".join(step_lines) if step_lines else "(none)"),
        "industry_context: " + json.dumps(industry_context, ensure_ascii=False),
    ]
    note = str(session.get("chat_memory_note") or "").strip()
    if note:
        parts.append(f"chat_memory_note:\n{note}")
    chat_turns = recent_routing_history(session, limit=8)
    if chat_turns:
        parts.append(
            "recent_chat:\n"
            + json.dumps(chat_turns, ensure_ascii=False, indent=2)
        )
    mod = str(module_hint or session.get("module") or "").strip().lower()
    if mod == "contacts":
        from app.mas.skills.state import SkillStateStore

        skill_block = SkillStateStore().summary_for_prompt(session, "contacts")
        if skill_block and skill_block != "active_skill: (none)":
            parts.append(f"module_skills:\n{skill_block}")
    guidance = super_routing_guidance(module_hint or session.get("module"))
    if guidance:
        parts.append(guidance)
    if mod == "contacts":
        from app.mas.runtime.contacts_context import contacts_pipeline_context

        parts.append(contacts_pipeline_context(session))
    if mod in ("create_campaign", "recommendations"):
        from app.mas.runtime.creation_context import creation_pipeline_context

        parts.append(creation_pipeline_context(session))
    return "\n".join(parts)


def super_routing_guidance(module_hint: str | None) -> str:
    """Non-regex SPA scope hints for Super/Domain prompts (not chat intent parsing)."""
    from app.mas.catalog import MODULE_TO_DOMAIN

    mod = str(module_hint or "").strip().lower()
    if not mod:
        return ""
    domain = MODULE_TO_DOMAIN.get(mod)
    if mod == "contacts":
        return (
            "routing_guidance: User is in the Audience/contacts SPA. "
            "route_to_domain MUST use domain_id=audience for all contact/audience work "
            "unless they explicitly ask to leave (e.g. create a campaign, forms, reports)."
        )
    if domain:
        labels = {
            "creation": "Campaign Creation",
            "optimization": "Campaign Optimization",
            "content": "Content",
            "forms": "Forms",
        }
        label = labels.get(domain, domain)
        base = (
            f"routing_guidance: User is in the {mod} SPA ({label}). "
            f"route_to_domain MUST use domain_id={domain} for work in this module "
            "unless they clearly switch to another product area."
        )
        if mod in ("create_campaign", "recommendations"):
            base += (
                " Template generation, hero/banner images, build_campaign, audience on "
                "this campaign, and launch/scheduling belong in creation — never route "
                "template build to content domain. Use content only for template coach, "
                "WhatsApp verification, or approved send outside this campaign build."
            )
        return base
    return ""
