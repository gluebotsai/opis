"""
Lead Nurture Agent (LangGraph).

Primary path: LLM decide + compose.
Heuristic templates are offline fallback only.
Hard safety guardrails may override unsafe nurture_now.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, TypedDict, Optional

from app.agents.native_pipeline import run_steps

from app.agents.llm_result import (
    extract_json,
    generate_json_with_retries,
    sectioned_system_prompt,
)
from app.agents.step_trace import traced_step
from app.crm_client import CrmClient
from app.llm import generate_ai_text, is_ai_configured
from app.agents.crm_tools import effective_contact_type

logger = logging.getLogger(__name__)

NURTURE_MODULE_PATH = "nurture"
NURTURE_AGENT = "lead_nurture"

RECENT_ACTIVITY_MS = 24 * 60 * 60_000
SEND_COOLDOWN_MS = 14 * 24 * 60 * 60_000
NOT_INTERESTED_RE = re.compile(
    r"not interested|no longer|unsubscribe|do not contact|stop emailing|wrong person|remove me",
    re.I,
)


class NurtureState(TypedDict, total=False):
    contact_id: str
    organization_id: Optional[str]
    context: dict[str, Any]
    decision: str
    score: int
    rationale: str
    wait_days: Optional[int]
    brief: Optional[str]
    campaign_name: Optional[str]
    goal: Optional[str]
    voice_instruction: Optional[str]
    subject: Optional[str]
    body: Optional[str]
    status: str
    source: str
    reason: Optional[str]


DECIDE_SYSTEM = sectioned_system_prompt(
    role="You are a CRM nurture agent for Worktual.",
    goal="Decide whether to re-engage this lead now, wait, or skip.",
    instructions=(
        "- This job only runs for unowned leads already below the assign "
        "gate (cold / nurture pool). Outreach is the point of the job.\n"
        "- Choose nurture_now when they have a phone or email and there is "
        "no cooldown, last-day inbound activity, or opt-out. A New or "
        "just-created lead with a phone is still nurture_now so CRM can "
        "place the nurture call (or email if voice is off).\n"
        "- Do not wait merely because lead status is New, they were just "
        "created, the score is low, or the profile is thin.\n"
        "- A phone number plus a low lead score (below 40) is nurture_now. "
        "Do not skip that lead because the score is low.\n"
        "- Choose wait only if we already nurtured them recently, they had "
        "real inbound activity in the last day, or a live conversation is "
        "still warm.\n"
        "- Choose skip_not_interested only if they declined, opted out, or "
        "asked to stop. A thin profile is not a decline. Missing company, "
        "industry, title, or activity is not a reason to skip when a phone "
        "or email is on file.\n"
        "- Do not invent facts."
    ),
    context="Runtime lead facts are in the user message.",
    output=(
        'Return ONLY JSON: {"decision":"nurture_now"|"wait"|"skip_not_interested",'
        '"score":0-100,"rationale":"short","waitDays":number|null}'
    ),
    guardrails="Never invent meetings, prices, or commitments.",
)

COMPOSE_SYSTEM = sectioned_system_prompt(
    role=(
        "You prepare personalised lead nurture for Worktual CRM. Campaign MS "
        "generates the recipient email from your brief; CRM may fall back to "
        "your subject/body if Campaign is unavailable."
    ),
    goal=(
        "Re-engage this specific lead with intent that shows you remember who "
        "they are and what their company cares about — not a generic check-in."
    ),
    instructions=(
        "- brief: operator intent for Campaign (2–6 sentences). Never paste "
        "raw CRM fields; synthesize tone, angle, and next step. Not the email body.\n"
        "- name: short campaign title for monitoring (≤120 chars).\n"
        "- goal: optional one line for generation (≤200 chars).\n"
        "- voiceInstruction: 3–6 concise sentences instructing the calling bot. "
        "State the evidence-backed reason for this call, the product/capability "
        "the person showed interest in, the desired outcome, and one or two "
        "useful questions to ask. For example, if context says they want CCaaS "
        "omnichannel, explicitly say they are interested in buying a CCaaS "
        "omnichannel product and ask about channels, users, and timeline. "
        "Never invent an interest that is not present in the context.\n"
        "- subject/body: plain-text fallback email, 2–4 short paragraphs, no markdown.\n"
        "- Open fallback body with their first name.\n"
        "- Reference at least ONE concrete detail from context.\n"
        '- Fallback sign-off: "Best regards" only — no sender name block.'
    ),
    context="Lead profile, summary, enrichment, score, deals, and recent activities are in the user message.",
    output=(
        'Return ONLY JSON: {"brief":"...","name":"...","goal":"...",'
        '"voiceInstruction":"...","subject":"...","body":"..."}'
    ),
    guardrails=(
        "Never invent meetings, prices, discounts, or commitments.\n"
        "Every claim in voiceInstruction must be grounded in the supplied lead "
        "summary, intent, custom fields, deals, notes, or activities.\n"
        "brief and fallback subject/body must differ per lead based on facts.\n"
        "Do not claim you spoke recently unless an activity supports it."
    ),
)


def _ms_ago(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        ts = datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000
        return datetime.now(timezone.utc).timestamp() * 1000 - ts
    except Exception:
        return None


def heuristic_decide(ctx: dict[str, Any]) -> dict[str, Any]:
    if _initial_voice_nurture_eligible(ctx):
        return {
            "decision": "nurture_now",
            "score": 70,
            "rationale": (
                "New lead with phone on file — schedule first nurture voice call."
            ),
        }

    notes = ctx.get("notes") or ""
    acts = ctx.get("activities") or []
    blob = " ".join(
        [notes] + [f"{a.get('subject', '')} {a.get('body') or ''}" for a in acts]
    ).lower()
    if NOT_INTERESTED_RE.search(blob) or ctx.get("leadStatus") == "disqualified":
        return {
            "decision": "skip_not_interested",
            "score": 5,
            "rationale": "Signals suggest the lead is not interested.",
        }

    last_sent = ctx.get("lastSentAt")
    ago = _ms_ago(last_sent) if isinstance(last_sent, str) else None
    if ago is not None and ago < SEND_COOLDOWN_MS:
        return {
            "decision": "skip_guardrail",
            "score": 20,
            "rationale": "Nurture cooldown — already emailed recently.",
        }

    last_act = acts[0].get("createdAt") if acts else None
    act_ago = _ms_ago(last_act)
    if act_ago is not None and act_ago < RECENT_ACTIVITY_MS:
        return {
            "decision": "wait",
            "score": 40,
            "rationale": "Recent activity — wait before re-engaging.",
            "waitDays": 2,
        }

    bant = ctx.get("bant") or {}
    bant_score = sum(
        1 for k in ("budget", "authority", "need", "timeline") if bant.get(k)
    )
    score = 50
    days = ctx.get("daysSinceLastActivity")
    if days is None:
        score += 15
    elif days >= 14:
        score += 25
    elif days >= 5:
        score += 15
    elif days >= 2:
        score += 5
    else:
        score -= 10

    if (ctx.get("leadStatus") or "") in {"qualifying", "qualified", "contacted"}:
        score += 15
    if ctx.get("leadStatus") == "new" and (days if days is not None else 99) >= 3:
        score += 10
    score += bant_score * 5
    if ctx.get("industry"):
        score += 5
    if int(ctx.get("recentActivityCount") or 0) == 0:
        score += 10

    if score >= 60:
        return {
            "decision": "nurture_now",
            "score": score,
            "rationale": (
                "Lead still looks viable and engagement has cooled — "
                "send a personalized nudge."
            ),
        }
    return {
        "decision": "wait",
        "score": score,
        "rationale": "Potential lead, but timing is early — check again later.",
        "waitDays": 3 if score >= 45 else 5,
    }


def heuristic_email(ctx: dict[str, Any]) -> dict[str, str]:
    first = ctx.get("firstName") or (ctx.get("displayName") or "there").split(" ")[0]
    company = f" at {ctx['companyName']}" if ctx.get("companyName") else ""
    subject = (
        f"Quick idea for {ctx['companyName']}"
        if ctx.get("companyName")
        else f"Checking in, {first}"
    )
    industry_bit = (
        f" teams in {ctx['industry']}" if ctx.get("industry") else ""
    )
    body = "\n".join(
        [
            f"Hi {first},",
            "",
            f"I wanted to reconnect{company}. We spoke earlier about how we might help"
            f"{industry_bit}, and I thought a short follow-up might be useful.",
            "",
            "Would you have 15 minutes this week for a quick catch-up, or should I "
            "share a brief overview by email?",
            "",
            "Best regards",
        ]
    )
    brief = (
        f"Re-engage {first}"
        + (f" at {ctx['companyName']}" if ctx.get("companyName") else "")
        + ". Warm follow-up referencing their industry and prior interest; "
        "offer a short call or reply if timing works."
    )
    return {
        "brief": brief[:8000],
        "name": f"Nurture — {first}"[:200],
        "goal": "Re-engage cold lead with a personal check-in.",
        "subject": subject,
        "body": body,
    }


async def load_context(state: NurtureState) -> NurtureState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_nurture_context(state["contact_id"])
    return {**state, "context": ctx}


def _has_reachable_phone(ctx: dict[str, Any]) -> bool:
    digits = re.sub(r"\D", "", str(ctx.get("phone") or ""))
    if len(digits) >= 7:
        return True
    for extra in ctx.get("secondaryPhones") or []:
        if len(re.sub(r"\D", "", str(extra))) >= 7:
            return True
    return False


def _has_reachable_email(ctx: dict[str, Any]) -> bool:
    if "@" in str(ctx.get("email") or ""):
        return True
    for extra in ctx.get("secondaryEmails") or []:
        if "@" in str(extra):
            return True
    return False


# Same gate as assignment: below 40 stays in the nurture pool.
LOW_LEAD_SCORE_MAX = 40


def _crm_lead_score(ctx: dict[str, Any]) -> int | None:
    raw = ctx.get("score")
    if raw is None or raw == "":
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def _explicit_do_not_contact(ctx: dict[str, Any]) -> bool:
    if ctx.get("marketingOptOut"):
        return True
    if str(ctx.get("leadStatus") or "").strip().lower() == "disqualified":
        return True
    notes = ctx.get("notes") or ""
    acts = ctx.get("activities") or []
    blob = " ".join(
        [str(notes)] + [f"{a.get('subject', '')} {a.get('body') or ''}" for a in acts]
    )
    return bool(NOT_INTERESTED_RE.search(blob))


def _in_send_cooldown(ctx: dict[str, Any]) -> bool:
    last_sent = ctx.get("lastSentAt")
    ago = _ms_ago(last_sent) if isinstance(last_sent, str) else None
    return ago is not None and ago < SEND_COOLDOWN_MS


def keep_phone_low_score_in_nurture(
    ctx: dict[str, Any], decision: dict[str, Any]
) -> dict[str, Any]:
    """A reachable phone or email and a low CRM score must not end nurture."""
    if decision.get("decision") not in {"skip_not_interested", "skip_guardrail"}:
        return decision
    if not (_has_reachable_phone(ctx) or _has_reachable_email(ctx)):
        return decision
    score = _crm_lead_score(ctx)
    if score is not None and score >= LOW_LEAD_SCORE_MAX:
        return decision
    if _explicit_do_not_contact(ctx) or _in_send_cooldown(ctx):
        return decision
    return {
        "decision": "nurture_now",
        "score": max(int(decision.get("score") or 0), 70),
        "rationale": (
            "Phone or email is on file and the lead score is low — "
            "continue nurture instead of skipping."
        ),
        "waitDays": None,
    }


def _initial_voice_nurture_eligible(ctx: dict[str, Any]) -> bool:
    if not ctx.get("nurtureCallEnabled"):
        return False
    if not _has_reachable_phone(ctx):
        return False
    if ctx.get("lastSentAt"):
        return False
    if ctx.get("marketingOptOut"):
        return False
    if str(ctx.get("ownerUserId") or "").strip():
        return False
    if (ctx.get("contactType") or "lead") != "lead":
        return False
    status = str(ctx.get("leadStatus") or "").strip().lower()
    if status in {"converted", "disqualified"}:
        return False
    return status == "new"


def _decide_user_payload(ctx: dict[str, Any]) -> str:
    has_phone = _has_reachable_phone(ctx)
    has_email = _has_reachable_email(ctx)
    score = ctx.get("score")
    band = ctx.get("band") or ctx.get("nurtureStatus") or "—"
    return "\n".join(
        [
            f"Name: {ctx.get('displayName')}",
            f"Title: {ctx.get('title') or '—'}",
            f"Company: {ctx.get('companyName') or '—'}",
            f"Industry: {ctx.get('industry') or '—'}",
            f"Lead status: {ctx.get('leadStatus') or '—'}",
            f"Lifecycle: {effective_contact_type(ctx.get('contactType'))}",
            f"Lead score: {score if score is not None else '—'} band {band}",
            (
                "Queue: below assign gate — choose nurture_now unless wait/"
                "skip reasons below apply."
            ),
            f"Phone on file: {'yes' if has_phone else 'no'}",
            f"Email on file: {'yes' if has_email else 'no'}",
            (
                "Voice nurture enabled for org: "
                f"{'yes' if ctx.get('nurtureCallEnabled') else 'no'}"
            ),
            (
                "If phone is on file, nurture_now means CRM places the "
                "nurture call (after the org call delay)."
            ),
            (
                f"BANT B/A/N/T: {bool((ctx.get('bant') or {}).get('budget'))}/"
                f"{bool((ctx.get('bant') or {}).get('authority'))}/"
                f"{bool((ctx.get('bant') or {}).get('need'))}/"
                f"{bool((ctx.get('bant') or {}).get('timeline'))}"
            ),
            f"Days since last activity: {ctx.get('daysSinceLastActivity') or 'never'}",
            f"Notes: {(ctx.get('notes') or '—')[:400]}",
            f"Last nurture sent: {ctx.get('lastSentAt') or 'never'}",
        ]
    )


async def decide_via_llm(ctx: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    def _validate(parsed: dict[str, Any]) -> dict[str, Any] | None:
        d = parsed.get("decision")
        if d not in {"nurture_now", "wait", "skip_not_interested"}:
            return None
        try:
            score = max(0, min(100, int(parsed.get("score") or 50)))
        except (TypeError, ValueError):
            score = 50
        return {
            "decision": d,
            "score": score,
            "rationale": str(parsed.get("rationale") or "Model decision")[:280],
            "waitDays": parsed.get("waitDays"),
        }

    return await generate_json_with_retries(
        system=DECIDE_SYSTEM,
        user=_decide_user_payload(ctx),
        max_tokens=1200,
        repair_hint=(
            "Convert into ONLY valid JSON with decision "
            "(nurture_now|wait|skip_not_interested), score, rationale, waitDays."
        ),
        validate=_validate,
    )


async def decide(state: NurtureState) -> NurtureState:
    ctx = state.get("context") or {}
    if not ctx:
        return {
            **state,
            "decision": "skip_guardrail",
            "score": 0,
            "rationale": "contact_not_found",
            "status": "skipped",
            "source": "heuristic",
            "reason": "contact_not_found",
        }

    decision, llm_reason = await decide_via_llm(ctx)
    source = "ai"
    reason: str | None = None
    if decision is None:
        # Prefer wait over inventing nurture/email when LLM is down.
        logger.warning(
            "nurture-lead LLM decide failed after retries; wait contact=%s reason=%s",
            state.get("contact_id"),
            llm_reason,
        )
        guarded = heuristic_decide(ctx)
        if guarded["decision"] in {"skip_not_interested", "skip_guardrail"}:
            decision = guarded
        else:
            decision = {
                "decision": "wait",
                "score": int(guarded.get("score") or 50),
                "rationale": (
                    f"LLM unavailable ({llm_reason or 'unknown'}) — "
                    "keeping prior nurture state; retry later."
                ),
                "waitDays": 1,
            }
        source = "heuristic"
        reason = llm_reason or "llm_failed"

    # Hard guardrails always win (cooldown / not interested / recent activity).
    guarded = heuristic_decide(ctx)
    if guarded["decision"] in {"skip_not_interested", "skip_guardrail"}:
        decision = guarded
        if source == "ai":
            # Safety override — still label as ai path with note, or keep ai if
            # model already agreed; mark heuristic only when we replaced nurture.
            pass
    elif guarded["decision"] == "wait" and decision.get("decision") == "nurture_now":
        if "Recent activity" in (guarded.get("rationale") or ""):
            if not _initial_voice_nurture_eligible(ctx):
                decision = guarded

    decision = keep_phone_low_score_in_nurture(ctx, decision)

    if (
        decision.get("decision") == "wait"
        and _initial_voice_nurture_eligible(ctx)
    ):
        decision = {
            "decision": "nurture_now",
            "score": max(int(decision.get("score") or 50), 70),
            "rationale": (
                "New lead with phone on file — schedule first nurture voice call."
            ),
            "waitDays": None,
        }

    return {
        **state,
        "decision": decision["decision"],
        "score": int(decision.get("score") or 0),
        "rationale": decision.get("rationale") or "",
        "wait_days": decision.get("waitDays"),
        "status": "decided",
        "source": source,
        "reason": reason,
    }


def _clip(text: str | None, limit: int) -> str:
    if not text:
        return "—"
    cleaned = " ".join(str(text).split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1].rstrip() + "…"


def _activity_lines(ctx: dict[str, Any], limit: int = 5) -> list[str]:
    lines: list[str] = []
    for act in (ctx.get("activities") or [])[:limit]:
        if not isinstance(act, dict):
            continue
        body = _clip(act.get("body"), 220)
        lines.append(
            f"- [{act.get('type') or 'activity'}] "
            f"{_clip(act.get('subject'), 120)} ({act.get('createdAt') or '—'})"
            + (f"\n  excerpt: {body}" if body != "—" else "")
        )
    return lines or ["— none recorded —"]


def _compose_user_payload(ctx: dict[str, Any]) -> str:
    enrichment = ctx.get("enrichment") if isinstance(ctx.get("enrichment"), dict) else {}
    custom_fields = (
        ctx.get("customFields") if isinstance(ctx.get("customFields"), dict) else {}
    )
    custom_fields_text = _clip(
        json.dumps(custom_fields, ensure_ascii=False, default=str), 4000
    )
    deals = ctx.get("deals") if isinstance(ctx.get("deals"), list) else []
    deal_lines = [
        f"- {d.get('title') or 'Deal'} ({d.get('stage') or '—'})"
        + (f" · {d.get('amount')}" if d.get("amount") else "")
        for d in deals[:3]
        if isinstance(d, dict)
    ]
    first = ctx.get("firstName") or (ctx.get("displayName") or "there").split(" ")[0]
    return "\n".join(
        [
            f"First name (use in greeting): {first}",
            f"To: {ctx.get('displayName')} <{ctx.get('email')}>",
            f"Title: {ctx.get('title') or '—'}",
            f"Company: {ctx.get('companyName') or '—'}",
            f"Industry: {ctx.get('industry') or '—'}",
            f"Lead status: {ctx.get('leadStatus') or '—'}",
            f"Lead source: {ctx.get('leadSource') or '—'}",
            f"Nurture band: {ctx.get('nurtureStatus') or '—'}",
            (
                f"Score: {ctx.get('score') or '—'} "
                f"(fit {ctx.get('fitScore') or '—'}, intent {ctx.get('intentScore') or '—'}) "
                f"band {ctx.get('band') or '—'}"
            ),
            f"Next best action: {ctx.get('nextBestAction') or '—'}",
            f"Lead headline: {_clip(ctx.get('leadHeadline'), 200)}",
            f"Lead intent: {_clip(ctx.get('leadIntent'), 200)}",
            f"Lead summary: {_clip(ctx.get('leadSummary'), 900)}",
            f"Recommended action: {_clip(ctx.get('recommendedAction'), 200)}",
            f"Contact custom fields/conversation signals: {custom_fields_text}",
            f"Company description: {_clip(enrichment.get('companyDescription'), 400)}",
            f"Company products: {_clip(enrichment.get('products'), 200)}",
            f"Seniority: {enrichment.get('seniorityTier') or '—'}",
            f"Geography: {enrichment.get('geography') or '—'}",
            (
                f"BANT B/A/N/T: {bool((ctx.get('bant') or {}).get('budget'))}/"
                f"{bool((ctx.get('bant') or {}).get('authority'))}/"
                f"{bool((ctx.get('bant') or {}).get('need'))}/"
                f"{bool((ctx.get('bant') or {}).get('timeline'))}"
            ),
            f"Days since last real activity: {ctx.get('daysSinceLastActivity') or 'never'}",
            f"Notes: {_clip(ctx.get('notes'), 400)}",
            f"Last nurture sent: {ctx.get('lastSentAt') or 'never'}",
            "Open deals:",
            *(deal_lines or ["— none —"]),
            "Recent activities (newest first):",
            *_activity_lines(ctx),
        ]
    )


async def compose_via_llm(ctx: dict[str, Any]) -> tuple[dict[str, str] | None, str | None]:
    def _validate(parsed: dict[str, Any]) -> dict[str, str] | None:
        brief = str(parsed.get("brief") or "").strip()
        voice_instruction = str(parsed.get("voiceInstruction") or "").strip()
        subject = str(parsed.get("subject") or "").strip()
        body = str(parsed.get("body") or "").strip()
        if not brief or not voice_instruction or not subject or not body:
            return None
        name = str(parsed.get("name") or "").strip()
        goal = str(parsed.get("goal") or "").strip()
        return {
            "brief": brief[:8000],
            "name": (name or f"Nurture — {ctx.get('firstName') or 'Lead'}")[:200],
            "goal": goal[:400] if goal else "",
            "voice_instruction": voice_instruction[:8000],
            "subject": subject[:180],
            "body": body,
        }

    return await generate_json_with_retries(
        system=COMPOSE_SYSTEM,
        user=_compose_user_payload(ctx),
        max_tokens=1800,
        repair_hint=(
            "Convert into ONLY JSON with brief, name, goal, voiceInstruction, "
            "subject, and body strings."
        ),
        validate=_validate,
    )


async def compose(state: NurtureState) -> NurtureState:
    if state.get("decision") != "nurture_now":
        return state
    ctx = state.get("context") or {}
    email, llm_reason = await compose_via_llm(ctx)
    source = state.get("source") or "ai"
    reason = state.get("reason")
    if email is None:
        # Do not invent nurture email copy — wait and retry later.
        logger.warning(
            "nurture-lead LLM compose failed after retries; wait contact=%s reason=%s",
            state.get("contact_id"),
            llm_reason,
        )
        return {
            **state,
            "decision": "wait",
            "wait_days": 1,
            "rationale": (
                f"LLM compose unavailable ({llm_reason or 'unknown'}) — "
                "not sending heuristic email; retry later."
            ),
            "brief": None,
            "campaign_name": None,
            "goal": None,
            "voice_instruction": None,
            "subject": None,
            "body": None,
            "source": "heuristic",
            "reason": llm_reason or "llm_compose_failed",
            "status": "decided",
        }
    return {
        **state,
        "brief": email["brief"],
        "campaign_name": email.get("name"),
        "goal": email.get("goal") or None,
        "voice_instruction": email["voice_instruction"],
        "subject": email["subject"],
        "body": email["body"],
        "source": source,
        "reason": reason,
    }


def _detail_load_context(
    _before: NurtureState, after: NurtureState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {
        "leadStatus": ctx.get("leadStatus"),
        "daysSinceLastActivity": ctx.get("daysSinceLastActivity"),
    }


def _detail_decide(
    _before: NurtureState, after: NurtureState
) -> dict[str, Any] | None:
    return {"decision": after.get("decision"), "score": after.get("score")}


def _detail_compose(
    _before: NurtureState, after: NurtureState
) -> dict[str, Any] | None:
    return {
        "emailComposed": bool(
            after.get("brief") and after.get("subject") and after.get("body")
        ),
        "voiceInstructionComposed": bool(after.get("voice_instruction")),
    }


_PIPELINE_STEPS = (
    traced_step(
            NURTURE_MODULE_PATH,
            NURTURE_AGENT,
            "load_context",
            "Loading contact context",
            _detail_load_context,
        )(load_context),
    traced_step(
            NURTURE_MODULE_PATH,
            NURTURE_AGENT,
            "decide",
            "Deciding whether to nurture, wait, or skip",
            _detail_decide,
        )(decide),
    traced_step(
            NURTURE_MODULE_PATH,
            NURTURE_AGENT,
            "compose",
            "Composing re-engagement email",
            _detail_compose,
        )(compose),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(contact_id: str, organization_id: str | None = None) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "contact_id": contact_id,
            "organization_id": organization_id,
            "status": "running",
        }
    )
    return {
        "contactId": contact_id,
        "status": result.get("status") or "failed",
        "source": result.get("source") or "heuristic",
        "reason": result.get("reason"),
        "decision": result.get("decision"),
        "score": result.get("score"),
        "rationale": result.get("rationale"),
        "waitDays": result.get("wait_days"),
        "brief": result.get("brief"),
        "campaignName": result.get("campaign_name"),
        "goal": result.get("goal"),
        "voiceInstruction": result.get("voice_instruction"),
        "subject": result.get("subject"),
        "body": result.get("body"),
    }
