"""
Lead Scoring Agent.

Fit (0–50) from profile / ICP + Intent (0–50) from engagement = total 0–100.
The LLM scores from CRM context (JSON). If the LLM is down or returns
nothing usable, fail and retry — do not invent a score.
Assignment gate: total >= 40 (hot 70–100, warm 40–69, cold 0–39).
"""

from __future__ import annotations

import logging
import re
from typing import Any, TypedDict, Optional

from app.agents.native_pipeline import run_steps

from app.crm_client import CrmClient
from app.llm import LLM_JOB_TIMEOUT_MS, generate_ai_text, is_ai_configured
from app.agents.llm_result import extract_json, label_ai
from app.agents.step_trace import traced_step

logger = logging.getLogger(__name__)

SCORING_MODULE_PATH = "scoring"
SCORING_AGENT = "lead_scoring"

# One long primary call + one shorter retry; then fail (CRM job retries).
_LLM_ATTEMPTS = 2
_LLM_TIMEOUT_MS = LLM_JOB_TIMEOUT_MS
_LLM_MAX_TOKENS = 1800

SALES_READY_SCORE = 40

SCORE_SYSTEM = """You are a CRM lead scoring agent for Worktual.

score = fitScore (0–50) + intentScore (0–50). Caps are hard.
Assignment gate: salesReady when total >= 40.
Bands: hot >= 70, warm 40–69, cold 0–39.
Grades: A >= 80, B >= 60, C >= 40, else D.

fitScore — who they are (profile / ICP). Use title, companyName, industry,
employeeCount, country/city, email domain, hasEmail, hasPhone, icp.
A newly created named B2B contact with a company, a job title, and a phone
or email is NOT a 0. Typical floors (do not exceed without more evidence):
- company + title + phone or email: fit 18–28
- plus seniority (manager/director/VP/C-level): toward the top of that range
- plus ICP/industry/geo match: up to ~40
- empty name-only record: fit 0–8
Do not invent company, title, or industry that are not in the facts.

intentScore — what they did. Use activities, inbound email, calls/meetings,
demo/quote, scheduling, opens/clicks, recency, omniChannelSummary, BANT.
No emails, calls, meetings, or omni paragraph → intent 0–8 (not a high intent).
omniChannelSummary is a CCaaS / omnichannel conversation paragraph from CDP.
Treat it as customer-voice engagement when present.

Use ONLY the provided facts. Do not invent activities or BANT.

Key signals (positiveReasons, behaviouralPositiveReasons, behaviouralReasons,
factors) are shown to a salesperson. Each item is one short phrase they can
understand at a glance, 12 words or fewer. Say what it means in plain language.
Never copy a fact key or write "fieldName: number".
Good: "Manager at Adidas with a mobile number"
Good: "No emails or calls in the recent window"
Bad: "recentActivityCount: 0"
Bad: "inboundEmailCount: 0"
Cite profile facts in positiveReasons/factors when they drove fitScore.
Cite activities when they drove intentScore.

Intent rules (mandatory):
- demoOrQuoteRequests counts distinct inbound customer emails/calls/meetings with
  demo/quote language — NOT outbound bot or rep mail. Use the exact number provided;
  never infer a higher count from thread quotes or snippets.
- demoOrQuoteRequests > 0 OR schedulingReplies > 0 = explicit demo/quote/scheduling
  intent — score Intent high (typically >= 28) and do NOT cite "no demo requests".
- schedulingReplies means the customer confirmed a proposed time ("works for me",
  "10:45 am", etc.) — same weight as a demo request.
- recentActivitySnippet shows latest inbound replies; treat demo/scheduling language
  there as high intent even if counters are zero.
- ownerUserId set with inboundEmailCount > 0 = assigned rep is actively following up;
  do not downgrade to cold nurture while recent inbound exists.
- If recentActivityCount > 0 OR callOrMeetingCount > 0 OR omniChannelSummary is
  present, you MUST NOT say there is no recent activity, no calls, no emails, or
  no engagement in rationale or reasons.
  Nurture voice-bot calls, CCaaS omnichannel conversations, and logged CRM calls
  count as activity.

nextBestAction must use a channel the CRM sales rep can take: email or call
(and booking a meeting when a demo is confirmed). Never recommend WhatsApp,
Instagram, Facebook, SMS, LinkedIn, or social DMs. Use hasEmail/hasPhone:
email if they have an email, otherwise call if they have a phone, otherwise
ask to capture email or phone.

Return ONLY valid JSON (no markdown):
{
  "fitScore": <0-50 int>,
  "intentScore": <0-50 int>,
  "score": <0-100 int>,
  "grade": "A"|"B"|"C"|"D",
  "band": "hot"|"warm"|"cold",
  "salesReady": <bool>,
  "rationale": "<1-2 sentences>",
  "positiveReasons": ["..."],
  "negativeReasons": ["..."],
  "behaviouralPositiveReasons": ["..."],
  "behaviouralNegativeReasons": ["..."],
  "behaviouralReasons": ["..."],
  "factors": ["..."],
  "nextBestAction": "<one clear next step>",
  "scoreBreakdown": {},
  "pillars": {"demographics": <0-25>, "firmographics": <0-25>, "behavioural": <0-50>}
}
"""


