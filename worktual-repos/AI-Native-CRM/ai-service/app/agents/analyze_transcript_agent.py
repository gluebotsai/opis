"""Transcript signal extraction via a direct native linear adapter."""

from __future__ import annotations

import json
import re
from typing import Any, TypedDict, Optional

from app.llm import generate_ai_text, is_ai_configured

KEYS = (
    "declined",
    "lost",
    "meetingBooked",
    "discoveryDone",
    "pricingInterest",
    "quoteRequested",
    "negotiating",
    "accepted",
    "paymentConfirmed",
    "budget",
    "authority",
    "need",
    "timeline",
)


class TranscriptState(TypedDict, total=False):
    transcript: str
    cleaned: str
    insights: Optional[dict[str, Any]]
    status: str
    reason: Optional[str]


async def normalize(state: TranscriptState) -> TranscriptState:
    text = re.sub(r"<[^>]+>", " ", state.get("transcript") or "")
    text = re.sub(r"\s+", " ", text).strip()[:6000]
    if len(text) < 12:
        return {
            **state,
            "cleaned": text,
            "status": "skipped",
            "reason": "too_short",
            "insights": None,
        }
    if not is_ai_configured():
        return {
            **state,
            "cleaned": text,
            "status": "failed",
            "reason": "llm_not_configured",
            "insights": None,
        }
    return {**state, "cleaned": text, "status": "running"}


def _detail_phrase(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split()).strip()
    if not text or text.lower() in {"null", "none", "n/a"}:
        return None
    return text[:160]


async def extract(state: TranscriptState) -> TranscriptState:
    if state.get("status") != "running":
        return state
    raw = await generate_ai_text(
        system=(
            "You extract CRM sales signals from a customer message: email, SMS, "
            "chat, call, or meeting transcript. "
            "Return ONLY JSON with boolean fields: declined, lost, meetingBooked, "
            "discoveryDone, pricingInterest, quoteRequested, negotiating, accepted, "
            "paymentConfirmed, budget, authority, need, timeline — plus "
            "budgetDetail, authorityDetail, needDetail, timelineDetail, and "
            '"evidence": array of up to 3 short quotes. '
            "budget is true only when the customer names an amount or range they "
            "can spend or have approved. "
            "authority is true when the customer says who can decide, approve, "
            "sign, or block this purchase — themselves, their role, or another "
            "person they name. Asking to speak with an owner or manager is not "
            "authority. A name, email, or phone number alone is not authority. "
            "need is true when the customer states a problem, a requirement, a "
            "use case, or the product or outcome they want. "
            '"We are looking for a CRM" and "we need to automate customer '
            'queries" are needs. Asking to explain a product, list products, '
            "or book a demo, with no problem or outcome, is not a need. "
            "timeline is true only when the customer states when the project, "
            "purchase, rollout, or go-live must happen. A demo, call, meeting, "
            "or consultation time is not a timeline. "
            '"Tomorrow at 5pm", "day after tomorrow at 11am", and '
            '"October 7 at 5:30 PM" are appointment times, so timeline is '
            "false unless they say that date is the project deadline. "
            "Each detail is copied from this message, or null. "
            "budgetDetail is the amount itself, with currency when they said "
            'it: "50000", "$12,000", "20-25k", "five thousand dollars". '
            "Never write a description such as \"discussed amount\" or "
            "\"budget mentioned\". If you cannot quote the figure, budget is "
            "false and budgetDetail is null. "
            "authorityDetail is who decides. "
            "needDetail is the problem, requirement, or outcome they stated. "
            "timelineDetail is the date or period itself: \"by 30 November\", "
            '"Q1 2027", "within 6 weeks", "end of this quarter". '
            "If timeline is true, timelineDetail is that date or period. "
            "Never put the demo or meeting slot in timelineDetail. "
            "If you cannot quote the date or period, timeline is false and "
            "timelineDetail is null. "
            "If the boolean is false, that detail is null. "
            "Do not invent a figure, name, or date that is not in the message. "
            "Only mark a field true when this message clearly supports it. "
            "Never infer a commercial acceptance from polite interest."
        ),
        user=state["cleaned"],
        max_tokens=1500,
        timeout_ms=30_000,
    )
    if not raw:
        return {**state, "status": "failed", "reason": "llm_empty", "insights": None}
    match = re.search(r"\{[\s\S]*\}", raw)
    if not match:
        return {**state, "status": "failed", "reason": "parse_failed", "insights": None}
    try:
        parsed = json.loads(match.group(0))
        out: dict[str, Any] = {k: parsed.get(k) is True for k in KEYS}
        for flag, detail_key in (
            ("budget", "budgetDetail"),
            ("authority", "authorityDetail"),
            ("need", "needDetail"),
            ("timeline", "timelineDetail"),
        ):
            phrase = _detail_phrase(parsed.get(detail_key))
            # The model sometimes writes the customer's words in the boolean slot.
            if not phrase:
                raw = parsed.get(flag)
                if isinstance(raw, str) and raw.strip().lower() not in {
                    "true",
                    "false",
                    "yes",
                    "no",
                }:
                    phrase = _detail_phrase(raw)
            if phrase:
                out[flag] = True
                out[detail_key] = phrase
            else:
                out[detail_key] = None
        out["evidence"] = [
            e for e in (parsed.get("evidence") or []) if isinstance(e, str)
        ][:3]
        return {**state, "insights": out, "status": "ok", "reason": None}
    except Exception:
        return {**state, "status": "failed", "reason": "parse_failed", "insights": None}


async def run(transcript: str, organization_id: str | None = None) -> dict[str, Any]:
    void = organization_id
    del void
    state = await normalize({"transcript": transcript or "", "status": "running"})
    result = await extract(state)
    ok = result.get("status") == "ok"
    return {"ok": ok, "insights": result.get("insights") if ok else None}
