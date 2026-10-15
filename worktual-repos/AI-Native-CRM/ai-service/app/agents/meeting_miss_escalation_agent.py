"""Meeting Miss Escalation Agent (LangGraph).

Analyzes lead importance, sales owner, deal/pipeline, capture status, and
meeting context after a miss (no transcript past grace). Composes an intelligent
admin escalation email — never a fill-in-the-blanks template.
"""

from __future__ import annotations

import json
import logging
from typing import Any, TypedDict, Optional
from uuid import uuid4

from app.agents.native_pipeline import run_steps

from app.llm import LLM_DEFAULT_TIMEOUT_MS, generate_ai_text, is_ai_configured
from app.agents.llm_result import extract_json, label_ai, label_fallback
from app.agents.step_trace import traced_step

logger = logging.getLogger(__name__)

MEETING_MISS_MODULE_PATH = "meeting-miss"
MEETING_MISS_AGENT = "meeting_miss_escalation"

_LLM_ATTEMPTS = 2
# Two LLM steps (analyze + compose) must fit under Fastify's ~210–240s job budget.
_ANALYZE_TIMEOUT_MS = LLM_DEFAULT_TIMEOUT_MS
_COMPOSE_TIMEOUT_MS = LLM_DEFAULT_TIMEOUT_MS


class MissState(TypedDict, total=False):
    context: dict[str, Any]
    activity_id: Optional[str]
    contact_id: Optional[str]
    organization_id: Optional[str]
    job_id: str
    analysis: dict[str, Any]
    subject: Optional[str]
    body: Optional[str]
    in_app_title: Optional[str]
    in_app_body: Optional[str]
    status: str
    reason: Optional[str]
    source: str


ANALYZE_PROMPT = """You are a CRM ops analyst. A scheduled meeting has no transcript/attendance
evidence after the capture grace window. Analyze the FULL context and return ONLY valid JSON:
{
  "importanceTier": "critical|high|normal",
  "situationSummary": "2-4 sentences: what happened and why it matters for this lead/owner",
  "leadImportanceRationale": "why this lead is/isn't critical (score, lifecycle, deal)",
  "ownerAssessment": "sales owner context; do NOT claim they skipped — mention capture/bot/no-show possibilities",
  "recommendedNextStep": "one concrete next step (reschedule / chase lead / check bot admit / mark no-show / manager follow-up)"
}

Rules:
- Use only provided facts. No invented numbers or quotes.
- importanceTier: critical if score>=70 or grade A or qualified; high if score>=40 or grade B or open deal; else normal.
- Be specific to this lead, company, owner, and meeting.
"""

COMPOSE_PROMPT = """You write an escalation email to CRM organization admins about a meeting miss.
Return ONLY valid JSON (no markdown):
{
  "subject": "...",
  "body": "...",
  "inAppTitle": "...",
  "inAppBody": "..."
}

Rules:
- Subject: scannable; include contact/company and importance when critical/high.
- Body: plain text. Include situation summary, lead importance rationale, sales owner context,
  meeting details (topic/when/link), capture status, and a clear recommended next step.
- Do not falsely blame the salesperson. Note possible no-show, bot not admitted, or capture failure.
- inAppTitle / inAppBody: short variants for the in-app notification bell.
- Sign off as Worktual Meeting Miss Escalation Agent.
- No invented facts — use analysis + context only.
"""


def _ctx_blob(ctx: dict[str, Any]) -> str:
    keys = [
        "contactName",
        "contactTitle",
        "contactEmail",
        "companyName",
        "industry",
        "domain",
        "alignment",
        "contactType",
        "leadStatus",
        "leadScore",
        "leadGrade",
        "authority",
        "interest",
        "pipelineStage",
        "pipelineDealTitle",
        "pipelineAmount",
        "topic",
        "whenLabel",
        "provider",
        "meetingLink",
        "ownerName",
        "ownerEmail",
        "ownerUserId",
        "organizerName",
        "contactHref",
        "captureStatus",
        "captureError",
        "graceHours",
        "leadSummary",
        "dueAt",
    ]
    lines = [f"{k}: {ctx.get(k)}" for k in keys if ctx.get(k) is not None]
    return "\n".join(lines) if lines else json.dumps(ctx, default=str)[:4000]


def _extract_json(text: str) -> dict[str, Any] | None:
    return extract_json(text)


def _importance_tier(ctx: dict[str, Any]) -> str:
    score_raw = ctx.get("leadScore")
    try:
        score = float(score_raw) if score_raw is not None else None
    except (TypeError, ValueError):
        score = None
    grade = str(ctx.get("leadGrade") or "").upper()
    status = str(ctx.get("leadStatus") or "").lower()
    if (
        (score is not None and score >= 70)
        or grade == "A"
        or status == "qualified"
    ):
        return "critical"
    if (
        (score is not None and score >= 40)
        or grade == "B"
        or bool(ctx.get("pipelineStage"))
    ):
        return "high"
    return "normal"


