"""
Invoice Dunning Agent.

Staged Reminder -> Warning -> Service-Pause-Notice cadence for one overdue
invoice, advancing at most one stage per run and drafting the stage-
appropriate message for a human to review and send.

Prompt source of truth: agents/invoice-dunning/agent.md (see
.cursor/skills/build-nlp-agents — non-negotiable #1). Primary path: LLM
returns structured nextStage/reason/message JSON. Heuristic fallback is
offline-only.

HITL rule (hard constraint): matches invoice_escalation_agent's guardrail —
this agent only ever writes the dunningStage/dunningStageSentAt/dunningDraft
overlay fields on Invoice (plus a notification). It never marks an invoice
paid/void, never changes dueAt/total, and never sends dunningDraft itself.
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict, Optional
from uuid import uuid4

from app.agents.agent_md import agent_md_path, load_agent_md
from app.agents.native_pipeline import run_steps
from app.agents.llm_result import (
    generate_json_with_retries,
    label_ai,
    label_fallback,
    sectioned_system_prompt,
)
from app.agents.step_trace import traced_step
from app.crm_client import CrmClient

logger = logging.getLogger(__name__)

INVOICE_DUNNING_MODULE_PATH = "invoice-dunning"
INVOICE_DUNNING_AGENT = "invoice_dunning"

DUNNING_STAGES = ("none", "reminder", "warning", "pause_notice")
_STAGE_INDEX = {stage: idx for idx, stage in enumerate(DUNNING_STAGES)}

_SECTIONS = load_agent_md(agent_md_path(__file__, "invoice-dunning"))


class InvoiceDunningState(TypedDict, total=False):
    invoice_id: str
    organization_id: Optional[str]
    job_id: str
    context: dict[str, Any]
    decision: dict[str, Any]
    status: str
    source: str
    reason: Optional[str]
    persist_result: dict[str, Any]


INVOICE_DUNNING_SYSTEM = sectioned_system_prompt(
    role=_SECTIONS["role"],
    goal=_SECTIONS["goal"],
    instructions=_SECTIONS["instructions"],
    context=_SECTIONS.get("context", ""),
    output=_SECTIONS["output"],
    guardrails=_SECTIONS["guardrails"],
)


def _context_user_payload(ctx: dict[str, Any]) -> str:
    lines = [
        f"Invoice: {ctx.get('number')} ({ctx.get('status')})",
        f"Amount due: {ctx.get('total')} {ctx.get('currency')}",
        f"Days overdue: {ctx.get('daysOverdue')}",
        f"Current dunning stage: {ctx.get('dunningStage') or 'none'}",
        f"Last stage message sent at: {ctx.get('dunningStageSentAt') or 'never'}",
        f"Company collection risk (if known): {ctx.get('collectionRiskLevel') or 'unknown'}",
    ]
    return "\n".join(lines)


def _normalize_llm_dunning(
    current_stage: str,
) -> Any:
    def _validate(parsed: dict[str, Any]) -> dict[str, Any] | None:
        next_stage = str(parsed.get("nextStage") or "").strip().lower()
        if next_stage not in _STAGE_INDEX:
            return None
        # Hard guardrail, enforced in code, not just prompt: never allow the
        # LLM to skip more than one stage forward in a single run.
        if _STAGE_INDEX[next_stage] > _STAGE_INDEX.get(current_stage, 0) + 1:
            next_stage = DUNNING_STAGES[min(_STAGE_INDEX.get(current_stage, 0) + 1, len(DUNNING_STAGES) - 1)]
        reason = str(parsed.get("reason") or "").strip()
        if not reason:
            return None
        message = str(parsed.get("message") or "").strip()
        if next_stage != current_stage and not message:
            return None
        return {
            "nextStage": next_stage,
            "reason": reason[:500],
            "message": message[:2000],
        }

    return _validate


async def decide_via_llm(
    ctx: dict[str, Any],
) -> tuple[dict[str, Any] | None, str | None]:
    current_stage = str(ctx.get("dunningStage") or "none")
    return await generate_json_with_retries(
        system=INVOICE_DUNNING_SYSTEM,
        user=_context_user_payload(ctx),
        max_tokens=800,
        repair_hint=(
            "Convert into ONLY valid JSON with keys nextStage, reason, "
            "message. No markdown."
        ),
        validate=_normalize_llm_dunning(current_stage),
    )


def decide_invoice_dunning_heuristic(ctx: dict[str, Any]) -> dict[str, Any]:
    """Offline fallback — days-since-last-stage thresholds as a floor."""
    current_stage = str(ctx.get("dunningStage") or "none")
    days_overdue = ctx.get("daysOverdue")
    days_overdue = days_overdue if isinstance(days_overdue, (int, float)) else 0
    number = ctx.get("number") or "this invoice"
    total = ctx.get("total")

    if current_stage == "none" and days_overdue > 0:
        next_stage = "reminder"
    elif current_stage == "reminder" and days_overdue > 14:
        next_stage = "warning"
    elif current_stage == "warning" and days_overdue > 30:
        next_stage = "pause_notice"
    else:
        next_stage = current_stage

    if next_stage == current_stage:
        return {
            "nextStage": current_stage,
            "reason": f"No stage change — {days_overdue}d overdue, already at {current_stage}.",
            "message": "",
        }

    messages = {
        "reminder": (
            f"Hi, just a friendly reminder that invoice {number} for {total} is now "
            "past due. Please let us know if you have any questions."
        ),
        "warning": (
            f"Invoice {number} for {total} is now {days_overdue} days overdue. "
            "Please arrange payment as soon as possible to avoid any disruption."
        ),
        "pause_notice": (
            f"Invoice {number} for {total} remains unpaid at {days_overdue} days "
            "overdue. Continued non-payment may affect your account/service — "
            "please contact us to resolve this."
        ),
    }
    return {
        "nextStage": next_stage,
        "reason": f"{days_overdue} day(s) overdue, advancing from {current_stage} to {next_stage}.",
        "message": messages.get(next_stage, ""),
    }


async def load_context(state: InvoiceDunningState) -> InvoiceDunningState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_invoice_dunning_context(state["invoice_id"])
    return {**state, "context": ctx}


async def decide(state: InvoiceDunningState) -> InvoiceDunningState:
    ctx = state.get("context") or {}
    if not ctx:
        return {
            **state,
            "decision": None,
            "status": "skipped",
            "source": "heuristic",
            "reason": "invoice_not_found",
        }

    decision, llm_reason = await decide_via_llm(ctx)
    source = "ai"
    reason: str | None = None
    if decision is None:
        logger.warning(
            "invoice-dunning LLM unavailable after retries; using heuristic "
            "fallback invoice=%s reason=%s",
            state.get("invoice_id"),
            llm_reason,
        )
        decision = decide_invoice_dunning_heuristic(ctx)
        source = "heuristic"
        reason = llm_reason or "llm_failed"

    domain_reason = str(decision.get("reason") or "").strip()
    tagged = (
        label_ai(decision) if source == "ai" else label_fallback(decision, reason or "llm_failed")
    )
    decision_clean = {k: v for k, v in tagged.items() if k != "source"}
    if domain_reason:
        decision_clean["reason"] = domain_reason
    return {
        **state,
        "decision": decision_clean,
        "status": "decided",
        "source": source,
        "reason": reason,
    }


async def persist(state: InvoiceDunningState) -> InvoiceDunningState:
    decision = state.get("decision")
    if not decision:
        return {**state, "persist_result": {"status": "skipped"}, "status": "skipped"}

    client = CrmClient(state.get("organization_id"))
    result = await client.persist_invoice_dunning(state["invoice_id"], decision)
    return {
        **state,
        "persist_result": result,
        "status": result.get("status") or state.get("status"),
    }


def _detail_load_context(
    _before: InvoiceDunningState, after: InvoiceDunningState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {
        "dunningStage": ctx.get("dunningStage"),
        "daysOverdue": ctx.get("daysOverdue"),
    }


def _detail_decide(
    _before: InvoiceDunningState, after: InvoiceDunningState
) -> dict[str, Any] | None:
    decision = after.get("decision") or {}
    return {"nextStage": decision.get("nextStage"), "source": after.get("source")}


def _detail_persist(
    _before: InvoiceDunningState, after: InvoiceDunningState
) -> dict[str, Any] | None:
    result = after.get("persist_result") or {}
    return {"status": result.get("status") or after.get("status")}


_PIPELINE_STEPS = (
    traced_step(
        INVOICE_DUNNING_MODULE_PATH,
        INVOICE_DUNNING_AGENT,
        "load_context",
        "Loading invoice + dunning stage",
        _detail_load_context,
        id_field="invoice_id",
        job_id_field="job_id",
    )(load_context),
    traced_step(
        INVOICE_DUNNING_MODULE_PATH,
        INVOICE_DUNNING_AGENT,
        "decide",
        "Deciding next dunning stage",
        _detail_decide,
        id_field="invoice_id",
        job_id_field="job_id",
    )(decide),
    traced_step(
        INVOICE_DUNNING_MODULE_PATH,
        INVOICE_DUNNING_AGENT,
        "persist",
        "Saving stage & drafting message",
        _detail_persist,
        id_field="invoice_id",
        job_id_field="job_id",
    )(persist),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(invoice_id: str, organization_id: str | None = None) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "invoice_id": invoice_id,
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "status": "running",
        }
    )
    return {
        "invoiceId": invoice_id,
        "status": result.get("status") or "failed",
        "source": result.get("source") or "heuristic",
        "reason": result.get("reason"),
        "decision": result.get("decision"),
        "persistResult": result.get("persist_result"),
    }
