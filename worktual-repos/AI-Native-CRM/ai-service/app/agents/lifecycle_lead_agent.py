"""
Lead Lifecycle Agent (LangGraph).

Primary path: LLM returns structured elevation JSON.
Heuristic decide_lifecycle_heuristic is offline fallback only.
High-risk actions get an extra LLM confirm gate.
"""

from __future__ import annotations

import json
import logging
from typing import Any, TypedDict, Optional

from app.agents.native_pipeline import run_steps

from app.agents.llm_result import (
    extract_json,
    generate_json_with_retries,
    label_ai,
    label_fallback,
    sectioned_system_prompt,
)
from app.agents.crm_tools import effective_contact_type
from app.agents.step_trace import traced_step
from app.crm_client import CrmClient
from app.llm import generate_ai_text, is_ai_configured

logger = logging.getLogger(__name__)

LIFECYCLE_MODULE_PATH = "lifecycle"
LIFECYCLE_AGENT = "lead_lifecycle"

PIPELINE_ORDER = ["qualification", "discover", "propose", "negotiate"]
HIGH_RISK = {
    "quote_send",
    "quote_accept",
    "close_won",
    "close_lost",
    "disqualify",
}


class LifecycleState(TypedDict, total=False):
    contact_id: str
    organization_id: Optional[str]
    context: dict[str, Any]
    decision: dict[str, Any]
    status: str
    source: str
    reason: Optional[str]
    persist_result: dict[str, Any]


LIFECYCLE_SYSTEM = sectioned_system_prompt(
    role=(
        "You are the CRM lead qualification agent for Worktual. You read BANT "
        "and the customer's behaviour across every touchpoint, then set the "
        "lead status that evidence supports."
    ),
    goal=(
        "When BANT and the touchpoints show a valid lead, set lead status to "
        "qualified in this run. Do not wait, and do not stop on contacted or "
        "qualifying, just because that is the next rung. Wait only when the "
        "evidence does not support qualified, disqualify, or another concrete move."
    ),
    instructions=(
        "- Use the BANT flags and the customer's own phrases, the omnichannel summary, recent touchpoints, score, signals, and meetingAnalysis.\n"
        "- Judge the whole picture: email, web chat, call, WhatsApp, and other channels in the summary and touchpoints, plus any open deal behaviour.\n"
        "- A valid lead may jump from new, contacted, or qualifying straight to qualified. Say which touchpoint or BANT phrase supports it.\n"
        "- Do not wait to move from qualifying to qualified when that evidence is already enough.\n"
        "- Do not invent meetings, quotes, BANT, or engagement the customer did not state.\n"
        "- Do NOT use raw transcripts — use the supplied summary, touchpoints, BANT phrases, and meetingAnalysis.\n"
        "- Lead status values: new, contacted, qualifying, qualified, or disqualify.\n"
        "- If the lead is already qualified and the same evidence shows a real opportunity, convert to a deal.\n"
        "- If lifecycleLastAction is manual_edit and newer than the last agent apply, wait or skip — do not overwrite a human stage.\n"
        "- Pipeline, once a deal exists: qualification → discover → propose → negotiate (plus quote_draft / quote_send / close).\n"
        "- Return one action. The target is the stage the evidence supports.\n"
        "- Neutral meetingAnalysis must NOT block lead_status or convert; flag only for pipeline/high-risk.\n"
        "- High-risk kinds (quote_send, quote_accept, close_won, close_lost, disqualify) "
        "need explicit timeline evidence."
    ),
    context="Runtime context is in the user message.",
    output=(
        "Return ONLY valid JSON (no markdown):\n"
        "{\n"
        '  "action": {"kind": "<wait|skip|flag_for_review|lead_status|convert|deal_stage|quote_draft|quote_send|'
        'quote_accept|close_won|close_lost|disqualify>", '
        '"to"?: "<stage>", "waitHours"?: <int>, "reason"?: "<str>"},\n'
        '  "ladder": "none"|"lead_status"|"lifecycle"|"pipeline",\n'
        '  "from": "<stage or null>",\n'
        '  "to": "<stage or null>",\n'
        '  "reason": "<1-2 sentences citing the BANT phrase or touchpoint>"\n'
        "}\n"
        'Note: "ladder" describes which ladder moved (pipeline = the deal stage ladder), but '
        '"action.kind" for a pipeline move must be "deal_stage" — never "pipeline".'
    ),
    guardrails=(
        "- Never invent IDs, deals, or quotes.\n"
        "- If contact is archived/inactive/churned → skip.\n"
        "- A missing meeting transcript does not block qualified when BANT or other touchpoints already support it.\n"
        "- Ambiguous meetingAnalysis blocks pipeline/high-risk only — not lead_status/convert.\n"
        "- Never overwrite a newer manual_edit lead status or lifecycle stage."
    ),
)