def _offline_analysis(ctx: dict[str, Any], reason: str) -> dict[str, Any]:
    who = ctx.get("contactName") or "Contact"
    company = ctx.get("companyName")
    topic = ctx.get("topic") or "Meeting"
    when = ctx.get("whenLabel") or ctx.get("dueAt") or "scheduled time"
    capture = ctx.get("captureError") or ctx.get("captureStatus") or "no transcript"
    return {
        "importanceTier": _importance_tier(ctx),
        "situationSummary": (
            f"{topic} with {who}"
            + (f" ({company})" if company else "")
            + f" at {when} has no transcript after the capture grace window "
            f"({capture})."
        ),
        "leadImportanceRationale": (
            f"Lead score={ctx.get('leadScore')}, grade={ctx.get('leadGrade')}, "
            f"lifecycle={ctx.get('contactType')}/{ctx.get('leadStatus')}, "
            f"pipeline={ctx.get('pipelineStage')}."
        ),
        "ownerAssessment": (
            f"Owner {ctx.get('ownerName') or ctx.get('ownerEmail') or 'unassigned'}. "
            "Do not assume skip — possible no-show, bot not admitted, or capture failure."
        ),
        "recommendedNextStep": (
            "Confirm meeting outcome, check bot admit/capture, reschedule with the lead, "
            "or mark as no-show."
        ),
        "offlineReason": reason,
    }


def _offline_email(
    ctx: dict[str, Any], analysis: dict[str, Any]
) -> dict[str, str]:
    who = ctx.get("contactName") or "Contact"
    company = f" ({ctx.get('companyName')})" if ctx.get("companyName") else ""
    topic = ctx.get("topic") or "Meeting"
    when = ctx.get("whenLabel") or ctx.get("dueAt") or "scheduled time"
    owner = ctx.get("ownerName") or ctx.get("ownerEmail") or "unassigned"
    subject = f"Meeting miss: {who}{company} — {topic}"[:180]
    body = "\n".join(
        [
            analysis.get("situationSummary") or "",
            "",
            analysis.get("leadImportanceRationale") or "",
            analysis.get("ownerAssessment") or "",
            f"Meeting: {topic}",
            f"When: {when}",
            f"Owner: {owner}",
            f"Link: {ctx.get('meetingLink')}" if ctx.get("meetingLink") else "",
            "",
            f"Next step: {analysis.get('recommendedNextStep')}",
            "",
            "— Worktual Meeting Miss Escalation Agent",
        ]
    ).strip()
    return {
        "subject": subject,
        "body": body[:6000],
        "in_app_title": subject[:160],
        "in_app_body": (
            f"{topic} with {who} — no transcript. Owner: {owner}."
        )[:500],
    }


async def analyze(state: MissState) -> MissState:
    ctx = state.get("context") or {}
    if not ctx:
        return {**state, "status": "failed", "reason": "empty_context"}

    if is_ai_configured():
        last_reason = "analyze_parse_failed"
        for attempt in range(1, _LLM_ATTEMPTS + 1):
            call_timeout = (
                _ANALYZE_TIMEOUT_MS
                if attempt == 1
                else min(_ANALYZE_TIMEOUT_MS, 45_000)
            )
            try:
                raw = await generate_ai_text(
                    system=ANALYZE_PROMPT,
                    user=_ctx_blob(ctx),
                    max_tokens=900,
                    timeout_ms=call_timeout,
                )
            except Exception as err:  # noqa: BLE001
                last_reason = f"analyze_error:{type(err).__name__}"
                logger.warning(
                    "meeting-miss analyze attempt %s failed: %s", attempt, err
                )
                continue
            parsed = _extract_json(raw or "")
            if not parsed:
                last_reason = "analyze_parse_failed"
                continue
            tier = str(parsed.get("importanceTier") or "normal").lower()
            if tier not in {"critical", "high", "normal"}:
                tier = "normal"
            analysis = {
                "importanceTier": tier,
                "situationSummary": str(
                    parsed.get("situationSummary") or ""
                ).strip()[:1200],
                "leadImportanceRationale": str(
                    parsed.get("leadImportanceRationale") or ""
                ).strip()[:800],
                "ownerAssessment": str(
                    parsed.get("ownerAssessment") or ""
                ).strip()[:800],
                "recommendedNextStep": str(
                    parsed.get("recommendedNextStep") or ""
                ).strip()[:400],
            }
            if (
                analysis["situationSummary"]
                and analysis["recommendedNextStep"]
            ):
                return {
                    **state,
                    "analysis": analysis,
                    "status": "analyzed",
                    "source": "ai",
                }
            last_reason = "analyze_incomplete"
        logger.warning(
            "meeting-miss: analyze LLM failed (%s); agent offline analysis",
            last_reason,
        )
        analysis = _offline_analysis(ctx, last_reason)
        return {
            **state,
            "analysis": analysis,
            "status": "analyzed",
            "reason": last_reason,
            "source": "heuristic",
        }

    analysis = _offline_analysis(ctx, "llm_not_configured")
    return {
        **state,
        "analysis": analysis,
        "status": "analyzed",
        "reason": "llm_not_configured",
        "source": "heuristic",
    }


