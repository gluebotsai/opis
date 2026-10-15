"""
Sales & Pre-sales Coach Agent (LangGraph).

Reviews a single call/meeting transcript right after it's captured and gives
private, evidence-based coaching feedback (discovery quality, objection
handling, methodology adherence, talk-balance impression). The full coaching
note is delivered privately to the rep. Sales managers and organization
admins receive a performance summary (impression + growth areas) from CRM —
never this agent's raw coaching text or transcript.

Stateless / event-driven, same shape as meeting_mom_agent.py: TypeScript
packs the full payload (transcript + rep/contact/company + prior coaching
history) into one call — this agent never calls back into the CRM.

HITL rule (hard constraint): output is coaching text only. It never writes
a performance rating, never blocks or gates anything, and is never a
standalone basis for a formal review.
"""

from __future__ import annotations

import re
from typing import Any, TypedDict, Optional
from uuid import uuid4

from app.agents.native_pipeline import run_steps

from app.llm import is_ai_configured
from app.agents.step_trace import traced_step
from app.agents.llm_result import generate_json_with_retries

SALES_COACH_MODULE_PATH = "sales-coach"
SALES_COACH_AGENT = "sales_coach"

OVERALL_IMPRESSIONS = {"strong", "solid", "needs_work"}

LIST_KEYS = ("strengths", "growthAreas")

# Coaching needs real substance to judge — higher bar than the 40-char
# extraction gate used by analyze_transcript_agent / meeting_mom_agent.
MIN_TRANSCRIPT_CHARS = 150


class CoachState(TypedDict, total=False):
    transcript: str
    rep_name: Optional[str]
    contact_name: Optional[str]
    company_name: Optional[str]
    prior_growth_areas: list[str]
    activity_id: Optional[str]
    contact_id: Optional[str]
    organization_id: Optional[str]
    job_id: str
    cleaned: str
    insight: Optional[dict[str, Any]]
    status: str
    reason: Optional[str]


SYSTEM = """You are a private sales coach for Worktual CRM. You review one call/meeting
transcript and give the rep evidence-based, non-judgemental coaching feedback —
you never grade performance formally and this is never a standalone basis for
a performance review.

Assess against this rubric:
- Discovery quality: did the rep uncover the prospect's real need, budget, timeline, decision process?
- Objection handling: how were concerns/pushback addressed (or were there none)?
- Methodology adherence: did the rep follow a coherent structure (open, discover, present, handle objections, next steps)?
- Talk balance: only comment on this if the transcript text itself makes it inferable
  (e.g. one side clearly dominates most lines/turns) — otherwise say you can't tell.
  NEVER invent a percentage or ratio; there is no speaker-time data available to you.

Return ONLY valid JSON (no markdown):
{
  "overallImpression": "strong|solid|needs_work",
  "discoveryQuality": "1-2 sentence assessment",
  "objectionHandling": "1-2 sentence assessment, or 'No objections came up.'",
  "methodologyNote": "1-2 sentence assessment",
  "talkBalanceNote": "1 sentence, or null if not inferable from the transcript",
  "strengths": ["short evidence-based bullet", "..."],
  "growthAreas": ["short evidence-based bullet", "..."],
  "highlightedMoment": "one specific quote or moment, and why it mattered",
  "coachingNote": "the single most actionable takeaway, written directly to the rep, encouraging tone"
}

Rules:
- Ground every point in the transcript text — never invent moments, quotes, or evidence.
- Keep feedback constructive and specific; this is coaching, not a report card.
- Arrays may have 1-3 items; omit generic filler.
- If prior growth areas are provided, note briefly in coachingNote whether this call shows improvement — do not just repeat the same feedback verbatim.
"""


def _as_str_list(val: Any, max_n: int = 3) -> list[str]:
    if not isinstance(val, list):
        return []
    out: list[str] = []
    for item in val:
        if isinstance(item, str) and item.strip():
            out.append(item.strip()[:280])
        if len(out) >= max_n:
            break
    return out


