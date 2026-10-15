"""
Expansion & Revenue Matcher Agent (LangGraph).

Judges whether one existing account's own closed-won deal history shows a
genuine upsell/cross-sell opportunity — a signal band (none|watch|opportunity)
grounded in deal count/trend, time since last close, whether a deal is
already open on the account, and products already purchased — and drafts
outreach talking points for the account owner to review and use.

Primary path: LLM returns structured signal/reason/draft JSON.
Heuristic decide_expansion_heuristic is offline fallback only.

HITL rule (hard constraint): this agent never creates a deal/quote and never
edits any company profile field other than its own expansion* overlay — it
only writes those (plus a notification). It never contacts the company
itself; sending outreachDraft (or starting a new deal) stays a human action.
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict, Optional
from uuid import uuid4

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

EXPANSION_MATCHER_MODULE_PATH = "expansion-matcher"
EXPANSION_MATCHER_AGENT = "expansion_matcher"

EXPANSION_SIGNALS = {"none", "watch", "opportunity"}


class ExpansionMatcherState(TypedDict, total=False):
    company_id: str
    organization_id: Optional[str]
    job_id: str
    context: dict[str, Any]
    decision: dict[str, Any]
    status: str
    source: str
    reason: Optional[str]
    persist_result: dict[str, Any]


EXPANSION_MATCHER_SYSTEM = sectioned_system_prompt(
    role=(
        "You are an account growth analyst for Worktual. You judge whether "
        "one existing customer account shows a genuine upsell/cross-sell "
        "opportunity based only on its own deal history — you never create "
        "deals or contact the customer, only assess and draft talking "
        "points for the account owner."
    ),
    goal=(
        "Judge an expansion signal for this account and, if warranted, draft "
        "outreach talking points the account owner can use to open a "
        "conversation."
    ),
    instructions=(
        "- Use ONLY the provided deal-history, purchased-product, and catalog facts. "
        "Never invent evidence or invent product names not present in the context.\n"
        "- signal=none: too little history, or an open deal is already being worked on "
        "this account (don't duplicate active sales motion), or no credible growth signal.\n"
        "- signal=watch: exactly one closed-won deal and a long time since close with no "
        "open deal — worth a light renewal/check-in nudge, not a hard pitch.\n"
        "- signal=opportunity: multiple closed-won deals, especially with a rising trend, "
        "and no open deal already covering it — a clear upsell/cross-sell candidate.\n"
        "- When drafting outreachDraft, only reference products from purchasedProductNames "
        "(renewal/expansion of what they already have) or candidateProductNames (a genuine "
        "catalog item they haven't purchased) — never a product not in either list.\n"
        "- outreachDraft is talking points/an opening message for the account owner to "
        "personalize and send — never claim to have sent anything yourself."
    ),
    context="Company profile, closed-won deal aggregates, purchased products, open-deal status, and candidate catalog products are in the user message.",
    output=(
        "Return ONLY valid JSON (no markdown):\n"
        "{\n"
        '  "signal": "none|watch|opportunity",\n'
        '  "reason": "<1-2 sentence evidence-grounded rationale>",\n'
        '  "outreachDraft": "<talking points / opening message for the account owner, or empty string if signal is none>"\n'
        "}"
    ),
    guardrails=(
        "- Never invent deals, purchases, or catalog products not present in the context.\n"
        "- Never claim you contacted the company, created a deal, or sent anything — you "
        "only assess and draft.\n"
        "- Prefer signal=none over guessing when evidence is thin."
    ),
)


def _context_user_payload(ctx: dict[str, Any]) -> str:
    purchased = ctx.get("purchasedProductNames") or []
    candidates = ctx.get("candidateProductNames") or []
    open_stages = ctx.get("openDealStages") or []
    lines = [
        f"Company: {ctx.get('companyName')} (industry={ctx.get('industry') or '—'}, "
        f"employees={ctx.get('employeeCount') or 'unknown'})",
        f"Closed-won deals: {ctx.get('closedWonDealCount')} "
        f"(total {ctx.get('closedWonTotalAmount')}, avg {ctx.get('closedWonAvgAmount')})",
        f"Days since last closed-won: {ctx.get('daysSinceLastClosedWon') or 'unknown'}",
        f"Purchased products: {', '.join(purchased) if purchased else 'none on file'}",
        f"Open deals on this account: {ctx.get('openDealCount')} "
        f"(stages: {', '.join(open_stages) if open_stages else 'none'})",
        f"Other candidate products not yet purchased: "
        f"{', '.join(candidates) if candidates else 'none'}",
        f"Previous assessment: signal={ctx.get('expansionSignal') or 'none'} "
        f"reason={ctx.get('expansionReason') or 'none'}",
    ]
    return "\n".join(lines)


def _normalize_llm_expansion(parsed: dict[str, Any]) -> dict[str, Any] | None:
    signal = str(parsed.get("signal") or "").strip().lower()
    if signal not in EXPANSION_SIGNALS:
        return None
    reason = str(parsed.get("reason") or "").strip()
    if not reason:
        return None
    outreach_draft = str(parsed.get("outreachDraft") or "").strip() or None
    if signal != "none" and not outreach_draft:
        return None
    return {
        "signal": signal,
        "reason": reason[:500],
        "outreachDraft": outreach_draft[:2000] if outreach_draft else None,
    }


async def decide_via_llm(ctx: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    return await generate_json_with_retries(
        system=EXPANSION_MATCHER_SYSTEM,
        user=_context_user_payload(ctx),
        max_tokens=700,
        repair_hint=(
            "Convert into ONLY valid expansion JSON with keys signal, reason, "
            "outreachDraft. No markdown."
        ),
        validate=_normalize_llm_expansion,
    )


def decide_expansion_heuristic(ctx: dict[str, Any]) -> dict[str, Any]:
    """Offline fallback — simple deal-count/recency thresholds as a floor."""
    deal_count = ctx.get("closedWonDealCount") or 0
    open_count = ctx.get("openDealCount") or 0
    days_since = ctx.get("daysSinceLastClosedWon")
    days_since = days_since if isinstance(days_since, (int, float)) else None
    company_name = ctx.get("companyName") or "this account"

    if open_count > 0:
        signal = "none"
        reason = f"{open_count} open deal(s) already in progress on this account."
        return {"signal": signal, "reason": reason[:500], "outreachDraft": None}

    if deal_count >= 2:
        signal = "opportunity"
        reason = f"{deal_count} closed-won deals on file with no open deal — candidate for expansion outreach."
    elif deal_count == 1 and days_since is not None and days_since > 180:
        signal = "watch"
        reason = f"Single closed-won deal, {days_since} days since close, no open deal — worth a check-in."
    else:
        signal = "none"
        reason = "Not enough closed-won history yet for a confident expansion signal."

    outreach_draft = None
    if signal != "none":
        outreach_draft = (
            f"Hi — it's been a while since we last worked together at {company_name}. "
            "Wanted to check in and see how things are going, and whether there's anything "
            "else we could help with as you grow."
        )

    return {
        "signal": signal,
        "reason": reason[:500],
        "outreachDraft": outreach_draft[:2000] if outreach_draft else None,
    }


async def load_context(state: ExpansionMatcherState) -> ExpansionMatcherState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_expansion_context(state["company_id"])
    return {**state, "context": ctx}


async def decide(state: ExpansionMatcherState) -> ExpansionMatcherState:
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
            "expansion-matcher LLM unavailable after retries; using heuristic "
            "fallback company=%s reason=%s",
            state.get("company_id"),
            llm_reason,
        )
        decision = decide_expansion_heuristic(ctx)
        source = "heuristic"
        reason = llm_reason or "llm_failed"

    domain_reason = str(decision.get("reason") or "").strip()
    tagged = (
        label_ai(decision)
        if source == "ai"
        else label_fallback(decision, reason or "llm_failed")
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


async def persist(state: ExpansionMatcherState) -> ExpansionMatcherState:
    decision = state.get("decision")
    if not decision:
        return {**state, "persist_result": {"status": "skipped"}, "status": "skipped"}

    client = CrmClient(state.get("organization_id"))
    result = await client.persist_expansion(state["company_id"], decision)
    return {
        **state,
        "persist_result": result,
        "status": result.get("status") or state.get("status"),
    }


def _detail_load_context(
    _before: ExpansionMatcherState, after: ExpansionMatcherState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {
        "closedWonDealCount": ctx.get("closedWonDealCount"),
        "openDealCount": ctx.get("openDealCount"),
    }


def _detail_decide(
    _before: ExpansionMatcherState, after: ExpansionMatcherState
) -> dict[str, Any] | None:
    decision = after.get("decision") or {}
    return {
        "signal": decision.get("signal"),
        "source": after.get("source"),
    }


def _detail_persist(
    _before: ExpansionMatcherState, after: ExpansionMatcherState
) -> dict[str, Any] | None:
    result = after.get("persist_result") or {}
    return {"status": result.get("status") or after.get("status")}


_PIPELINE_STEPS = (
    traced_step(
            EXPANSION_MATCHER_MODULE_PATH,
            EXPANSION_MATCHER_AGENT,
            "load_context",
            "Loading account deal history & catalog",
            _detail_load_context,
            id_field="company_id",
            job_id_field="job_id",
        )(load_context),
    traced_step(
            EXPANSION_MATCHER_MODULE_PATH,
            EXPANSION_MATCHER_AGENT,
            "decide",
            "Judging expansion signal",
            _detail_decide,
            id_field="company_id",
            job_id_field="job_id",
        )(decide),
    traced_step(
            EXPANSION_MATCHER_MODULE_PATH,
            EXPANSION_MATCHER_AGENT,
            "persist",
            "Saving signal & drafting outreach",
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
