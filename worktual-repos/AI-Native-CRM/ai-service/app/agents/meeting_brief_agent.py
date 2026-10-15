"""Meeting Brief / Reminder Email Agent (LangGraph).

Composes owner prep emails (booking or T−24h/T−1h reminder) and personalized
participant don't-miss emails. Accepts packed CRM context from the TypeScript
backend (preferred) so we do not depend on a missing internal HTTP route.
"""

from __future__ import annotations

import json
import logging
from typing import Any, TypedDict, Optional
from uuid import uuid4

from app.agents.native_pipeline import run_steps

from app.crm_client import CrmClient
from app.llm import is_ai_configured
from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
from app.agents.meeting_brief_html import (
    OWNER_HTML_MAX,
    heuristic_brief_doc,
    normalize_brief_doc,
    render_prebrief_html,
)
from app.agents.meeting_participant_html import (
    PARTICIPANT_HTML_MAX,
    normalize_participant_doc,
    render_participant_html,
)
from app.agents.step_trace import traced_step
from app.agents.crm_tools import effective_contact_type

logger = logging.getLogger(__name__)

MEETING_BRIEF_MODULE_PATH = "meeting-brief"


def _brief_agent(state: "BriefState") -> str:
    return "meeting_reminder" if state.get("reminder_window") else "meeting_brief"


class BriefState(TypedDict, total=False):
    activity_id: str
    contact_id: Optional[str]
    organization_id: Optional[str]
    job_id: str
    reminder_window: Optional[str]
    lead_summary: Optional[str]
    audience: str
    participant_first_name: Optional[str]
    organizer_name: Optional[str]
    packed_context: Optional[dict[str, Any]]
    context: dict[str, Any]
    subject: Optional[str]
    body: Optional[str]
    importance_tier: Optional[str]
    status: str
    reason: Optional[str]


OWNER_BRIEF_JSON = """{
  "subject": "short subject with contact and company",
  "importanceTier": "critical|high|normal",
  "headerTitle": "Name — Company",
  "headerSubtitle": "Meeting type · Objective: ... · Exit criteria: ...",
  "headerPill": "NEW LEAD · FIRST CALL",
  "inShort": "2-4 sentences: what already happened and how to use this call",
  "attendeeRolePill": "short buying-role label",
  "attendeeNote": "engagement / authority note",
  "accountSnapshot": [{"label":"Company","value":"...","muted":false}],
  "dealState": [{"label":"Stage","value":"...","muted":false}],
  "qualificationNote": "optional note that empty BANT is normal at this stage, or omit",
  "crossChannelHistory": [{"when":"Day 0 — Email","detail":"..."}],
  "carryOver": ["Sentiment: ...", "Product interest: ..."],
  "customerQuote": "verbatim quote from context or empty string",
  "weOwe": "what we still owe them, or empty",
  "theyOwe": "what we still need from them, or empty",
  "risks": ["watch-out grounded in context"],
  "agenda": ["numbered talking point"],
  "whyThisOrder": "why this agenda order",
  "objections": [{"objection":"likely pushback","response":"suggested reply"}],
  "assets": ["deck or questions to have ready"]
}"""

OWNER_BRIEF_PROMPT = sectioned_system_prompt(
    role=(
        "You write an internal pre-call briefing for the contact's sales owner. "
        "A renderer turns your JSON into an HTML email — do not output HTML."
    ),
    goal=(
        "Give the owner a scannable 360 brief: who they are meeting, what already "
        "happened across channels, what to ask next, and how to close a next step."
    ),
    instructions=(
        "- Audience is the sales owner, never the customer.\n"
        "- Use only facts in the user context. Do not invent quotes, WhatsApp, "
        "integrations, company size, tech stack, or timelines.\n"
        "- Omit a JSON field (empty string or []) when you lack evidence. "
        "The renderer hides empty sections.\n"
        "- Unknown-but-actionable fields may be included with muted=true "
        "(e.g. company size not enriched — ask on the call).\n"
        "- headerPill for a booking brief may reflect stage "
        "(e.g. NEW LEAD · FIRST CALL, QUALIFIED · PREP). Reminder pills are applied in code.\n"
        "- Weave leadSummary into inShort when provided; do not dump it as a separate block.\n"
        "- Agenda should open with something they already said, not a cold reset.\n"
        "- Objections: likely pushback from this context only. Never include battlecard "
        "links, placeholder URLs, or [Link to ...] text.\n"
        "- Assets: generic prep items (overview deck, discovery questions) are fine; "
        "do not invent named case studies unless context names them.\n"
        "- importanceTier: critical/high when score>=40, grade A/B, qualified, "
        "or an open material deal; else normal.\n"
        "- For 24h/1h reminders, subject must reflect that urgency."
    ),
    context="Packed CRM facts, recent activities, and optional lead summary are in the user message.",
    output="Return ONLY valid JSON (no markdown) matching:\n" + OWNER_BRIEF_JSON,
    guardrails=(
        "No invented facts. No HTML. No battlecards. No customer-facing tone. "
        "Never include join URLs in JSON — meeting time and link are injected from CRM."
    ),
)