def normalize_coaching_insight(parsed: dict[str, Any]) -> dict[str, Any] | None:
    """Validate + normalize the LLM's raw JSON into the persisted shape.

    Returns None when the output isn't usable (unknown impression band or
    missing the one required actionable field) — caller treats that as a
    failed LLM turn.
    """
    impression = str(parsed.get("overallImpression") or "").strip().lower()
    if impression not in OVERALL_IMPRESSIONS:
        return None
    coaching_note = str(parsed.get("coachingNote") or "").strip()
    if not coaching_note:
        return None

    talk_balance = parsed.get("talkBalanceNote")
    talk_balance_note = (
        str(talk_balance).strip()[:280]
        if isinstance(talk_balance, str) and talk_balance.strip()
        else None
    )

    out: dict[str, Any] = {
        "overallImpression": impression,
        "discoveryQuality": str(parsed.get("discoveryQuality") or "").strip()[:600] or None,
        "objectionHandling": str(parsed.get("objectionHandling") or "").strip()[:600] or None,
        "methodologyNote": str(parsed.get("methodologyNote") or "").strip()[:600] or None,
        "talkBalanceNote": talk_balance_note,
        "highlightedMoment": str(parsed.get("highlightedMoment") or "").strip()[:400] or None,
        "coachingNote": coaching_note[:600],
    }
    for key in LIST_KEYS:
        out[key] = _as_str_list(parsed.get(key))
    return out


async def normalize(state: CoachState) -> CoachState:
    text = re.sub(r"<[^>]+>", " ", state.get("transcript") or "")
    text = re.sub(r"\s+", " ", text).strip()[:16000]
    if len(text) < MIN_TRANSCRIPT_CHARS:
        return {
            **state,
            "cleaned": text,
            "status": "skipped",
            "reason": "too_short",
            "insight": None,
        }
    if not is_ai_configured():
        return {
            **state,
            "cleaned": text,
            "status": "skipped",
            "reason": "llm_not_configured",
            "insight": None,
        }
    return {**state, "cleaned": text, "status": "running"}


async def assess(state: CoachState) -> CoachState:
    if state.get("status") != "running":
        return state

    prior = state.get("prior_growth_areas") or []
    meta_bits = [
        f"Rep: {state.get('rep_name') or 'unknown'}",
        f"Contact: {state.get('contact_name') or 'unknown'}",
        f"Company: {state.get('company_name') or 'unknown'}",
        f"Prior growth areas noted for this rep: {', '.join(prior) or 'none yet'}",
    ]
    user = "\n".join(meta_bits) + "\n\n--- TRANSCRIPT ---\n" + state["cleaned"]

    insight, llm_reason = await generate_json_with_retries(
        system=SYSTEM,
        user=user,
        max_tokens=1500,
        timeout_ms=40_000,
        repair_hint=(
            "Convert into ONLY valid coaching JSON with keys overallImpression, "
            "discoveryQuality, objectionHandling, methodologyNote, talkBalanceNote, "
            "strengths, growthAreas, highlightedMoment, coachingNote. No markdown."
        ),
        validate=normalize_coaching_insight,
    )
    if not insight:
        return {
            **state,
            "status": "failed",
            "reason": llm_reason or "parse_failed",
            "insight": None,
        }

    return {**state, "insight": insight, "status": "ok", "reason": None}


def _detail_normalize(_before: CoachState, after: CoachState) -> dict[str, Any] | None:
    return {"transcriptChars": len(after.get("cleaned") or "")}


def _detail_assess(_before: CoachState, after: CoachState) -> dict[str, Any] | None:
    insight = after.get("insight") or {}
    return {"overallImpression": insight.get("overallImpression")}


_PIPELINE_STEPS = (
    traced_step(
            SALES_COACH_MODULE_PATH,
            SALES_COACH_AGENT,
            "normalize",
            "Preparing the transcript",
            _detail_normalize,
            id_field="activity_id",
            job_id_field="job_id",
        )(normalize),
    traced_step(
            SALES_COACH_MODULE_PATH,
            SALES_COACH_AGENT,
            "assess",
            "Assessing discovery, objections & methodology",
            _detail_assess,
            id_field="activity_id",
            job_id_field="job_id",
        )(assess),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    transcript: str = "",
    repName: str | None = None,
    contactName: str | None = None,
    companyName: str | None = None,
    priorGrowthAreas: list[str] | None = None,
    organization_id: str | None = None,
    activityId: str | None = None,
    contactId: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "transcript": transcript or "",
            "rep_name": repName,
            "contact_name": contactName,
            "company_name": companyName,
            "prior_growth_areas": priorGrowthAreas or [],
            "activity_id": activityId,
            "contact_id": contactId,
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "status": "running",
        }
    )
    insight = result.get("insight")
    return {
        "ok": bool(insight),
        "insight": insight,
        "status": result.get("status"),
        "reason": result.get("reason"),
    }
