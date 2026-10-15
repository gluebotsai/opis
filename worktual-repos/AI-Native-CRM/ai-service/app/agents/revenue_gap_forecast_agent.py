"""
Revenue Gap Forecast Agent.

Per-organization: looks at revenue collected this period against configured
targets (if any) and at-risk (open overdue/near-close) invoices, and
produces a short forecast narrative + ranked at-risk list for the Finance
dashboard card.

Prompt source of truth: agents/revenue-gap-forecast/agent.md (see
.cursor/skills/build-nlp-agents — non-negotiable #1). Primary path: LLM
returns structured forecast JSON. Heuristic fallback is offline-only.

HITL rule (hard constraint): this agent is entirely read-only — it only
writes the cached revenueForecastLastRun* fields on OrgFinanceSettings for
the dashboard card to read; it never modifies any invoice, deal, or finance
setting, and never contacts a customer.
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

REVENUE_GAP_MODULE_PATH = "revenue-gap-forecast"
REVENUE_GAP_AGENT = "revenue_gap_forecast"

_SECTIONS = load_agent_md(agent_md_path(__file__, "revenue-gap-forecast"))


class RevenueGapState(TypedDict, total=False):
    organization_id: str
    job_id: str
    context: dict[str, Any]
    decision: dict[str, Any]
    status: str
    source: str
    reason: Optional[str]
    persist_result: dict[str, Any]


REVENUE_GAP_SYSTEM = sectioned_system_prompt(
    role=_SECTIONS["role"],
    goal=_SECTIONS["goal"],
    instructions=_SECTIONS["instructions"],
    context=_SECTIONS.get("context", ""),
    output=_SECTIONS["output"],
    guardrails=_SECTIONS["guardrails"],
)


def _context_user_payload(ctx: dict[str, Any]) -> str:
    at_risk = ctx.get("atRiskInvoices") or []
    at_risk_lines = (
        "\n".join(
            f"- id={i.get('id')} {i.get('number')}: {i.get('total')} "
            f"{i.get('currency')}, {i.get('daysOverdue')}d overdue "
            f"(company={i.get('companyName') or '—'})"
            for i in at_risk[:15]
        )
        or "none"
    )
    target_monthly = ctx.get("revenueTargetMonthly")
    target_quarterly = ctx.get("revenueTargetQuarterly")
    lines = [
        f"Period: {ctx.get('periodLabel') or 'this period'}",
        f"Collected revenue this period: {ctx.get('collectedRevenue')} {ctx.get('currency') or ''}",
        f"Monthly target: {target_monthly if target_monthly is not None else 'not set'}",
        f"Quarterly target: {target_quarterly if target_quarterly is not None else 'not set'}",
        f"At-risk (open overdue/near-close) invoices, ranked by value:\n{at_risk_lines}",
    ]
    return "\n".join(lines)


def _normalize_llm_forecast(parsed: dict[str, Any]) -> dict[str, Any] | None:
    narrative = str(parsed.get("narrative") or "").strip()
    if not narrative:
        return None
    has_target = bool(parsed.get("hasTarget"))
    at_risk_ids = parsed.get("atRiskInvoiceIds")
    if not isinstance(at_risk_ids, list):
        at_risk_ids = []
    at_risk_ids = [str(i) for i in at_risk_ids if isinstance(i, (str, int))][:8]
    gap_scenario = str(parsed.get("gapScenario") or "").strip() if has_target else ""
    return {
        "hasTarget": has_target,
        "narrative": narrative[:1200],
        "atRiskInvoiceIds": at_risk_ids,
        "gapScenario": gap_scenario[:800],
    }


async def decide_via_llm(ctx: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    return await generate_json_with_retries(
        system=REVENUE_GAP_SYSTEM,
        user=_context_user_payload(ctx),
        max_tokens=900,
        repair_hint=(
            "Convert into ONLY valid JSON with keys hasTarget, narrative, "
            "atRiskInvoiceIds, gapScenario. No markdown."
        ),
        validate=_normalize_llm_forecast,
    )


def decide_revenue_gap_heuristic(ctx: dict[str, Any]) -> dict[str, Any]:
    """Offline fallback — plain totals, no narrative reasoning."""
    at_risk = ctx.get("atRiskInvoices") or []
    at_risk_total = sum(
        float(i.get("total") or 0) for i in at_risk if isinstance(i.get("total"), (int, float))
    )
    collected = ctx.get("collectedRevenue")
    target = ctx.get("revenueTargetMonthly") or ctx.get("revenueTargetQuarterly")
    has_target = target is not None
    if has_target and isinstance(collected, (int, float)):
        gap = float(target) - float(collected)
        narrative = (
            f"Collected {collected}, target {target} — gap of {gap:.0f}. "
            f"{len(at_risk)} at-risk invoice(s) totalling {at_risk_total:.0f}."
        )
    else:
        narrative = (
            f"No revenue target configured. {len(at_risk)} at-risk invoice(s) "
            f"totalling {at_risk_total:.0f}."
        )
    return {
        "hasTarget": has_target,
        "narrative": narrative[:1200],
        "atRiskInvoiceIds": [str(i.get("id")) for i in at_risk[:8] if i.get("id")],
        "gapScenario": "",
    }


async def load_context(state: RevenueGapState) -> RevenueGapState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_revenue_gap_context(state["organization_id"])
    return {**state, "context": ctx}


async def decide(state: RevenueGapState) -> RevenueGapState:
    ctx = state.get("context") or {}
    if not ctx:
        return {
            **state,
            "decision": None,
            "status": "skipped",
            "source": "heuristic",
            "reason": "org_not_found",
        }

    decision, llm_reason = await decide_via_llm(ctx)
    source = "ai"
    reason: str | None = None
    if decision is None:
        logger.warning(
            "revenue-gap-forecast LLM unavailable after retries; using "
            "heuristic fallback org=%s reason=%s",
            state.get("organization_id"),
            llm_reason,
        )
        decision = decide_revenue_gap_heuristic(ctx)
        source = "heuristic"
        reason = llm_reason or "llm_failed"

    tagged = (
        label_ai(decision) if source == "ai" else label_fallback(decision, reason or "llm_failed")
    )
    decision_clean = {k: v for k, v in tagged.items() if k != "source"}
    return {
        **state,
        "decision": decision_clean,
        "status": "decided",
        "source": source,
        "reason": reason,
    }


async def persist(state: RevenueGapState) -> RevenueGapState:
    decision = state.get("decision")
    if not decision:
        return {**state, "persist_result": {"status": "skipped"}, "status": "skipped"}

    client = CrmClient(state.get("organization_id"))
    result = await client.persist_revenue_gap(state["organization_id"], decision)
    return {
        **state,
        "persist_result": result,
        "status": result.get("status") or state.get("status"),
    }


def _detail_load_context(
    _before: RevenueGapState, after: RevenueGapState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {
        "collectedRevenue": ctx.get("collectedRevenue"),
        "atRiskCount": len(ctx.get("atRiskInvoices") or []),
    }


def _detail_decide(
    _before: RevenueGapState, after: RevenueGapState
) -> dict[str, Any] | None:
    decision = after.get("decision") or {}
    return {"hasTarget": decision.get("hasTarget"), "source": after.get("source")}


def _detail_persist(
    _before: RevenueGapState, after: RevenueGapState
) -> dict[str, Any] | None:
    result = after.get("persist_result") or {}
    return {"status": result.get("status") or after.get("status")}


_PIPELINE_STEPS = (
    traced_step(
        REVENUE_GAP_MODULE_PATH,
        REVENUE_GAP_AGENT,
        "load_context",
        "Loading revenue + at-risk invoices",
        _detail_load_context,
        id_field="organization_id",
        job_id_field="job_id",
    )(load_context),
    traced_step(
        REVENUE_GAP_MODULE_PATH,
        REVENUE_GAP_AGENT,
        "decide",
        "Forecasting revenue gap",
        _detail_decide,
        id_field="organization_id",
        job_id_field="job_id",
    )(decide),
    traced_step(
        REVENUE_GAP_MODULE_PATH,
        REVENUE_GAP_AGENT,
        "persist",
        "Caching forecast for dashboard",
        _detail_persist,
        id_field="organization_id",
        job_id_field="job_id",
    )(persist),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(organization_id: str) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "status": "running",
        }
    )
    return {
        "organizationId": organization_id,
        "status": result.get("status") or "failed",
        "source": result.get("source") or "heuristic",
        "reason": result.get("reason"),
        "decision": result.get("decision"),
        "persistResult": result.get("persist_result"),
    }