_ACTION_KINDS = {
    "wait",
    "skip",
    "flag_for_review",
    "lead_status",
    "convert",
    "deal_stage",
    "quote_draft",
    "quote_send",
    "quote_accept",
    "close_won",
    "close_lost",
    "disqualify",
}


def decision_for_persist(
    decision: dict[str, Any],
    *,
    source: str,
    fallback_reason: str | None = None,
) -> dict[str, Any]:
    """Keep the domain explanation on persist; provenance stays on agent state.

    ``label_ai`` / ``label_fallback`` reuse the key ``reason`` for LLM
    provenance (``llm_failed``, ``commercial_win_db``). Lifecycle decisions
    also use ``reason`` as the 1–2 sentence explanation shown in timeline
    notes and in-app notifications. Strip only ``source`` from the persist
    payload and restore the domain explanation — same pattern as invoice
    escalation, expansion matcher, and forecast audit.
    """
    domain_reason = str(decision.get("reason") or "").strip()
    tagged = (
        label_ai(decision)
        if source == "ai"
        else label_fallback(decision, fallback_reason or "llm_failed")
    )
    out = {k: v for k, v in tagged.items() if k != "source"}
    if domain_reason:
        out["reason"] = domain_reason
    return out


def _normalize_llm_decision(parsed: dict[str, Any]) -> dict[str, Any] | None:
    action = parsed.get("action")
    if not isinstance(action, dict):
        kind = str(parsed.get("kind") or "").strip()
        # Models occasionally echo the ladder name ("pipeline") instead of the
        # actual action kind ("deal_stage") — remap defensively so a stage move
        # doesn't silently no-op in the TS apply switch.
        if kind == "pipeline":
            kind = "deal_stage"
        if kind in _ACTION_KINDS:
            action = {"kind": kind}
            if parsed.get("to"):
                action["to"] = parsed["to"]
            if parsed.get("waitHours") is not None:
                action["waitHours"] = parsed["waitHours"]
        else:
            return None
    kind = str(action.get("kind") or "").strip()
    if kind == "pipeline":
        kind = "deal_stage"
        action = {**action, "kind": kind}
    if kind not in _ACTION_KINDS:
        return None
    if kind == "wait":
        hours = action.get("waitHours")
        try:
            hours = max(1, min(72, int(hours if hours is not None else 24)))
        except (TypeError, ValueError):
            hours = 24
        reason = str(parsed.get("reason") or action.get("reason") or "Waiting.")[:280]
        return _wait(hours, reason)
    if kind == "skip":
        reason = str(parsed.get("reason") or action.get("reason") or "Skip.")[:280]
        return _skip(reason)
    if kind == "flag_for_review":
        reason = str(
            parsed.get("reason") or action.get("reason") or "Needs human review."
        )[:280]
        return {
            "action": {"kind": "flag_for_review", "reason": reason},
            "ladder": "none",
            "from": parsed.get("from"),
            "to": parsed.get("to"),
            "reason": reason,
        }

    ladder = str(parsed.get("ladder") or "none")
    if ladder not in {"none", "lead_status", "lifecycle", "pipeline"}:
        ladder = "lead_status" if kind == "lead_status" else "pipeline"
    out: dict[str, Any] = {
        "action": {"kind": kind},
        "ladder": ladder,
        "from": parsed.get("from"),
        "to": parsed.get("to") or action.get("to"),
        "reason": str(parsed.get("reason") or action.get("reason") or "Model decision")[
            :280
        ],
    }
    if action.get("to"):
        out["action"]["to"] = action["to"]
    if action.get("reason"):
        out["action"]["reason"] = action["reason"]
    return out