PARTICIPANT_JSON = """{
  "subject": "window-aware subject with topic",
  "importanceTier": "critical|high|normal",
  "intro": "1-2 warm sentences acknowledging the meeting",
  "valueLine": "one specific sentence on what they'll get from this meeting",
  "whatToExpect": ["short bullet on agenda item or outcome"],
  "closing": "optional sign-off line (plain text; renderer adds organizer name if empty)"
}"""

PARTICIPANT_PROMPT = sectioned_system_prompt(
    role=(
        "You write a personalized don't-miss meeting reminder for the external "
        "customer/lead participant. A renderer turns your JSON into HTML — do not output HTML."
    ),
    goal=(
        "Help the participant show up prepared and engaged. Be warm, professional, "
        "and specific to their topic and company context."
    ),
    instructions=(
        "- Audience is the external participant (not the sales rep).\n"
        "- Subject: window-aware (24h vs starting soon) + topic; never generic spam.\n"
        "- Use only facts in context. Do not invent product claims or company details.\n"
        "- valueLine must tie to topic/company/context — not a blank template.\n"
        "- whatToExpect: 2-4 short bullets grounded in context (agenda hints, demo, Q&A).\n"
        "- Omit whatToExpect when you lack evidence.\n"
        "- importanceTier reflects lead importance from context.\n"
        "- Never include join URLs in JSON — time and link are injected from CRM."
    ),
    context="Packed CRM facts and reminder window are in the user message.",
    output="Return ONLY valid JSON (no markdown) matching:\n" + PARTICIPANT_JSON,
    guardrails="No invented facts. No HTML. No internal sales coaching. Customer-appropriate tone only.",
)


def _importance_from_ctx(ctx: dict[str, Any]) -> str:
    score = ctx.get("leadScore")
    try:
        score_n = float(score) if score is not None else None
    except (TypeError, ValueError):
        score_n = None
    grade = str(ctx.get("leadGrade") or "").upper()
    lifecycle = effective_contact_type(ctx.get("contactType"))
    lead_status = str(ctx.get("leadStatus") or "").lower()
    has_deal = bool(ctx.get("pipelineStage") or ctx.get("pipelineDealTitle"))
    if (
        (score_n is not None and score_n >= 70)
        or grade == "A"
        or lead_status == "qualified"
    ):
        return "critical"
    if (
        (score_n is not None and score_n >= 40)
        or grade in {"A", "B"}
        or "qualif" in lifecycle
        or has_deal
    ):
        return "high"
    return "normal"


def _heuristic_owner(
    ctx: dict[str, Any],
    reminder_window: str | None,
    lead_summary: str | None,
) -> tuple[str, str, str]:
    doc = heuristic_brief_doc(ctx, reminder_window, lead_summary)
    html = render_prebrief_html(doc, ctx, reminder_window)
    return doc["subject"], html, doc.get("importanceTier") or _importance_from_ctx(ctx)


