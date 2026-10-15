"""
Company Collection Risk Agent.

Aggregates a customer company's invoice payment history into a company-level
risk band (none|watch|risk) — distinct from invoice_escalation_agent's
per-invoice severity, this looks at the pattern across the whole account.

Prompt source of truth: agents/company-collection-risk/agent.md (see
.cursor/skills/build-nlp-agents — non-negotiable #1). Primary path: LLM
returns structured riskLevel/reason JSON. Heuristic fallback is offline-only.

HITL rule (hard constraint): this agent only ever writes the three
collectionRisk* overlay fields on Company (plus a notification) — flag only,
never blocks/pauses the account.
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

COLLECTION_RISK_MODULE_PATH = "company-collection-risk"
COLLECTION_RISK_AGENT = "company_collection_risk"

RISK_LEVELS = {"none", "watch", "risk"}

_SECTIONS = load_agent_md(agent_md_path(__file__, "company-collection-risk"))


class CollectionRiskState(TypedDict, total=False):
    company_id: str
    organization_id: Optional[str]
    job_id: str
    context: dict[str, Any]
    decision: dict[str, Any]
    status: str
    source: str
    reason: Optional[str]
    persist_result: dict[str, Any]


COLLECTION_RISK_SYSTEM = sectioned_system_prompt(
    role=_SECTIONS["role"],
    goal=_SECTIONS["goal"],
    instructions=_SECTIONS["instructions"],
    context=_SECTIONS.get("context", ""),
    output=_SECTIONS["output"],
    guardrails=_SECTIONS["guardrails"],
)


def _context_user_payload(ctx: dict[str, Any]) -> str:
    history = ctx.get("invoiceHistory") or []
    history_lines = (
        "\n".join(
            f"- {h.get('number')}: {h.get('status')}, {h.get('daysLate')} "
            f"day(s) late, amount {h.get('total')}"
            for h in history[:15]
        )
        or "no invoice history on file"
    )
    open_lines = (
        "\n".join(
            f"- {o.get('number')}: {o.get('daysOverdue')} day(s) overdue, "
            f"amount {o.get('total')}"
            for o in (ctx.get("openInvoices") or [])[:10]
        )
        or "none"
    )
    lines = [
        f"Company: {ctx.get('companyName') or ctx.get('companyId')}",
        f"Total invoices on file: {ctx.get('totalInvoiceCount')}",
        f"Prior invoice payment history (most recent first):\n{history_lines}",
        f"Currently open/overdue invoices:\n{open_lines}",
        f"Previous risk assessment: level={ctx.get('collectionRiskLevel') or 'none'} "
        f"reason={ctx.get('collectionRiskReason') or 'none'}",
    ]
    return "\n".join(lines)


def _normalize_llm_risk(parsed: dict[str, Any]) -> dict[str, Any] | None:
    level = str(parsed.get("riskLevel") or "").strip().lower()
    if level not in RISK_LEVELS:
        return None
    reason = str(parsed.get("reason") or "").strip()
    if not reason:
        return None
    return {"riskLevel": level, "reason": reason[:500]}


async def decide_via_llm(ctx: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    return await generate_json_with_retries(
        system=COLLECTION_RISK_SYSTEM,
        user=_context_user_payload(ctx),
        max_tokens=600,
        repair_hint=(
            "Convert into ONLY valid JSON with keys riskLevel, reason. No markdown."
        ),
        validate=_normalize_llm_risk,
    )


def decide_collection_risk_heuristic(ctx: dict[str, Any]) -> dict[str, Any]:
    """Offline fallback — simple overdue-count/lateness thresholds as a floor."""
    open_invoices = ctx.get("openInvoices") or []
    history = ctx.get("invoiceHistory") or []
    late_days = [
        h.get("daysLate")
        for h in history
        if isinstance(h.get("daysLate"), (int, float)) and h.get("daysLate", 0) > 0
    ]
    late_count = len(late_days)
    avg_late = sum(late_days) / len(late_days) if late_days else 0
    max_overdue = max(
        (o.get("daysOverdue") or 0 for o in open_invoices if isinstance(o.get("daysOverdue"), (int, float))),
        default=0,
    )

    if max_overdue > 45 or (late_count >= 3 and avg_late > 20):
        level = "risk"
    elif max_overdue > 14 or late_count >= 2:
        level = "watch"
    else:
        level = "none"

    reason = (
        f"{late_count} prior late payment(s) (avg {avg_late:.0f}d late), "
        f"largest current overdue {max_overdue}d"
    )[:500]
    return {"riskLevel": level, "reason": reason}


async def load_context(state: CollectionRiskState) -> CollectionRiskState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_collection_risk_context(state["company_id"])
    return {**state, "context": ctx}


async def decide(state: CollectionRiskState) -> CollectionRiskState:
    ctx = state.get("context") or {}
    if not ctx:
        return {
            **state,
            "decision": None,
            "status": "skipped",
            "source": "heuristic",
            "reason": "company_not_found",
        }

    decision, llm_reason = await decide_via_llm(ctx)
    source = "ai"
    reason: str | None = None
    if decision is None:
        logger.warning(
            "company-collection-risk LLM unavailable after retries; using "
            "heuristic fallback company=%s reason=%s",
            state.get("company_id"),
            llm_reason,
        )
        decision = decide_collection_risk_heuristic(ctx)
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


async def persist(state: CollectionRiskState) -> CollectionRiskState:
    decision = state.get("decision")
    if not decision:
        return {**state, "persist_result": {"status": "skipped"}, "status": "skipped"}

    client = CrmClient(state.get("organization_id"))
    result = await client.persist_collection_risk(state["company_id"], decision)
    return {
        **state,
        "persist_result": result,
        "status": result.get("status") or state.get("status"),
    }


def _detail_load_context(
    _before: CollectionRiskState, after: CollectionRiskState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {
        "totalInvoiceCount": ctx.get("totalInvoiceCount"),
        "openInvoiceCount": len(ctx.get("openInvoices") or []),
    }


def _detail_decide(
    _before: CollectionRiskState, after: CollectionRiskState
) -> dict[str, Any] | None:
    decision = after.get("decision") or {}
    return {"riskLevel": decision.get("riskLevel"), "source": after.get("source")}


def _detail_persist(
    _before: CollectionRiskState, after: CollectionRiskState
) -> dict[str, Any] | None:
    result = after.get("persist_result") or {}
    return {"status": result.get("status") or after.get("status")}


_PIPELINE_STEPS = (
    traced_step(
        COLLECTION_RISK_MODULE_PATH,
        COLLECTION_RISK_AGENT,
        "load_context",
        "Loading company invoice history",
        _detail_load_context,
        id_field="company_id",
        job_id_field="job_id",
    )(load_context),
    traced_step(
        COLLECTION_RISK_MODULE_PATH,
        COLLECTION_RISK_AGENT,
        "decide",
        "Judging collections risk pattern",
        _detail_decide,
        id_field="company_id",
        job_id_field="job_id",
    )(decide),
    traced_step(
        COLLECTION_RISK_MODULE_PATH,
        COLLECTION_RISK_AGENT,
        "persist",
        "Saving risk band",
        _detail_persist,
        id_field="company_id",
        job_id_field="job_id",
    )(persist),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(company_id: str, organization_id: str | None = None) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "company_id": company_id,
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "status": "running",
        }
    )
    return {
        "companyId": company_id,
        "status": result.get("status") or "failed",
        "source": result.get("source") or "heuristic",
        "reason": result.get("reason"),
        "decision": result.get("decision"),
        "persistResult": result.get("persist_result"),
    }