def _bant_line(flag: object, detail: object) -> str:
    phrase = str(detail or "").strip()
    state = "confirmed" if flag else "not confirmed"
    return f"{state} — {phrase}" if phrase else state


def _context_user_payload(ctx: dict[str, Any]) -> str:
    s = ctx.get("signals") or {}
    signal_names = [
        k for k, v in s.items() if k not in {"evidence", "signalAt"} and v is True
    ]
    deal = ctx.get("deal") or {}
    meeting = ctx.get("meetingAnalysis") or {}
    bant = ctx.get("bant") if isinstance(ctx.get("bant"), dict) else {}
    touchpoints = ctx.get("touchpoints") if isinstance(ctx.get("touchpoints"), list) else []
    touchpoint_text = "\n".join(f"- {line}" for line in touchpoints[:8]) or "none"
    lines = [
        f"Contact: {ctx.get('displayName')}",
        f"Active: contactStatus={ctx.get('contactStatus')} lifecycle={effective_contact_type(ctx.get('contactType'))}",
        f"Lead status: {ctx.get('leadStatus')}",
        f"Sales ready: {ctx.get('salesReady')}",
        f"Score: {ctx.get('score')}",
        f"Owner: {ctx.get('ownerUserId') or 'none'}",
        f"Company: {ctx.get('companyName') or '—'} country={ctx.get('country') or '—'}",
        f"BANT budget: {_bant_line(bant.get('budget'), bant.get('budgetDetail'))}",
        f"BANT authority: {_bant_line(bant.get('authority'), bant.get('authorityDetail'))}",
        f"BANT need: {_bant_line(bant.get('need'), bant.get('needDetail'))}",
        f"BANT timeline: {_bant_line(bant.get('timeline'), bant.get('timelineDetail'))}",
        f"Omnichannel summary: {ctx.get('omniChannelSummary') or 'none'}",
        f"Recent touchpoints:\n{touchpoint_text}",
        f"Outbound touches: {ctx.get('outboundTouches')} inbound replies: {ctx.get('inboundReplies')}",
        f"Deal stage: {deal.get('stage') if isinstance(deal, dict) else 'none'}",
        f"Missing meeting capture: {ctx.get('missingMeetingCapture')}",
        f"Meeting analysis: {json.dumps(meeting) if meeting else 'none'}",
        f"Lifecycle last action: {ctx.get('lifecycleLastAction') or 'none'} at {ctx.get('lifecycleLastRunAt') or '—'}",
        f"Signals true: {', '.join(signal_names) or 'none'}",
        f"Evidence: {' | '.join((s.get('evidence') or [])[:6]) or 'none'}",
        f"Quotes summary: {json.dumps((deal.get('quotes') if isinstance(deal, dict) else None) or [])[:800]}",
    ]
    return "\n".join(lines)