def _context_user_blob(
    ctx: dict[str, Any],
    *,
    reminder_window: str | None,
    lead_summary: str | None,
    audience: str,
    participant_first_name: str | None,
    organizer_name: str | None,
) -> str:
    parts = [
        f"Audience: {audience}",
        f"Reminder window: {reminder_window or 'none (booking brief)'}",
        f"Importance hint: {_importance_from_ctx(ctx)}",
        f"Owner: {ctx.get('ownerName')}",
        f"Contact name: {ctx.get('contactName')}",
        f"Participant first name: {participant_first_name or ctx.get('contactName')}",
        f"Organizer name: {organizer_name or ctx.get('ownerName') or 'Worktual'}",
        f"Title: {ctx.get('contactTitle')}",
        f"Email: {ctx.get('contactEmail')}",
        f"Company: {ctx.get('companyName')}",
        f"Industry: {ctx.get('industry')}",
        f"Domain: {ctx.get('domain')}",
        f"Alignment: {ctx.get('alignment')}",
        f"Lifecycle: {effective_contact_type(ctx.get('contactType'))}",
        f"Lead status: {ctx.get('leadStatus')}",
        f"Pipeline stage: {ctx.get('pipelineStage')}",
        f"Deal: {ctx.get('pipelineDealTitle')}",
        f"Amount: {ctx.get('pipelineAmount')}",
        f"Authority: {ctx.get('authority')}",
        f"Interest: {ctx.get('interest')}",
        f"Lead score: {ctx.get('leadScore')} {ctx.get('leadGrade')}",
        f"Meeting topic: {ctx.get('topic')}",
        f"When: {ctx.get('whenLabel')}",
        f"Provider: {ctx.get('provider')}",
        f"Join link: {ctx.get('meetingLink')}",
        f"Contact path: {ctx.get('contactHref')}",
        f"Company size / employee count: {ctx.get('employeeCount')}",
        f"Days since inquiry: {ctx.get('daysSinceInquiry')}",
        f"First touch at: {ctx.get('firstTouchAt')}",
        f"BANT need: {ctx.get('bantNeed')}",
        f"BANT budget: {ctx.get('bantBudget')}",
        f"BANT timeline: {ctx.get('bantTimeline')}",
        f"BANT authority: {ctx.get('bantAuthority')}",
    ]
    recent_activities = ctx.get("recentActivities")
    if isinstance(recent_activities, list):
        parts.append(
            "Recent CRM activity (newest first):\n"
            + json.dumps(recent_activities[:20], ensure_ascii=False)
        )
    if lead_summary:
        parts.append(f"Lead summary:\n{lead_summary[:2000]}")
    return "\n".join(parts)


