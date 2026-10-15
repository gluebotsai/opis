"""Post-meeting process agent (LangGraph).

Analyzes a B2B meeting transcript and returns structured decisions including
concrete follow-up ISO datetimes so the CRM can proactively book meetings,
prepare proposals, move stages, etc.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, TypedDict, Optional
from uuid import uuid4
from zoneinfo import ZoneInfo

from app.agents.native_pipeline import run_steps

from app.llm import is_ai_configured
from app.agents.step_trace import traced_step
from app.agents.llm_result import extract_json, generate_json_with_retries

logger = logging.getLogger(__name__)

POST_MEETING_MODULE_PATH = "post-meeting"
POST_MEETING_AGENT = "post_meeting_process"


class PostState(TypedDict, total=False):
    transcript: str
    seller: Optional[dict[str, Any]]
    contact_name: Optional[str]
    heuristic: Optional[dict[str, Any]]
    time_zone: str
    reference_now_iso: Optional[str]
    activity_id: Optional[str]
    contact_id: Optional[str]
    organization_id: Optional[str]
    job_id: str
    cleaned: str
    analysis: Optional[dict[str, Any]]
    actions: list[str]
    status: str
    reason: Optional[str]


SYSTEM = """You analyze a B2B sales meeting transcript for a CRM post-meeting process agent.
Return ONLY valid JSON (no markdown):
{
  "requirementsSufficientForProposal": true/false,
  "wantsProposalDraft": true/false,
  "wantsQuoteDraft": true/false,
  "quoteProductHints": ["product or theme name", ...],
  "pricingCompleteForQuote": true/false,
  "customerBusinessSummary": "real summary of the customer's business/needs (not a raw transcript slice)",
  "requestedThemes": ["theme", ...],
  "wantsAnotherMeeting": true/false,
  "proposedSlot": {
    "raw": "phrase from transcript or null",
    "startIso": "ISO-8601 absolute datetime with offset when a time was agreed, else null",
    "timeZone": "IANA timezone"
  } | null,
  "stageHint": "qualification|discover|propose|negotiate|won|lost"|null,
  "objections": ["..."],
  "nextBestAction": "short string",
  "openQuestions": ["..."],
  "proposalNarrative": "commercial narrative for a proposal draft or null",
  "suggestedDiscountPct": number|null,
  "quoteLines": [
    {"productName":"catalog-like name","quantity":1,"unitPrice":100.0}
  ],
  "actions": ["book_follow_up"|"propose_alternate_slots"|"prepare_proposal"|"move_stage"|"close_lost"|"none"]
}

Rules:
- Use only the transcript + seller context. Do not invent facts.
- If they asked to meet again (e.g. "tomorrow at 3", "next Tuesday 2pm"), set wantsAnotherMeeting=true
  and resolve startIso relative to referenceNowIso + timeZone. Prefer afternoon if am/pm omitted and hour < 8.
- If they want another meeting but no concrete time, wantsAnotherMeeting=true, proposedSlot.startIso=null,
  actions include propose_alternate_slots.
- If a concrete time is agreed and free to book, actions include book_follow_up.
- requirementsSufficientForProposal=true only when commercial scope/requirements are clear enough for a draft proposal.
- wantsProposalDraft mirrors requirementsSufficientForProposal when scope was discussed.
- wantsQuoteDraft=true when pricing/quote/commercial terms were discussed even if unit prices were not agreed.
- quoteProductHints: product names or themes mentioned for catalog matching when wantsQuoteDraft=true.
- pricingCompleteForQuote=true ONLY when the transcript states concrete product/service names with quantities AND unit prices
  (or totals that imply unit price). Never invent prices. If prices are missing, pricingCompleteForQuote=false and quoteLines=[].
- suggestedDiscountPct only when an explicit discount % was discussed; otherwise null.
- stageHint lost only on clear disinterest / chose competitor.
- actions must match the decisions (e.g. prepare_proposal when requirementsSufficientForProposal).
- nextBestAction must NEVER tell anyone to email the customer a proposal/quote automatically.
  CRM drafts proposal/quote for the salesperson; humans send from Sales. Prefer wording like
  "Prepare proposal/quote drafts in CRM for salesperson review" or "Complete pricing on quotation task".