async def decide_via_llm(ctx: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    return await generate_json_with_retries(
        system=LIFECYCLE_SYSTEM,
        user=_context_user_payload(ctx),
        max_tokens=1500,
        repair_hint=(
            "Convert into ONLY valid lifecycle decision JSON with keys "
            "action, ladder, from, to, reason. No markdown."
        ),
        validate=_normalize_llm_decision,
    )


def _wait(hours: int, reason: str) -> dict[str, Any]:
    return {
        "action": {"kind": "wait", "waitHours": hours},
        "ladder": "none",
        "from": None,
        "to": None,
        "reason": reason,
    }


def _skip(reason: str) -> dict[str, Any]:
    return {
        "action": {"kind": "skip", "reason": reason},
        "ladder": "none",
        "from": None,
        "to": None,
        "reason": reason,
    }


def _after(signal_at: str | None, reference: str | None) -> bool:
    if not signal_at:
        return False
    if not reference:
        return True
    try:
        return signal_at >= reference
    except Exception:
        return True


def _evidence(ctx: dict[str, Any], fallback: str) -> str:
    evidence = (ctx.get("signals") or {}).get("evidence") or []
    top = ", ".join(evidence[:2])
    return f"{fallback} — {top}" if top else fallback


def decide_lead_status(ctx: dict[str, Any]) -> dict[str, Any] | None:
    status = ctx.get("leadStatus") or "new"
    s = ctx.get("signals") or {}
    if status in {"disqualified", "converted"}:
        return None
    reached_out = int(ctx.get("outboundTouches") or 0) > 0
    if reached_out and (s.get("declined") or s.get("lost")):
        return {
            "action": {
                "kind": "disqualify",
                "reason": "Lost to another option" if s.get("lost") else "Not interested",
            },
            "ladder": "lead_status",
            "from": status,
            "to": "disqualified",
            "reason": _evidence(ctx, "Explicit decline on the timeline"),
        }
    if status == "new":
        customer_engaged = bool(s.get("inboundReply")) and (
            bool(s.get("meetingHeld")) or bool(s.get("meetingBooked"))
        )
        # Completed demo with CRM transcript → jump to qualifying in one step.
        if s.get("meetingHeld") and (
            s.get("inboundReply") or reached_out or s.get("meetingBooked")
        ):
            return {
                "action": {"kind": "lead_status", "to": "qualifying"},
                "ladder": "lead_status",
                "from": status,
                "to": "qualifying",
                "reason": _evidence(
                    ctx,
                    "Demo/meeting held with conversation evidence — entering qualification",
                ),
            }
        if reached_out or customer_engaged:
            if reached_out:
                touches = int(ctx.get("outboundTouches") or 0)
                why = (
                    f"First outreach logged ({touches} outbound touch"
                    f"{'' if touches == 1 else 'es'})."
                )
            else:
                why = _evidence(
                    ctx, "Customer-initiated engagement (inbound + meeting)"
                )
            return {
                "action": {"kind": "lead_status", "to": "contacted"},
                "ladder": "lead_status",
                "from": status,
                "to": "contacted",
                "reason": why,
            }
        return _wait(12, "No outreach or customer meeting engagement yet.")
    if status == "contacted":
        engaged = (
            s.get("inboundReply")
            or s.get("meetingHeld")
            or int(ctx.get("outboundTouches") or 0)
            + int(ctx.get("inboundReplies") or 0)
            >= 3
        )
        if engaged:
            return {
                "action": {"kind": "lead_status", "to": "qualifying"},
                "ladder": "lead_status",
                "from": status,
                "to": "qualifying",
                "reason": _evidence(ctx, "Lead is engaging — moving into qualification"),
            }
        return _wait(24, "Contacted but no response yet.")
    if status == "qualifying":
        intent_ready = s.get("quoteRequested") or s.get("pricingInterest")
        engaged = (
            s.get("inboundReply")
            or s.get("meetingHeld")
            or s.get("meetingBooked")
        )
        if ctx.get("salesReady") or intent_ready or engaged:
            why = (
                "Lead score is sales-ready"
                if ctx.get("salesReady")
                else (
                    "Buying intent expressed"
                    if intent_ready
                    else "Customer engagement on the timeline"
                )
            )
            return {
                "action": {"kind": "lead_status", "to": "qualified"},
                "ladder": "lead_status",
                "from": status,
                "to": "qualified",
                "reason": _evidence(ctx, why),
            }
        return _wait(
            24,
            "Qualifying — waiting on engagement, intent, or sales-ready score.",
        )
    return None


def decide_convert(ctx: dict[str, Any]) -> dict[str, Any] | None:
    if ctx.get("leadStatus") != "qualified":
        return None
    if effective_contact_type(ctx.get("contactType")) != "lead":
        return None
    if ctx.get("businessType") == "b2c":
        return _skip("B2C sells through Commerce — no deal conversion.")
    deal = ctx.get("deal")
    if deal and not deal.get("closed"):
        return None
    return {
        "action": {"kind": "convert"},
        "ladder": "lifecycle",
        "from": "lead",
        "to": "prospect",
        "reason": _evidence(ctx, "Qualified lead — opening an opportunity"),
    }


def decide_pipeline(ctx: dict[str, Any]) -> dict[str, Any] | None:
    deal = ctx.get("deal")
    if not deal or deal.get("closed"):
        return None
    if ctx.get("businessType") == "b2c":
        return None
    s = ctx.get("signals") or {}
    stage = deal.get("stage")
    if stage not in PIPELINE_ORDER:
        return None
    if s.get("lost"):
        return {
            "action": {"kind": "close_lost", "reason": "Customer chose another option"},
            "ladder": "pipeline",
            "from": stage,
            "to": "closed_lost",
            "reason": _evidence(ctx, "Explicit loss signal"),
        }
    quotes = deal.get("quotes") or []
    accepted = next((q for q in quotes if q.get("status") == "accepted"), None)
    sent = next((q for q in quotes if q.get("status") == "sent"), None)
    draft = next((q for q in quotes if q.get("status") == "draft"), None)
    if accepted or s.get("paymentConfirmed") or deal.get("hasPaidInvoice"):
        return {
            "action": {"kind": "close_won"},
            "ladder": "pipeline",
            "from": stage,
            "to": "closed_won",
            "reason": _evidence(
                ctx,
                f"Quote {accepted['number']} accepted"
                if accepted
                else (
                    "Invoice paid on the deal"
                    if deal.get("hasPaidInvoice")
                    else "Payment confirmed"
                ),
            ),
        }
    signal_at = s.get("signalAt") or {}
    if sent and s.get("accepted") and _after(signal_at.get("accepted"), sent.get("sentAt")):
        return {
            "action": {"kind": "quote_accept", "quoteId": sent["id"]},
            "ladder": "pipeline",
            "from": stage,
            "to": "quote_accepted",
            "reason": _evidence(ctx, f"Customer accepted quote {sent.get('number')}"),
        }
    if draft and s.get("quoteRequested") and float(draft.get("total") or 0) > 0:
        return {
            "action": {"kind": "quote_send", "quoteId": draft["id"]},
            "ladder": "pipeline",
            "from": stage,
            "to": "quote_sent",
            "reason": _evidence(ctx, f"Customer asked for quote {draft.get('number')}"),
        }
    if stage == "qualification":
        # Transcript / discovery evidence — calendar row alone is not enough.
        if s.get("meetingHeld") or s.get("discoveryDone"):
            return {
                "action": {"kind": "deal_stage", "to": "discover"},
                "ladder": "pipeline",
                "from": stage,
                "to": "discover",
                "reason": _evidence(ctx, "Discovery conversation happened"),
            }
        if int(ctx.get("meetings") or 0) > 0:
            return _wait(
                12,
                "Meeting on the timeline — waiting for transcript or discovery notes before Discover.",
            )
        return _wait(24, "Deal opened — waiting on a discovery conversation.")
    if stage == "discover":
        if s.get("pricingInterest") or s.get("quoteRequested"):
            return {
                "action": {"kind": "deal_stage", "to": "propose"},
                "ladder": "pipeline",
                "from": stage,
                "to": "propose",
                "reason": _evidence(ctx, "Pricing discussion started"),
            }
        return _wait(24, "Discovery in progress — no pricing signal yet.")
    if stage == "propose":
        if sent or s.get("negotiating"):
            return {
                "action": {"kind": "deal_stage", "to": "negotiate"},
                "ladder": "pipeline",
                "from": stage,
                "to": "negotiate",
                "reason": _evidence(
                    ctx,
                    f"Quote {sent.get('number')} is with the customer"
                    if sent
                    else "Terms under discussion",
                ),
            }
        if not quotes:
            return {
                "action": {"kind": "quote_draft"},
                "ladder": "pipeline",
                "from": stage,
                "to": "quote_draft",
                "reason": _evidence(ctx, "Proposal stage with no quote yet"),
            }
        return _wait(24, "Quote drafted — waiting for a send signal.")
    return _wait(24, "Negotiating — waiting for acceptance or loss.")


def decide_lifecycle_heuristic(ctx: dict[str, Any]) -> dict[str, Any]:
    if ctx.get("contactStatus") in {"archived", "inactive"}:
        return _skip("Contact is not active.")
    if effective_contact_type(ctx.get("contactType")) == "churned":
        return _skip("Churned contacts are managed manually.")

    signals = ctx.get("signals") or {}
    if ctx.get("missingMeetingCapture") and not signals.get("meetingHeld"):
        return _wait(
            12,
            "Meeting ended without a transcript — admit Worktual Notetaker bot next time, "
            "or attach notes. Auto-advance waits for conversation evidence.",
        )

    return (
        decide_lead_status(ctx)
        or decide_convert(ctx)
        or decide_pipeline(ctx)
        or _wait(24, "No elevation signal on the timeline.")
    )


async def confirm_high_risk(ctx: dict[str, Any], decision: dict[str, Any]) -> dict[str, Any]:
    action = (decision.get("action") or {}).get("kind")
    if action not in HIGH_RISK:
        return decision
    if not is_ai_configured():
        return decision
    s = ctx.get("signals") or {}
    signal_names = [
        k for k, v in s.items() if k not in {"evidence", "signalAt"} and v is True
    ]
    raw = await generate_ai_text(
        system=sectioned_system_prompt(
            role="You audit a CRM automation before it commits a commercial action.",
            goal="Approve only when the timeline clearly and explicitly supports the action.",
            instructions=(
                "Reject polite interest, assumptions, or ambiguity. "
                "Return approve=false when evidence is thin."
            ),
            output='Return ONLY JSON: {"approve":true|false,"why":"short"}',
            guardrails="Do not invent timeline facts.",
        ),
        user="\n".join(
            [
                f"Proposed action: {action} ({decision.get('from') or '—'} -> {decision.get('to') or '—'})",
                f"Rule reason: {decision.get('reason')}",
                f"Contact: {ctx.get('displayName')}",
                f"Lead status: {ctx.get('leadStatus') or '—'} | Lifecycle: {effective_contact_type(ctx.get('contactType'))}",
                f"Deal stage: {(ctx.get('deal') or {}).get('stage') or 'none'}",
                f"Signals: {', '.join(signal_names) or 'none'}",
                f"Evidence: {' | '.join((s.get('evidence') or [])[:5]) or 'none'}",
            ]
        ),
        max_tokens=160,
        timeout_ms=10_000,
    )
    if not raw:
        return decision
    parsed = extract_json(raw)
    if not parsed:
        return decision
    try:
        if parsed.get("approve") is False:
            why = str(parsed.get("why") or "insufficient evidence")[:160]
            return _wait(12, f"AI review held back {action}: {why}")
    except Exception:
        return decision
    return decision


async def load_context(state: LifecycleState) -> LifecycleState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_lifecycle_context(state["contact_id"])
    return {**state, "context": ctx}


async def decide(state: LifecycleState) -> LifecycleState:
    ctx = state.get("context") or {}
    if not ctx:
        return {
            **state,
            "decision": _skip("contact_not_found"),
            "status": "skipped",
            "source": "heuristic",
            "reason": "contact_not_found",
        }

    # CRM already has accepted quote / paid invoice — never ask LLM for quote_send.
    heuristic_first = decide_lifecycle_heuristic(ctx)
    if (heuristic_first.get("action") or {}).get("kind") == "close_won":
        return {
            **state,
            "decision": decision_for_persist(
                heuristic_first,
                source="heuristic",
                fallback_reason="commercial_win_db",
            ),
            "status": "decided",
            "source": "heuristic",
            "reason": "commercial_win_db",
        }

    decision, llm_reason = await decide_via_llm(ctx)
    source = "ai"
    reason: str | None = None
    if decision is None:
        # Keep CRM state unchanged — wait and retry later (no stage heuristic).
        logger.warning(
            "lifecycle-lead LLM unavailable after retries; waiting contact=%s reason=%s",
            state.get("contact_id"),
            llm_reason,
        )
        decision = _wait(
            6,
            f"LLM unavailable ({llm_reason or 'unknown'}) — keeping current stage; retry later.",
        )
        source = "heuristic"
        reason = llm_reason or "llm_failed"

    decision = await confirm_high_risk(ctx, decision)
    # On convert, resolve regional owner via the Python assignment agent.
    if (decision.get("action") or {}).get("kind") == "convert" and not ctx.get(
        "ownerUserId"
    ):
        from app.agents import assign_sales_agent

        deal = ctx.get("deal") or {}
        amount = deal.get("amount") if isinstance(deal, dict) else None
        try:
            estimated = float(amount) if amount is not None else None
        except (TypeError, ValueError):
            estimated = None
        assign = await assign_sales_agent.run(
            organization_id=state.get("organization_id") or ctx.get("organizationId"),
            business_type=ctx.get("businessType"),
            country=ctx.get("country"),
            city=ctx.get("city"),
            contact_id=state.get("contact_id") or ctx.get("contactId"),
            company_id=ctx.get("companyId"),
            estimated_amount=estimated,
        )
        owner = (assign or {}).get("owner")
        if owner:
            decision = {
                **decision,
                "ownerUserId": owner.get("userId"),
                "assignment": owner,
            }
    return {
        **state,
        "decision": decision_for_persist(
            decision, source=source, fallback_reason=reason
        ),
        "status": "decided",
        "source": source,
        "reason": reason,
    }


async def persist(state: LifecycleState) -> LifecycleState:
    client = CrmClient(state.get("organization_id"))
    result = await client.persist_lifecycle(
        state["contact_id"],
        {
            "contactId": state["contact_id"],
            "decision": state.get("decision"),
        },
    )
    return {
        **state,
        "persist_result": result,
        "status": result.get("status") or state.get("status"),
    }


def _detail_load_context(
    _before: LifecycleState, after: LifecycleState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {"leadStatus": ctx.get("leadStatus"), "hasDeal": bool(ctx.get("deal"))}


def _detail_decide(
    _before: LifecycleState, after: LifecycleState
) -> dict[str, Any] | None:
    decision = after.get("decision") or {}
    action = decision.get("action") or {}
    return {
        "action": action.get("kind"),
        "ladder": decision.get("ladder"),
        "from": decision.get("from"),
        "to": decision.get("to"),
        "reason": decision.get("reason"),
    }


def _detail_persist(
    _before: LifecycleState, after: LifecycleState
) -> dict[str, Any] | None:
    result = after.get("persist_result") or {}
    return {"status": result.get("status") or after.get("status")}


_PIPELINE_STEPS = (
    traced_step(
            LIFECYCLE_MODULE_PATH,
            LIFECYCLE_AGENT,
            "load_context",
            "Loading contact & deal context",
            _detail_load_context,
        )(load_context),
    traced_step(
            LIFECYCLE_MODULE_PATH,
            LIFECYCLE_AGENT,
            "decide",
            "Deciding the next lifecycle move",
            _detail_decide,
        )(decide),
    traced_step(
            LIFECYCLE_MODULE_PATH,
            LIFECYCLE_AGENT,
            "persist",
            "Applying the lifecycle move",
            _detail_persist,
        )(persist),
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
        "persistResult": result.get("persist_result"),
    }