class ScoreState(TypedDict, total=False):
    contact_id: str
    organization_id: Optional[str]
    context: dict[str, Any]
    result: dict[str, Any]
    status: str
    reason: Optional[str]
    source: str


def _clamp(n: float, mx: int) -> int:
    return max(0, min(mx, round(n)))


def _grade(score: int) -> str:
    if score >= 80:
        return "A"
    if score >= 60:
        return "B"
    if score >= 40:
        return "C"
    return "D"


def _band(score: int) -> str:
    if score >= 70:
        return "hot"
    if score >= SALES_READY_SCORE:
        return "warm"
    return "cold"


_UNAVAILABLE_OUTREACH_RE = re.compile(
    r"\b(whatsapp|wa\b|instagram|facebook|messenger|sms|"
    r"text(?:\s+messages?)?|telegram|wechat|linkedin|social(?:\s+media)?)\b",
    re.I,
)


def clamp_outreach_to_crm_channels(
    action: str | None,
    *,
    has_email: bool,
    has_phone: bool,
) -> str:
    """CRM outbound is email and call only — rewrite social/SMS suggestions."""
    text = (action or "").strip()
    if not text:
        return text
    if not _UNAVAILABLE_OUTREACH_RE.search(text):
        return text
    if has_email:
        rewritten = _UNAVAILABLE_OUTREACH_RE.sub("email", text)
        rewritten = re.sub(r"\bon email\b", "by email", rewritten, flags=re.I)
        rewritten = re.sub(r"\bvia email\b", "by email", rewritten, flags=re.I)
        rewritten = re.sub(r"\sthrough email\b", "by email", rewritten, flags=re.I)
        return rewritten
    if has_phone:
        rewritten = _UNAVAILABLE_OUTREACH_RE.sub("call", text)
        rewritten = re.sub(r"\bon call\b", "with a call", rewritten, flags=re.I)
        rewritten = re.sub(r"\bvia call\b", "with a call", rewritten, flags=re.I)
        rewritten = re.sub(
            r"\bfollow up on call\b",
            "follow up with a call",
            rewritten,
            flags=re.I,
        )
        return rewritten
    return "Capture a verified email or phone, then follow up."


async def load_context(state: ScoreState) -> ScoreState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_scoring_context(state["contact_id"])
    return {**state, "context": ctx}


def _coerce_score_half(value: Any, mx: int) -> int | None:
    if value is None or value == "":
        return None
    try:
        return _clamp(float(value), mx)
    except (TypeError, ValueError):
        return None