async def normalize(state: BriefState) -> BriefState:
    packed = state.get("packed_context")
    if isinstance(packed, dict) and packed:
        return {**state, "context": packed, "status": "loaded"}

    activity_id = state.get("activity_id") or ""
    if not activity_id:
        return {
            **state,
            "status": "failed",
            "reason": "missing_activity_or_context",
            "context": {},
        }

    client = CrmClient(state.get("organization_id"))
    try:
        ctx = await client.get_meeting_brief_context(activity_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("meeting brief context failed: %s", exc)
        return {
            **state,
            "status": "failed",
            "reason": f"context_error:{exc}",
            "context": {},
        }
    if not ctx:
        return {
            **state,
            "status": "failed",
            "reason": "activity_not_found",
            "context": {},
        }
    return {**state, "context": ctx, "status": "loaded"}


async def compose(state: BriefState) -> BriefState:
    if state.get("status") == "failed":
        return state

    ctx = state.get("context") or {}
    if not ctx:
        return {
            **state,
            "status": "failed",
            "reason": "empty_context",
            "subject": None,
            "body": None,
        }

    audience = (state.get("audience") or "owner").lower()
    reminder_window = state.get("reminder_window")
    lead_summary = state.get("lead_summary")
    tier_hint = _importance_from_ctx(ctx)

    # Participant emails require LLM — no blank template success
    if audience == "participant":
        def _validate_participant(parsed: dict[str, Any]) -> dict[str, Any] | None:
            doc = normalize_participant_doc(
                parsed,
                ctx,
                reminder_window=reminder_window,
                participant_first_name=state.get("participant_first_name"),
                organizer_name=state.get("organizer_name"),
            )
            html = render_participant_html(doc, ctx, reminder_window=reminder_window)
            if not doc["subject"] or not html or "MEETING OVERVIEW" not in html:
                return None
            tier = str(parsed.get("importanceTier") or tier_hint).lower()
            if tier not in {"critical", "high", "normal"}:
                tier = tier_hint
            return {
                "subject": doc["subject"][:180],
                "body": html[:PARTICIPANT_HTML_MAX],
                "importance_tier": tier,
            }

        email, llm_reason = await generate_json_with_retries(
            system=PARTICIPANT_PROMPT,
            user=_context_user_blob(
                ctx,
                reminder_window=reminder_window,
                lead_summary=lead_summary,
                audience=audience,
                participant_first_name=state.get("participant_first_name"),
                organizer_name=state.get("organizer_name"),
            ),
            max_tokens=900,
            repair_hint=(
                "Convert into ONLY JSON with subject, intro, valueLine, whatToExpect, "
                "importanceTier. No HTML."
            ),
            validate=_validate_participant,
        )
        if not email:
            return {
                **state,
                "status": "failed",
                "reason": llm_reason or "llm_failed",
                "subject": None,
                "body": None,
            }
        return {
            **state,
            "subject": email["subject"],
            "body": email["body"],
            "importance_tier": email["importance_tier"],
            "status": "ok",
            "reason": None,
        }

    # Owner: structured JSON → HTML. Heuristic HTML only if LLM fails.
    subject = ""
    body = ""
    tier = tier_hint
    used_llm = False

    if is_ai_configured():
        def _validate_owner(parsed: dict[str, Any]) -> dict[str, Any] | None:
            doc = normalize_brief_doc(parsed, ctx, reminder_window)
            html = render_prebrief_html(doc, ctx, reminder_window)
            if not doc["subject"] or not html or "WORKTUAL" not in html:
                return None
            t = doc.get("importanceTier") or ""
            if t not in {"critical", "high", "normal"}:
                t = tier_hint
            return {
                "subject": doc["subject"][:180],
                "body": html[:OWNER_HTML_MAX],
                "importance_tier": t,
            }

        email, _reason = await generate_json_with_retries(
            system=OWNER_BRIEF_PROMPT,
            user=_context_user_blob(
                ctx,
                reminder_window=reminder_window,
                lead_summary=lead_summary,
                audience="owner",
                participant_first_name=state.get("participant_first_name"),
                organizer_name=state.get("organizer_name"),
            ),
            max_tokens=4000,
            repair_hint=(
                "Convert into ONLY JSON matching the briefing schema "
                "(subject, sections). No HTML."
            ),
            validate=_validate_owner,
        )
        if email:
            subject, body = email["subject"], email["body"]
            tier = email["importance_tier"]
            used_llm = True

    if not subject or not body:
        subject, body, tier = _heuristic_owner(ctx, reminder_window, lead_summary)
        used_llm = False

    if not subject or not body:
        return {
            **state,
            "status": "failed",
            "reason": "empty_email",
            "subject": None,
            "body": None,
        }

    return {
        **state,
        "subject": subject,
        "body": body,
        "importance_tier": tier,
        "status": "ok",
        "reason": None if used_llm else "heuristic_fallback",
    }


def _detail_normalize(_before: BriefState, after: BriefState) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {"audience": after.get("audience"), "hasContext": bool(ctx)}


def _detail_compose(_before: BriefState, after: BriefState) -> dict[str, Any] | None:
    return {
        "importanceTier": after.get("importance_tier"),
        "usedFallback": after.get("reason") == "heuristic_fallback",
    }


_PIPELINE_STEPS = (
    traced_step(
            MEETING_BRIEF_MODULE_PATH,
            _brief_agent,
            "normalize",
            "Loading meeting & lead context",
            _detail_normalize,
            id_field="activity_id",
            job_id_field="job_id",
        )(normalize),
    traced_step(
            MEETING_BRIEF_MODULE_PATH,
            _brief_agent,
            "compose",
            "Composing the brief/reminder email",
            _detail_compose,
            id_field="activity_id",
            job_id_field="job_id",
        )(compose),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    activity_id: str,
    contact_id: str | None = None,
    organization_id: str | None = None,
    reminder_window: str | None = None,
    lead_summary: str | None = None,
    audience: str = "owner",
    context: dict[str, Any] | None = None,
    participant_first_name: str | None = None,
    organizer_name: str | None = None,
) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "activity_id": activity_id,
            "contact_id": contact_id,
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "reminder_window": reminder_window,
            "lead_summary": lead_summary,
            "audience": audience or "owner",
            "participant_first_name": participant_first_name,
            "organizer_name": organizer_name,
            "packed_context": context,
            "status": "running",
        }
    )
    return {
        "ok": result.get("status") == "ok",
        "subject": result.get("subject"),
        "body": result.get("body"),
        "reason": result.get("reason"),
        "importanceTier": result.get("importance_tier"),
        "ownerUserId": (result.get("context") or {}).get("ownerUserId"),
        "ownerEmail": (result.get("context") or {}).get("ownerEmail"),
    }
