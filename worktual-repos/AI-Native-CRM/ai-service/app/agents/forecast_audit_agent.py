"""
Pipeline Forecast Auditor Agent (LangGraph).

Judges whether an open B2B deal's current stage and expected close date are
realistic given real activity evidence (silence pattern, quote status,
negotiation signals) — a judgment call the deterministic lifecycle/stall
agents do not make.

Primary path: LLM returns structured category/confidence/flag JSON.
Heuristic decide_forecast_heuristic is offline fallback only.

HITL rule (hard constraint): this agent never mutates Deal.stage or
Deal.expectedCloseDate — it only writes the forecast* overlay fields (plus a
notification when flagged). Stage/date stay a human edit.
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

FORECAST_MODULE_PATH = "forecast"
FORECAST_AGENT = "pipeline_forecast"

FORECAST_CATEGORIES = {"commit", "best_case", "pipeline", "omitted"}


class ForecastState(TypedDict, total=False):
    deal_id: str
    organization_id: Optional[str]
    job_id: str
    context: dict[str, Any]
    decision: dict[str, Any]
    status: str
    source: str
    reason: Optional[str]
    persist_result: dict[str, Any]


FORECAST_SYSTEM = sectioned_system_prompt(
    role=(
        "You are a CRM pipeline forecast auditor for Worktual. You judge "
        "whether one open deal's current stage and expected close date are "
        "realistic given real activity evidence — you never change the "
        "stage or close date yourself, only audit and flag."
    ),
    goal=(
        "Judge whether this deal's stage and expected close date are "
        "realistic given the evidence, and classify it into a forecast "
        "category."
    ),
    instructions=(
        "- Use ONLY the provided deal facts, quotes, and activity signals. Never invent engagement.\n"
        "- category=commit: strong evidence it closes in-stage by the expected date "
        "(accepted quote, payment confirmed, explicit commitment).\n"
        "- category=best_case: plausible but real risk remains (quote sent/negotiating, "
        "engagement present but not conclusive).\n"
        "- category=pipeline: normal open deal — no particular red flag, but not yet "
        "commit-worthy.\n"
        "- category=omitted: stage/date look unrealistic given the evidence — recommend "
        "excluding it from the current forecast roll-up.\n"
        "- Set flagged=true whenever the expected close date has already passed, activity "
        "has gone quiet relative to the time left to close, or the stage looks too advanced "
        "for the evidence on the timeline.\n"
        "- confidencePercent (0-100) reflects how sure you are this deal closes in its "
        "current stage by the expected date — lower it whenever flagged is true."
    ),
    context="Deal, quote, and activity-signal facts are in the user message.",
    output=(
        "Return ONLY valid JSON (no markdown):\n"
        "{\n"
        '  "category": "commit|best_case|pipeline|omitted",\n'
        '  "confidencePercent": <0-100>,\n'
        '  "flagged": true|false,\n'
        '  "reason": "<1-2 sentences>"\n'
        "}"
    ),
    guardrails=(
        "- Never invent activity, quotes, or evidence not present in the context.\n"
        "- Never claim you changed the deal's stage or close date — you only audit.\n"
        "- Prefer flagged=true and a lower category over guessing when evidence is thin."
    ),
)


def _context_user_payload(ctx: dict[str, Any]) -> str:
    s = ctx.get("signals") or {}
    signal_names = [
        k for k, v in s.items() if k not in {"evidence", "signalAt"} and v is True
    ]
    quotes = ctx.get("quotes") or []
    lines = [
        f"Deal: {ctx.get('title')} (stage={ctx.get('stage')})",
        f"Amount: {ctx.get('amount')}",
        f"Company: {ctx.get('companyName') or '—'}",
        f"Owner: {ctx.get('ownerUserId') or 'unassigned'}",
        f"Created: {ctx.get('createdAt')}",
        f"Days since last update to this deal: {ctx.get('daysSinceUpdated')}",
        f"Expected close date: {ctx.get('expectedCloseDate') or 'none set'}",
        f"Days until expected close (negative = overdue): {ctx.get('daysToExpectedClose')}",
        f"Activity count: {ctx.get('activityCount')} | Days since last activity: {ctx.get('daysSinceLastActivity')}",
        f"Signals true: {', '.join(signal_names) or 'none'}",
        f"Evidence: {' | '.join((s.get('evidence') or [])[:6]) or 'none'}",
        f"Quotes: {quotes[:5]}",
        f"Previous forecast: category={ctx.get('forecastCategory') or 'none'} "
        f"confidence={ctx.get('forecastConfidencePercent')} flagged={ctx.get('forecastFlagged')}",
    ]
    return "\n".join(lines)


def _normalize_llm_forecast(parsed: dict[str, Any]) -> dict[str, Any] | None:
    category = str(parsed.get("category") or "").strip().lower()
    if category not in FORECAST_CATEGORIES:
        return None
    try:
        confidence = int(round(float(parsed.get("confidencePercent", 0))))
    except (TypeError, ValueError):
        return None
    confidence = max(0, min(100, confidence))
    flagged = bool(parsed.get("flagged"))
    reason = str(parsed.get("reason") or "").strip()
    if not reason:
        return None
    return {
        "category": category,
        "confidencePercent": confidence,
        "flagged": flagged,
        "reason": reason[:280],
    }


async def decide_via_llm(ctx: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    return await generate_json_with_retries(
        system=FORECAST_SYSTEM,
        user=_context_user_payload(ctx),
        max_tokens=700,
        repair_hint=(
            "Convert into ONLY valid forecast JSON with keys category, "
            "confidencePercent, flagged, reason. No markdown."
        ),
        validate=_normalize_llm_forecast,
    )


_STAGE_BASE_CATEGORY: dict[str, tuple[str, int]] = {
    "qualification": ("pipeline", 15),
    "discover": ("pipeline", 25),
    "propose": ("pipeline", 35),
    "negotiate": ("best_case", 55),
}


def decide_forecast_heuristic(ctx: dict[str, Any]) -> dict[str, Any]:
    """Offline fallback — simple days-since-activity vs. days-to-close ratio."""
    stage = ctx.get("stage") or "qualification"
    signals = ctx.get("signals") or {}
    quotes = ctx.get("quotes") or []
    accepted = next((q for q in quotes if q.get("status") == "accepted"), None)
    sent = next((q for q in quotes if q.get("status") == "sent"), None)
    days_since_last_activity = ctx.get("daysSinceLastActivity")
    days_to_close = ctx.get("daysToExpectedClose")

    if accepted or signals.get("paymentConfirmed"):
        category, confidence = "commit", 90
    elif sent and (signals.get("negotiating") or signals.get("accepted")):
        category, confidence = "commit", 70
    else:
        category, confidence = _STAGE_BASE_CATEGORY.get(stage, ("pipeline", 20))
        if stage == "propose" and sent:
            category, confidence = "best_case", 50

    reasons: list[str] = []
    flagged = False

    if days_to_close is not None and days_to_close < 0:
        flagged = True
        reasons.append(
            f"Expected close date is {abs(days_to_close)} day(s) in the past"
        )

    if days_since_last_activity is not None and days_to_close is not None and days_to_close > 0:
        ratio = days_since_last_activity / days_to_close
        if ratio >= 1:
            flagged = True
            reasons.append(
                f"No activity in {days_since_last_activity}d vs only "
                f"{days_to_close}d left to close"
            )
    elif (
        days_since_last_activity is not None
        and days_since_last_activity >= 21
        and stage != "qualification"
    ):
        flagged = True
        reasons.append(f"No activity for {days_since_last_activity}+ days")

    if flagged:
        confidence = min(confidence, 30)
        if days_to_close is not None and days_to_close < 0:
            category = "omitted"

    if not reasons:
        reasons.append(
            f"Stage {stage} with "
            + ("an accepted quote" if accepted else "no blocking evidence")
        )

    return {
        "category": category,
        "confidencePercent": confidence,
        "flagged": flagged,
        "reason": "; ".join(reasons)[:280],
    }


async def load_context(state: ForecastState) -> ForecastState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_forecast_context(state["deal_id"])
    return {**state, "context": ctx}


async def decide(state: ForecastState) -> ForecastState:
    ctx = state.get("context") or {}
    if not ctx:
        return {
            **state,
            "decision": None,
            "status": "skipped",
            "source": "heuristic",
            "reason": "deal_not_found",
        }

    decision, llm_reason = await decide_via_llm(ctx)
    source = "ai"
    reason: str | None = None
    if decision is None:
        logger.warning(
            "pipeline-forecast LLM unavailable after retries; using heuristic "
            "fallback deal=%s reason=%s",
            state.get("deal_id"),
            llm_reason,
        )
        decision = decide_forecast_heuristic(ctx)
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


async def persist(state: ForecastState) -> ForecastState:
    decision = state.get("decision")
    if not decision:
        return {**state, "persist_result": {"status": "skipped"}, "status": "skipped"}

    client = CrmClient(state.get("organization_id"))
    result = await client.persist_forecast(state["deal_id"], decision)
    return {
        **state,
        "persist_result": result,
        "status": result.get("status") or state.get("status"),
    }


def _detail_load_context(
    _before: ForecastState, after: ForecastState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {
        "stage": ctx.get("stage"),
        "daysSinceLastActivity": ctx.get("daysSinceLastActivity"),
        "daysToExpectedClose": ctx.get("daysToExpectedClose"),
    }


def _detail_decide(
    _before: ForecastState, after: ForecastState
) -> dict[str, Any] | None:
    decision = after.get("decision") or {}
    return {
        "category": decision.get("category"),
        "confidencePercent": decision.get("confidencePercent"),
        "flagged": decision.get("flagged"),
        "source": after.get("source"),
    }


def _detail_persist(
    _before: ForecastState, after: ForecastState
) -> dict[str, Any] | None:
    result = after.get("persist_result") or {}
    return {"status": result.get("status") or after.get("status")}


_PIPELINE_STEPS = (
    traced_step(
            FORECAST_MODULE_PATH,
            FORECAST_AGENT,
            "load_context",
            "Loading deal, quote & activity context",
            _detail_load_context,
            id_field="deal_id",
            job_id_field="job_id",
        )(load_context),
    traced_step(
            FORECAST_MODULE_PATH,
            FORECAST_AGENT,
            "decide",
            "Judging forecast realism",
            _detail_decide,
            id_field="deal_id",
            job_id_field="job_id",
        )(decide),
    traced_step(
            FORECAST_MODULE_PATH,
            FORECAST_AGENT,
            "persist",
            "Saving forecast category & confidence",
            _detail_persist,
            id_field="deal_id",
            job_id_field="job_id",
        )(persist),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(deal_id: str, organization_id: str | None = None) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "deal_id": deal_id,
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "status": "running",
        }
    )
    return {
        "dealId": deal_id,
        "status": result.get("status") or "failed",
        "source": result.get("source") or "heuristic",
        "reason": result.get("reason"),
        "decision": result.get("decision"),
        "persistResult": result.get("persist_result"),
    }
