"""Compliance executor — stub rules; blocking vs soft."""

from __future__ import annotations

import os
from typing import Any

from app.mas.phase2_compose.schemas import envelope
from app.mas.phase2_compose.skills import Skill
from app.mas.phase2_compose.workspace import Workspace

SKILL_PLAN: Skill = {
    "id": "compliance_plan",
    "does": "Check plan copy against stub regulation rules",
    "needs": ["plan"],
    "provides": ["compliance_plan"],
    "failure": "hard",
}

SKILL_HTML: Skill = {
    "id": "compliance_html",
    "does": "Check compiled HTML against stub regulation rules",
    "needs": ["compiled_html"],
    "provides": ["compliance_html"],
    "failure": "hard",
}

_BLOCK_TERMS = ("guaranteed cure", "clinically proven miracle")
_SOFT_DISCOUNT = ("% off", "coupon code", "use code")


def _promotes_discount(text: str) -> bool:
    """True if copy pushes a discount, not if it merely forbids one."""
    if "no discount" in text or "without discount" in text or "no offers" in text:
        return False
    return any(x in text for x in _SOFT_DISCOUNT) or (
        " discount" in f" {text}" and "no discount" not in text
    )


def _text_from_workspace(workspace: Workspace, mode: str) -> str:
    if mode == "html":
        return workspace.compiled_html.lower()
    plan = workspace.plan or {}
    bits = [
        str(plan.get("subject") or ""),
        str(plan.get("preheader") or ""),
        str(plan.get("content_brief") or ""),
    ]
    return " ".join(bits).lower()


def _is_letter(workspace: Workspace) -> bool:
    kind = str((workspace.plan or {}).get("email_kind") or "").lower()
    if kind in ("letter", "congratulations", "thank_you", "reminder"):
        return True
    brief = str((workspace.plan or {}).get("content_brief") or "").lower()
    query = workspace.query.lower()
    blob = brief + " " + query
    return any(w in blob for w in ("letter", "congrat", "sentences only", "thank-you", "thank you"))


async def _run(workspace: Workspace, *, mode: str, executor_id: str) -> dict[str, Any]:
    if os.environ.get("COMPOSE_FORCE_COMPLIANCE_BLOCK", "").strip() in ("1", "true", "yes"):
        return envelope(
            executor_id=executor_id,
            status="failed",
            ok=False,
            error="compliance_blocked",
            payload={"violations": ["forced_block"]},
        )

    text = _text_from_workspace(workspace, mode)
    for term in _BLOCK_TERMS:
        if term in text:
            return envelope(
                executor_id=executor_id,
                status="failed",
                ok=False,
                error="compliance_blocked",
                payload={"violations": [term]},
            )

    warnings: list[str] = []
    if _is_letter(workspace) and _promotes_discount(text):
        warnings.append("compliance_soft:letter_has_discount_language")

    return envelope(
        executor_id=executor_id,
        status="completed",
        payload={},
        warnings=warnings,
    )


async def run_plan(ctx: dict[str, Any], workspace: Workspace) -> dict[str, Any]:
    return await _run(workspace, mode="plan", executor_id="compliance_plan")


async def run_html(ctx: dict[str, Any], workspace: Workspace) -> dict[str, Any]:
    return await _run(workspace, mode="html", executor_id="compliance_html")