def _normalize_llm_score(parsed: dict[str, Any], ctx: dict[str, Any]) -> dict[str, Any] | None:
    """Clamp LLM JSON. score = fit (0–50) + intent (0–50)."""
    fit = _coerce_score_half(parsed.get("fitScore"), 50)
    intent = _coerce_score_half(parsed.get("intentScore"), 50)
    total = _coerce_score_half(parsed.get("score"), 100)

    if fit is None and intent is None and total is None:
        return None
    if fit is None:
        fit = 0
    if intent is None:
        intent = _clamp((total or 0) - fit, 50) if total is not None else 0
    score = _clamp(fit + intent, 100)
    if total is not None and abs(total - (fit + intent)) <= 8:
        score = total

    grade = str(parsed.get("grade") or _grade(score)).upper()[:1]
    if grade not in {"A", "B", "C", "D"}:
        grade = _grade(score)
    band = str(parsed.get("band") or _band(score)).lower()
    if band not in {"hot", "warm", "cold"}:
        band = _band(score)

    sales_ready = bool(parsed.get("salesReady")) if "salesReady" in parsed else score >= SALES_READY_SCORE
    sales_ready = sales_ready and score >= SALES_READY_SCORE

    title = (ctx.get("title") or "").strip()
    company = (ctx.get("companyName") or "").strip()
    bant_hits = sum(
        1
        for k in ("bantBudget", "bantAuthority", "bantNeed", "bantTimeline")
        if ctx.get(k)
    )

    def _str_list(key: str, limit: int = 5) -> list[str]:
        raw = parsed.get(key)
        if not isinstance(raw, list):
            return []
        return [
            text
            for text in (str(x).strip() for x in raw)
            if text and not re.fullmatch(r"[a-z][A-Za-z0-9]*:\s*\d+", text)
        ][:limit]

    pillars = parsed.get("pillars") if isinstance(parsed.get("pillars"), dict) else {}
    breakdown = parsed.get("scoreBreakdown") if isinstance(parsed.get("scoreBreakdown"), dict) else {}

    next_action = clamp_outreach_to_crm_channels(
        str(parsed.get("nextBestAction") or "").strip(),
        has_email=bool(ctx.get("hasEmail")),
        has_phone=bool(ctx.get("hasPhone")),
    )

    rationale = str(parsed.get("rationale") or "").strip()
    if not rationale:
        rationale = f"Fit {fit}/50 · Intent {intent}/50 · Total {score}/100 ({band})."

    recent_count = int(ctx.get("recentActivityCount") or 0)
    call_meeting_count = int(ctx.get("callOrMeetingCount") or 0)
    has_omni = bool(str(ctx.get("omniChannelSummary") or "").strip())
    has_activity = recent_count > 0 or call_meeting_count > 0 or has_omni
    no_activity_claim = re.compile(
        r"(?i)\b("
        r"no recorded recent activity|"
        r"no recent activity|"
        r"no signals of intent|"
        r"no engagement|"
        r"no emails?,?\s*calls?"
        r")\b"
    )

    def _drop_no_activity(items: list[str]) -> list[str]:
        if not has_activity:
            return items
        return [item for item in items if not no_activity_claim.search(item)]

    if has_activity and no_activity_claim.search(rationale):
        rationale = (
            f"Fit {fit}/50 · Intent {intent}/50 · Total {score}/100 ({band}). "
            f"{recent_count} recent touch(es), "
            f"{call_meeting_count} call/meeting(s) in window."
        )

    return {
        "score": score,
        "fitScore": fit,
        "intentScore": intent,
        "grade": grade,
        "band": band,
        "salesReady": sales_ready,
        "rationale": rationale[:800],
        "scoreBreakdown": breakdown,
        "pillars": {
            "demographics": _clamp(
                float(pillars.get("demographics", round(fit * 0.5))), 25
            ),
            "firmographics": _clamp(
                float(pillars.get("firmographics", round(fit * 0.5))), 25
            ),
            "behavioural": _clamp(float(pillars.get("behavioural", intent)), 50),
        },
        "positiveReasons": _drop_no_activity(_str_list("positiveReasons", 3)),
        "negativeReasons": _drop_no_activity(_str_list("negativeReasons", 3)),
        "behaviouralPositiveReasons": _drop_no_activity(
            _str_list("behaviouralPositiveReasons", 3)
        ),
        "behaviouralNegativeReasons": _drop_no_activity(
            _str_list("behaviouralNegativeReasons", 3)
        ),
        "behaviouralReasons": _drop_no_activity(_str_list("behaviouralReasons", 5)),
        "factors": _drop_no_activity(_str_list("factors", 12)),
        "nextBestAction": next_action[:240],
        "flags": {
            "fitScore": fit,
            "intentScore": intent,
            "grade": grade,
            "band": band,
            "salesReady": sales_ready,
            "hasEmail": bool(ctx.get("hasEmail")),
            "hasPhone": bool(ctx.get("hasPhone")),
            "hasTitle": bool(title),
            "hasCompany": bool(company),
            "recentActivityCount": recent_count,
            "bantHits": bant_hits,
            "leadStatus": ctx.get("leadStatus"),
            "source": "ai",
        },
    }


def _context_user_payload(ctx: dict[str, Any]) -> str:
    keys = [
        "displayName",
        "title",
        "companyName",
        "industry",
        "city",
        "country",
        "employeeCount",
        "email",
        "seniorityTier",
        "emailDomainType",
        "icp",
        "contactType",
        "leadStatus",
        "leadSource",
        "bantBudget",
        "bantAuthority",
        "bantNeed",
        "bantTimeline",
        "hasEmail",
        "hasPhone",
        "recentActivityCount",
        "inboundEmailCount",
        "callOrMeetingCount",
        "pricingPageVisits",
        "demoOrQuoteRequests",
        "emailOpens",
        "emailClicks",
        "contentDownloads",
        "webinarAttended",
        "websiteVisits7d",
        "daysSinceLastActivity",
        "convertedOutcome",
        "intentDecayPenalty",
        "ownerUserId",
        "schedulingReplies",
        "recentActivitySnippet",
        "omniChannelSummary",
    ]
    lines = ["CRM scoring facts (use only these):"]
    for k in keys:
        if k in ctx and ctx.get(k) is not None:
            lines.append(f"{k}: {ctx.get(k)}")
    return "\n".join(lines)