"""


def _extract_json(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.I)
    if fence:
        raw = fence.group(1).strip()
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start >= 0 and end > start:
            try:
                data = json.loads(raw[start : end + 1])
                return data if isinstance(data, dict) else None
            except json.JSONDecodeError:
                return None
        return None


def _as_str_list(val: Any, max_n: int = 20) -> list[str]:
    if not isinstance(val, list):
        return []
    out: list[str] = []
    for item in val:
        if isinstance(item, str) and item.strip():
            out.append(item.strip()[:280])
        if len(out) >= max_n:
            break
    return out


def _sanitize_next_best_action(raw: str) -> str:
    """Never instruct auto-emailing proposal/quote content to the customer."""
    text = (raw or "").strip()
    if not text:
        return "Continue qualification"
    lowered = text.lower()
    if (
        ("proposal" in lowered or "quote" in lowered or "quotation" in lowered)
        and (
            "email" in lowered
            or "send to customer" in lowered
            or "send the customer" in lowered
            or "mail the customer" in lowered
        )
    ):
        return (
            "Prepare CRM proposal/quote drafts for salesperson review "
            "(do not email the customer automatically)"
        )
    return text[:400]


def _normalize_iso(raw: str | None, tz_name: str) -> str | None:
    if not raw or not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        # Handle Z
        if text.endswith("Z"):
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return dt.isoformat()
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            try:
                tz = ZoneInfo(tz_name)
            except Exception:  # noqa: BLE001
                tz = timezone.utc
            dt = dt.replace(tzinfo=tz)
        return dt.isoformat()
    except ValueError:
        return None


def _derive_actions(analysis: dict[str, Any]) -> list[str]:
    actions: list[str] = []
    if analysis.get("stageHint") == "lost":
        actions.append("close_lost")
    if analysis.get("requirementsSufficientForProposal"):
        actions.append("prepare_proposal")
    if analysis.get("wantsAnotherMeeting"):
        slot = analysis.get("proposedSlot") or {}
        if isinstance(slot, dict) and slot.get("startIso"):
            actions.append("book_follow_up")
        else:
            actions.append("propose_alternate_slots")
    if analysis.get("stageHint") in {"discover", "propose", "negotiate"}:
        actions.append("move_stage")
    # Dedupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for a in actions:
        if a not in seen:
            seen.add(a)
            out.append(a)
    return out or ["none"]


async def normalize(state: PostState) -> PostState:
    text = (state.get("transcript") or "").strip()
    if len(text) < 40:
        return {
            **state,
            "cleaned": text,
            "status": "skipped",
            "reason": "too_short",
            "analysis": state.get("heuristic"),
            "actions": ["none"],
        }
    if not is_ai_configured():
        return {
            **state,
            "cleaned": text,
            "status": "failed",
            "reason": "llm_not_configured",
            "analysis": state.get("heuristic"),
            "actions": ["none"],
        }
    return {
        **state,
        "cleaned": text[:12000],
        "status": "running",
    }


async def analyze_node(state: PostState) -> PostState:
    if state.get("status") != "running":
        return state

    tz = state.get("time_zone") or "Asia/Kolkata"
    now_iso = state.get("reference_now_iso") or datetime.now(timezone.utc).isoformat()
    seller = state.get("seller") or {}
    heur = state.get("heuristic") or {}

    user_parts = [
        f"Contact: {state.get('contact_name') or 'unknown'}",
        f"Time zone: {tz}",
        f"Reference now (ISO): {now_iso}",
        f"Seller org: {json.dumps(seller, default=str)[:1500]}",
        f"Heuristic seed (optional): {json.dumps(heur, default=str)[:1500]}",
        "",
        "--- TRANSCRIPT ---",
        state.get("cleaned") or "",
    ]
    parsed, llm_reason = await generate_json_with_retries(
        system=SYSTEM,
        user="\n".join(user_parts),
        max_tokens=1800,
        attempts=2,
        validate=lambda p: p if isinstance(p, dict) else None,
    )
    if not parsed:
        return {
            **state,
            "status": "failed",
            "reason": llm_reason or "llm_empty",
            "analysis": heur or None,
            "actions": ["none"],
        }

    stage = parsed.get("stageHint")
    if stage not in {
        "qualification",
        "discover",
        "propose",
        "negotiate",
        "won",
        "lost",
        None,
    }:
        stage = None

    slot_raw = parsed.get("proposedSlot")
    proposed_slot: dict[str, Any] | None = None
    if isinstance(slot_raw, dict):
        start_iso = _normalize_iso(
            str(slot_raw.get("startIso") or "") or None, tz
        )
        proposed_slot = {
            "raw": (str(slot_raw.get("raw") or "").strip() or None),
            "startIso": start_iso,
            "timeZone": str(slot_raw.get("timeZone") or tz),
        }
        if not proposed_slot["raw"] and not proposed_slot["startIso"]:
            proposed_slot = None

    quote_lines: list[dict[str, Any]] = []
    raw_lines = parsed.get("quoteLines")
    if isinstance(raw_lines, list):
        for item in raw_lines:
            if not isinstance(item, dict):
                continue
            name = str(item.get("productName") or "").strip()
            try:
                qty = float(item.get("quantity"))
                price = float(item.get("unitPrice"))
            except (TypeError, ValueError):
                continue
            if not name or qty <= 0 or price <= 0:
                continue
            quote_lines.append(
                {
                    "productName": name[:200],
                    "quantity": qty,
                    "unitPrice": price,
                    "productId": (
                        str(item.get("productId")).strip()
                        if item.get("productId")
                        else None
                    ),
                }
            )
    discount_raw = parsed.get("suggestedDiscountPct")
    try:
        discount_pct = float(discount_raw) if discount_raw is not None else None
    except (TypeError, ValueError):
        discount_pct = None
    if discount_pct is not None:
        discount_pct = max(0.0, min(100.0, discount_pct))

    pricing_complete = bool(parsed.get("pricingCompleteForQuote")) and bool(
        quote_lines
    )

    wants_proposal = bool(
        parsed.get("wantsProposalDraft")
        if parsed.get("wantsProposalDraft") is not None
        else parsed.get("requirementsSufficientForProposal")
    )
    wants_quote = bool(
        parsed.get("wantsQuoteDraft")
        if parsed.get("wantsQuoteDraft") is not None
        else pricing_complete or wants_proposal
    )
    quote_hints = _as_str_list(parsed.get("quoteProductHints"))

    analysis: dict[str, Any] = {
        "requirementsSufficientForProposal": wants_proposal,
        "wantsProposalDraft": wants_proposal,
        "wantsQuoteDraft": wants_quote,
        "quoteProductHints": quote_hints,
        "pricingCompleteForQuote": pricing_complete,
        "customerBusinessSummary": (
            str(parsed.get("customerBusinessSummary") or "").strip()[:1200]
            or None
        ),
        "requestedThemes": _as_str_list(parsed.get("requestedThemes")),
        "wantsAnotherMeeting": bool(parsed.get("wantsAnotherMeeting")),
        "proposedSlot": proposed_slot,
        "stageHint": stage,
        "objections": _as_str_list(parsed.get("objections")),
        "nextBestAction": _sanitize_next_best_action(
            str(parsed.get("nextBestAction") or "").strip()[:400]
            or "Continue qualification"
        ),
        "openQuestions": _as_str_list(parsed.get("openQuestions")),
        "proposalNarrative": (
            str(parsed.get("proposalNarrative") or "").strip()[:2000] or None
        ),
        "suggestedDiscountPct": discount_pct,
        "quoteLines": quote_lines if pricing_complete else [],
    }

    # Fill thin arrays from heuristic seed
    if isinstance(heur, dict):
        if not analysis["requestedThemes"] and isinstance(
            heur.get("requestedThemes"), list
        ):
            analysis["requestedThemes"] = _as_str_list(heur.get("requestedThemes"))
        if not analysis["objections"] and isinstance(heur.get("objections"), list):
            analysis["objections"] = _as_str_list(heur.get("objections"))
        if not analysis["openQuestions"] and isinstance(
            heur.get("openQuestions"), list
        ):
            analysis["openQuestions"] = _as_str_list(heur.get("openQuestions"))
        if not analysis["customerBusinessSummary"] and isinstance(
            heur.get("customerBusinessSummary"), str
        ):
            analysis["customerBusinessSummary"] = heur["customerBusinessSummary"][
                :1200
            ]

    actions_raw = parsed.get("actions")
    if isinstance(actions_raw, list) and actions_raw:
        allowed = {
            "book_follow_up",
            "propose_alternate_slots",
            "prepare_proposal",
            "move_stage",
            "close_lost",
            "none",
        }
        actions = [
            str(a)
            for a in actions_raw
            if str(a) in allowed
        ]
        if not actions:
            actions = _derive_actions(analysis)
    else:
        actions = _derive_actions(analysis)

    return {
        **state,
        "analysis": analysis,
        "actions": actions,
        "status": "ok",
        "reason": None,
    }


def _detail_normalize(_before: PostState, after: PostState) -> dict[str, Any] | None:
    return {"transcriptChars": len(after.get("cleaned") or "")}


def _detail_analyze(_before: PostState, after: PostState) -> dict[str, Any] | None:
    analysis = after.get("analysis") or {}
    return {
        "stageHint": analysis.get("stageHint"),
        "wantsAnotherMeeting": bool(analysis.get("wantsAnotherMeeting")),
        "actions": after.get("actions"),
    }


_PIPELINE_STEPS = (
    traced_step(
            POST_MEETING_MODULE_PATH,
            POST_MEETING_AGENT,
            "normalize",
            "Preparing the transcript",
            _detail_normalize,
            id_field="activity_id",
            job_id_field="job_id",
        )(normalize),
    traced_step(
            POST_MEETING_MODULE_PATH,
            POST_MEETING_AGENT,
            "analyze",
            "Analyzing follow-ups & next steps",
            _detail_analyze,
            id_field="activity_id",
            job_id_field="job_id",
        )(analyze_node),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    transcript: str,
    seller: dict[str, Any] | None = None,
    contactName: str | None = None,
    heuristic: dict[str, Any] | None = None,
    organization_id: str | None = None,
    timeZone: str | None = None,
    referenceNowIso: str | None = None,
    activityId: str | None = None,
    contactId: str | None = None,
) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "transcript": transcript or "",
            "seller": seller,
            "contact_name": contactName,
            "heuristic": heuristic,
            "time_zone": timeZone or "Asia/Kolkata",
            "reference_now_iso": referenceNowIso,
            "activity_id": activityId,
            "contact_id": contactId,
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "status": "running",
        }
    )
    analysis = result.get("analysis")
    return {
        "ok": result.get("status") == "ok",
        "analysis": analysis,
        "actions": result.get("actions") or ["none"],
        "reason": result.get("reason"),
    }