async def compose_email(state: MissState) -> MissState:
    if state.get("status") != "analyzed":
        return state

    ctx = state.get("context") or {}
    analysis = state.get("analysis") or {}
    source = state.get("source") or "ai"

    if is_ai_configured() and source == "ai":
        user = (
            "CONTEXT:\n"
            + _ctx_blob(ctx)
            + "\n\nANALYSIS:\n"
            + json.dumps(analysis, indent=2)
        )
        for attempt in range(1, _LLM_ATTEMPTS + 1):
            call_timeout = (
                _COMPOSE_TIMEOUT_MS
                if attempt == 1
                else min(_COMPOSE_TIMEOUT_MS, 45_000)
            )
            try:
                raw = await generate_ai_text(
                    system=COMPOSE_PROMPT,
                    user=user,
                    max_tokens=1200,
                    timeout_ms=call_timeout,
                )
            except Exception as err:  # noqa: BLE001
                logger.warning(
                    "meeting-miss compose attempt %s failed: %s", attempt, err
                )
                continue
            parsed = _extract_json(raw or "")
            if not parsed:
                continue
            subject = str(parsed.get("subject") or "").strip()[:180]
            body = str(parsed.get("body") or "").strip()[:6000]
            in_app_title = str(parsed.get("inAppTitle") or "").strip()[:160]
            in_app_body = str(parsed.get("inAppBody") or "").strip()[:500]
            if not subject or not body:
                continue
            if not in_app_title:
                in_app_title = subject[:160]
            if not in_app_body:
                in_app_body = (analysis.get("situationSummary") or body)[:500]
            labeled = label_ai(
                {
                    "subject": subject,
                    "body": body,
                    "in_app_title": in_app_title,
                    "in_app_body": in_app_body,
                }
            )
            return {
                **state,
                **labeled,
                "status": "ok",
                "reason": None,
                "source": "ai",
            }
        logger.warning(
            "meeting-miss: compose LLM failed; agent offline email"
        )

    offline = label_fallback(
        _offline_email(ctx, analysis),
        state.get("reason") or "compose_offline",
    )
    return {
        **state,
        "subject": offline["subject"],
        "body": offline["body"],
        "in_app_title": offline["in_app_title"],
        "in_app_body": offline["in_app_body"],
        "status": "ok",
        "reason": offline.get("reason"),
        "source": "heuristic",
    }


def _detail_analyze(_before: MissState, after: MissState) -> dict[str, Any] | None:
    analysis = after.get("analysis") or {}
    return {"importanceTier": analysis.get("importanceTier"), "source": after.get("source")}


def _detail_compose_email(_before: MissState, after: MissState) -> dict[str, Any] | None:
    return {"source": after.get("source")}


_PIPELINE_STEPS = (
    traced_step(
            MEETING_MISS_MODULE_PATH,
            MEETING_MISS_AGENT,
            "analyze",
            "Analyzing meeting-miss importance & evidence",
            _detail_analyze,
            id_field="activity_id",
            job_id_field="job_id",
        )(analyze),
    traced_step(
            MEETING_MISS_MODULE_PATH,
            MEETING_MISS_AGENT,
            "compose_email",
            "Composing the admin escalation email",
            _detail_compose_email,
            id_field="activity_id",
            job_id_field="job_id",
        )(compose_email),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    context: dict[str, Any] | None = None,
    organization_id: str | None = None,
    activity_id: str | None = None,
) -> dict[str, Any]:
    ctx = dict(context or {})
    activity_id = activity_id or ctx.get("activityId")
    if activity_id and "activityId" not in ctx:
        ctx["activityId"] = activity_id
    result = await _run_pipeline(
        {
            "context": ctx,
            "status": "running",
            "source": "ai",
            "activity_id": activity_id,
            "contact_id": ctx.get("contactId"),
            "organization_id": organization_id,
            "job_id": str(uuid4()),
        }
    )
    return {
        "ok": result.get("status") == "ok",
        "subject": result.get("subject"),
        "body": result.get("body"),
        "inAppTitle": result.get("in_app_title"),
        "inAppBody": result.get("in_app_body"),
        "analysis": result.get("analysis"),
        "importanceTier": (result.get("analysis") or {}).get("importanceTier"),
        "reason": result.get("reason"),
        "source": result.get("source") or "ai",
    }