async def _repair_score_json(raw: str) -> dict[str, Any] | None:
    """Ask the model to emit valid score JSON from a broken prior reply."""
    fixed = await generate_ai_text(
        system=(
            "Convert the following text into ONLY valid JSON for lead scoring. "
            "Required keys: fitScore (0-50), intentScore (0-50), score (0-100), "
            "grade, band, salesReady, rationale, nextBestAction. No markdown."
        ),
        user=raw[:4500],
        max_tokens=1200,
        timeout_ms=30_000,
    )
    return extract_json(fixed or "")


async def score_via_llm(ctx: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    """Primary LLM path with retries. Caller must fail if this returns None."""
    if not is_ai_configured():
        return None, "llm_not_configured"

    user = _context_user_payload(ctx)
    last_reason = "llm_empty"

    for attempt in range(1, _LLM_ATTEMPTS + 1):
        # First try allows a slow completion; later tries fail over faster.
        call_timeout = _LLM_TIMEOUT_MS if attempt == 1 else min(_LLM_TIMEOUT_MS, 60_000)
        try:
            raw = await generate_ai_text(
                system=SCORE_SYSTEM,
                user=user,
                max_tokens=_LLM_MAX_TOKENS,
                timeout_ms=call_timeout,
            )
        except Exception as err:  # noqa: BLE001
            last_reason = f"llm_error:{type(err).__name__}"
            logger.warning(
                "score-lead: LLM attempt %s/%s raised %s",
                attempt,
                _LLM_ATTEMPTS,
                err,
            )
            continue

        if not raw:
            last_reason = "llm_empty"
            logger.warning(
                "score-lead: LLM attempt %s/%s empty",
                attempt,
                _LLM_ATTEMPTS,
            )
            continue

        parsed = extract_json(raw)
        if not parsed:
            last_reason = "llm_bad_json"
            parsed = await _repair_score_json(raw)
            if not parsed:
                logger.warning(
                    "score-lead: LLM attempt %s/%s bad JSON (repair failed)",
                    attempt,
                    _LLM_ATTEMPTS,
                )
                continue
            last_reason = "llm_repaired_json"

        normalized = _normalize_llm_score(parsed, ctx)
        if not normalized:
            last_reason = "llm_invalid_scores"
            logger.warning(
                "score-lead: LLM attempt %s/%s invalid scores keys=%s",
                attempt,
                _LLM_ATTEMPTS,
                list(parsed.keys())[:12],
            )
            continue

        return label_ai(normalized), None

    return None, last_reason


async def compute(state: ScoreState) -> ScoreState:
    ctx = state.get("context") or {}
    if not ctx:
        return {
            **state,
            "status": "failed",
            "reason": "contact_not_found",
            "source": "ai",
        }

    llm_result, llm_reason = await score_via_llm(ctx)
    if llm_result:
        return {
            **state,
            "result": llm_result,
            "status": "scored",
            "reason": "llm_scored",
            "source": "ai",
        }

    logger.warning(
        "score-lead: LLM unavailable after retries (%s); not inventing a score",
        llm_reason,
    )
    return {
        **state,
        "status": "failed",
        "reason": llm_reason or "llm_unavailable",
        "source": "ai",
    }


def _detail_load_context(
    _before: ScoreState, after: ScoreState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {
        "hasCompany": bool(ctx.get("companyName")),
        "hasTitle": bool(ctx.get("title")),
        "hasEmail": bool(ctx.get("hasEmail")),
    }


def _detail_compute(
    _before: ScoreState, after: ScoreState
) -> dict[str, Any] | None:
    result = after.get("result") or {}
    detail: dict[str, Any] = {
        "score": result.get("score"),
        "fitScore": result.get("fitScore"),
        "intentScore": result.get("intentScore"),
        "band": result.get("band"),
        "grade": result.get("grade"),
        "source": after.get("source"),
        "rationale": result.get("rationale"),
    }
    for key in (
        "positiveReasons",
        "negativeReasons",
        "behaviouralPositiveReasons",
        "behaviouralNegativeReasons",
        "behaviouralReasons",
        "factors",
    ):
        val = result.get(key)
        if isinstance(val, list) and val:
            detail[key] = val
    return detail or None


_PIPELINE_STEPS = (
    traced_step(
            SCORING_MODULE_PATH,
            SCORING_AGENT,
            "load_context",
            "Loading contact & company context",
            _detail_load_context,
        )(load_context),
    traced_step(
            SCORING_MODULE_PATH,
            SCORING_AGENT,
            "compute",
            "Scoring fit & intent",
            _detail_compute,
        )(compute),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(contact_id: str, organization_id: str | None = None) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "contact_id": contact_id,
            "organization_id": organization_id,
            "status": "running",
            "reason": None,
            "source": "ai",
        }
    )
    payload = result.get("result") or {}
    return {
        "contactId": contact_id,
        "status": result.get("status") or "failed",
        "reason": result.get("reason"),
        "source": result.get("source") or "ai",
        **payload,
    }
