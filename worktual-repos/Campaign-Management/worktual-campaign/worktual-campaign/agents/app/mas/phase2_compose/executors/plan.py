"""Plan executor — content + image slots before HTML."""

from __future__ import annotations

import json
import os
from typing import Any

from app.mas.phase2_compose.llm import PLAN_SYSTEM, achat_json
from app.mas.phase2_compose.schemas import EmailPlan, envelope, plan_from_dict
from app.mas.phase2_compose.skills import Skill
from app.mas.phase2_compose.workspace import Workspace

SKILL: Skill = {
    "id": "plan",
    "does": "Turn the request + knowledge into an email plan and image slots",
    "needs": ["query"],
    "provides": ["plan"],
    "failure": "hard",
}

PLAN_SYSTEM_PHASE2 = (
    PLAN_SYSTEM
    + "- If knowledge facts are provided, use them. Do not invent company addresses or stats.\n"
    "- If the user named a company/brand and knowledge is empty, return "
    '{"need_input": true, "need": "company_profile"} only.\n'
    "- If knowledge has no product/landing URL, content_brief must say no buttons.\n"
)


def _build_user_prompt(workspace: Workspace) -> str:
    parts = [f"User request:\n{workspace.query}"]
    if workspace.chat_summary and workspace.chat_summary != workspace.query:
        parts.append(f"Chat context:\n{workspace.chat_summary}")
    if workspace.prior_extract:
        parts.append(
            "Current session template (apply this turn's content_mode / image_mode; "
            "do not invent a blank email if keep was requested):\n"
            + json.dumps(workspace.prior_extract, indent=2)
        )
        if workspace.content_mode:
            parts.append(f"content_mode={workspace.content_mode}")
        if workspace.image_mode:
            parts.append(f"image_mode={workspace.image_mode}")
    if workspace.knowledge:
        mode = str((workspace.knowledge or {}).get("copy_mode") or "").strip()
        if mode == "illustrative":
            parts.append(
                "Knowledge facts (illustrative — write plausible industry copy; "
                "never [bracket] placeholders; do not invent prices/addresses):\n"
                + json.dumps(workspace.knowledge, indent=2)
            )
        else:
            parts.append(
                "Knowledge facts (use these; do not invent extras):\n"
                + json.dumps(workspace.knowledge, indent=2)
            )
    else:
        parts.append("Knowledge facts: none.")
    from app.mas.phase2_compose.plugin import cta_constraint_for_compose

    parts.append(
        cta_constraint_for_compose(
            knowledge=workspace.knowledge,
            query=workspace.query,
            chat_summary=workspace.chat_summary,
            destination_url=workspace.destination_url,
        )
    )
    if workspace.brand_guidelines:
        parts.append(
            "Brand guidelines (logo/banner/footer/colors — use only provided URLs):\n"
            + json.dumps(workspace.brand_guidelines, indent=2)
        )
    return "\n\n".join(parts)


def _named_company_without_facts(workspace: Workspace) -> bool:
    if workspace.knowledge:
        return False
    q = workspace.query.lower()
    hints = ("company", "brand", "corp", "inc", "ltd", "technologies")
    return any(h in q for h in hints)


async def run(ctx: dict[str, Any], workspace: Workspace) -> dict[str, Any]:
    if not workspace.query.strip():
        return envelope(
            executor_id="plan",
            status="failed",
            ok=False,
            error="query or enhanced_request is required",
        )

    force_need = os.environ.get("COMPOSE_FORCE_NEED_INPUT", "").strip() in ("1", "true", "yes")
    already = "company_profile" in workspace.needs_resolved
    if force_need and not already:
        return envelope(
            executor_id="plan",
            status="need_input",
            ok=False,
            need="company_profile",
        )
    if _named_company_without_facts(workspace) and not already:
        return envelope(
            executor_id="plan",
            status="need_input",
            ok=False,
            need="company_profile",
        )

    raw = await achat_json(system=PLAN_SYSTEM_PHASE2, user=_build_user_prompt(workspace))
    if raw.get("need_input") or raw.get("need"):
        need = str(raw.get("need") or "company_profile")
        if need not in workspace.needs_resolved:
            return envelope(
                executor_id="plan",
                status="need_input",
                ok=False,
                need=need,
            )

    plan: EmailPlan = plan_from_dict(raw)
    if not plan.get("content_brief"):
        plan["content_brief"] = workspace.query
    if not plan.get("subject") and not raw:
        return envelope(
            executor_id="plan",
            status="failed",
            ok=False,
            error="plan_json_empty",
        )

    return envelope(
        executor_id="plan",
        status="completed",
        payload={"plan": dict(plan)},
    )


async def run_plan_executor(ctx: dict[str, Any]) -> dict[str, Any]:
    """Legacy wrapper used by older callers."""
    from app.mas.phase2_compose.workspace import Workspace as WS

    ws = WS.from_ctx(ctx)
    out = await run(ctx, ws)
    if out.get("status") == "completed":
        return {
            "ok": True,
            "action_status": "completed",
            "executor_id": "plan",
            "plan": (out.get("payload") or {}).get("plan") or {},
        }
    return {
        "ok": False,
        "action_status": "failed",
        "executor_id": "plan",
        "error": out.get("error") or out.get("status"),
    }
