"""Minutes of Meeting agent — transcript analysis plus customer-facing MOM email."""

from __future__ import annotations

from typing import Any, TypedDict, Optional
from uuid import uuid4
import re

from app.agents.native_pipeline import run_steps

from app.llm import is_ai_configured
from app.agents.llm_result import generate_json_with_retries, sectioned_system_prompt
from app.agents.meeting_mom_html import (
    CUSTOMER_MOM_HTML_MAX,
    INTERNAL_MOM_HTML_MAX,
    normalize_customer_mom,
    normalize_internal_mom,
    render_customer_mom_html,
    render_internal_mom_html,
)
from app.agents.meeting_mom_postprocess import clean_transcript, postprocess_mom
from app.agents.step_trace import traced_step

MEETING_MOM_MODULE_PATH = "meeting-mom"
MEETING_MOM_AGENT = "meeting_mom"

LIST_KEYS = (
    "discussionTopics",
    "keyDetails",
    "decisions",
    "commitments",
    "objections",
    "openQuestions",
    "risks",
    "painPoints",
    "evaluationCriteria",
)

STRUCTURED_LIST_KEYS = ("actionItems", "nextSteps")

CUSTOMER_EMAIL_JSON = """{
  "subject": "Minutes of Meeting — <topic>",
  "title": "Minutes of Meeting — Product Demonstration",
  "subtitle": "optional; date · seller & client session is filled from CRM when omitted",
  "participants": [{"name":"...","role":"...","organization":"..."}],
  "objective": "1-3 sentence meeting objective, customer-safe",
  "sections": [
    {
      "heading": "Business Requirement Discussion",
      "description": "optional one-line product summary, else empty",
      "bullets": ["customer-safe point from the transcript"]
    }
  ],
  "nextStepsWorktual": ["what our team will do"],
  "nextStepsClient": ["what the client team will do"],
  "actionItems": [{"action":"...","owner":"Worktual Team|Client Team|name","dueDate":"date or empty"}],
  "closing": "short thank-you"
}"""

SYSTEM = sectioned_system_prompt(
    role=(
        "You write Minutes of Meeting from a CRM sales call transcript: a detailed "
        "internal record and a customer-safe follow-up. A renderer turns customerEmail "
        "into HTML — do not output HTML."
    ),
    goal=(
        "Capture what was discussed, decided, and owed, then produce a polished "
        "customer MOM the client can share internally."
    ),
    instructions=(
        "- Be thorough for internal fields; do not invent facts, numbers, products, "
        "or dates.\n"
        "- Prefer concrete bullets. If something is unclear, use openQuestions.\n"
        "- Arrays may be empty. Omit customerEmail section fields that have no evidence "
        "so the renderer can hide them.\n"
        "- customerEmail is sent to the customer. Include only mutually appropriate "
        "discussion, product points that were actually demoed, decisions, next steps, "
        "and action items.\n"
        "- Do not expose sentiment, deal risks, objections analysis, CRM links, "
        "transcript excerpts, lead scores, pipeline, or internal sales notes in "
        "customerEmail.\n"
        "- Numbered section headings should not include the number (the renderer adds 1. 2. 3.).\n"
        "- Use description + bullets when a named product was demoed; use bullets only "
        "for open discussion (e.g. business requirements).\n"
        "- Do not invent due dates; leave dueDate empty when none was stated. "
        "If the customer or rep names a relative deadline (e.g. by Friday, within "
        "two business days), put it in followUpBy.\n"
        "- Do not invent attendees who were not named. Use canonical participant "
        "names from context — not raw transcript speaker labels when they differ.\n"
        "- actionItems must be objects {action, owner, dueDate} — never transcript "
        "quotes. Each action is one imperative task (e.g. Send proposal to <contact>).\n"
        "- nextSteps must be short actionable recommendations, not conversation "
        "fragments.\n"
        "- nextBestAction is the single highest-priority follow-up (e.g. Prepare "
        "and send proposal).\n"
        "- Set proposalRequested true when the customer asks for a proposal, quote, "
        "pricing document, or formal offer.\n"
        "- Capture buyingIntent, currentSolution, painPoints, and evaluationCriteria "
        "when the customer compares vendors, states a need to buy, or describes "
        "their incumbent tool."
    ),
    context=(
        "Transcript, canonical participants, and meeting meta (contact, company, "
        "topic, when, sales owner) are in the user message."
    ),
    output=(
        "Return ONLY valid JSON (no markdown) with internal fields "
        "executiveSummary, discussionTopics, keyDetails, decisions, actionItems "
        "(array of {action, owner, dueDate}), commitments, objections, nextSteps, "
        "openQuestions, risks, sentiment, proposalRequested (boolean), buyingIntent "
        "(string), currentSolution (string), painPoints (array), "
        "evaluationCriteria (array), nextBestAction (string), followUpBy (string), "
        "and:\n"
        f"\"customerEmail\": {CUSTOMER_EMAIL_JSON}"
    ),
    guardrails=(
        "No HTML. No invented product capabilities. Customer copy stays professional "
        "and shareable with the client."
    ),
)


class MomState(TypedDict, total=False):
    transcript: str
    contact_name: Optional[str]
    topic: Optional[str]
    company_name: Optional[str]
    when_label: Optional[str]
    owner_name: Optional[str]
    seller_name: Optional[str]
    org_logo_url: Optional[str]
    participants: list[dict[str, str]]
    meet_link: Optional[str]
    contact_href: Optional[str]
    transcript_excerpt: Optional[str]
    heuristic: dict[str, Any]
    activity_id: Optional[str]
    contact_id: Optional[str]
    organization_id: Optional[str]
    job_id: str
    cleaned: str
    mom: Optional[dict[str, Any]]
    customer_email: Optional[dict[str, str]]
    internal_email: Optional[dict[str, str]]
    status: str
    reason: Optional[str]


def _as_str_list(val: Any, max_n: int = 25) -> list[str]:
    if not isinstance(val, list):
        return []
    out: list[str] = []
    for item in val:
        if isinstance(item, str) and item.strip():
            out.append(item.strip()[:280])
        if len(out) >= max_n:
            break
    return out


def _as_action_items(val: Any, max_n: int = 12) -> list[Any]:
    if not isinstance(val, list):
        return []
    out: list[Any] = []
    for item in val:
        if isinstance(item, dict):
            action = str(item.get("action") or "").strip()
            if action:
                out.append(item)
        elif isinstance(item, str) and item.strip():
            out.append(item.strip()[:280])
        if len(out) >= max_n:
            break
    return out


def _bool_field(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in {"true", "yes", "1"}
    return False


def _internal_mom(
    parsed: dict[str, Any],
    heur: dict[str, Any],
    meta: dict[str, Any],
) -> dict[str, Any]:
    mom: dict[str, Any] = {
        "executiveSummary": str(parsed.get("executiveSummary") or "").strip()[:1200],
        "sentiment": (
            str(parsed["sentiment"]).strip()[:80]
            if parsed.get("sentiment")
            else None
        ),
        "proposalRequested": _bool_field(parsed.get("proposalRequested")),
        "buyingIntent": str(parsed.get("buyingIntent") or "").strip()[:400],
        "currentSolution": str(parsed.get("currentSolution") or "").strip()[:400],
        "nextBestAction": str(parsed.get("nextBestAction") or "").strip()[:280],
        "followUpBy": str(parsed.get("followUpBy") or "").strip()[:80],
    }
    for key in LIST_KEYS:
        mom[key] = _as_str_list(parsed.get(key))
    mom["actionItems"] = _as_action_items(parsed.get("actionItems"))
    mom["nextSteps"] = _as_str_list(parsed.get("nextSteps"))
    if not mom["executiveSummary"] and isinstance(heur.get("executiveSummary"), str):
        mom["executiveSummary"] = heur["executiveSummary"]
    for key in LIST_KEYS:
        if not mom[key] and isinstance(heur.get(key), list):
            mom[key] = _as_str_list(heur.get(key))
    for key in STRUCTURED_LIST_KEYS:
        if not mom[key] and isinstance(heur.get(key), list):
            if key == "actionItems":
                mom[key] = _as_action_items(heur.get(key))
            else:
                mom[key] = _as_str_list(heur.get(key))
    if not mom.get("proposalRequested") and heur.get("proposalRequested"):
        mom["proposalRequested"] = True
    return postprocess_mom(mom, meta)


def _internal_email(
    mom: dict[str, Any],
    meta: dict[str, Any],
    state: MomState,
) -> dict[str, str]:
    doc = normalize_internal_mom(
        mom,
        meta,
        transcript_excerpt=state.get("transcript_excerpt") or "",
        contact_href=state.get("contact_href") or "",
        meet_link=state.get("meet_link") or "",
    )
    html = render_internal_mom_html(doc)
    return {
        "subject": doc["subject"][:180],
        "body": html[:INTERNAL_MOM_HTML_MAX],
    }


def _meta(state: MomState) -> dict[str, Any]:
    return {
        "contactName": state.get("contact_name"),
        "companyName": state.get("company_name"),
        "topic": state.get("topic"),
        "whenLabel": state.get("when_label"),
        "ownerName": state.get("owner_name"),
        "sellerName": state.get("seller_name") or "Worktual",
        "orgLogoUrl": state.get("org_logo_url"),
        "participants": state.get("participants") or [],
    }


def _participants_block(participants: list[dict[str, str]] | None) -> str:
    rows = participants or []
    if not rows:
        return ""
    lines = ["Canonical participants (use these names in the MOM):"]
    for row in rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        role = str(row.get("role") or "").strip()
        org = str(row.get("organization") or "").strip()
        tail = ", ".join(p for p in (role, org) if p)
        lines.append(f"- {name}" + (f" — {tail}" if tail else ""))
    return "\n".join(lines)


async def normalize(state: MomState) -> MomState:
    text = clean_transcript(state.get("transcript") or "")
    if len(text) < 40:
        return {
            **state,
            "cleaned": text,
            "status": "skipped",
            "reason": "too_short",
            "mom": state.get("heuristic") or None,
        }
    if not is_ai_configured():
        return {
            **state,
            "cleaned": text,
            "status": "failed",
            "reason": "llm_not_configured",
            "mom": state.get("heuristic") or None,
        }
    return {**state, "cleaned": text, "status": "running"}


async def extract(state: MomState) -> MomState:
    if state.get("status") != "running":
        return state

    heur = state.get("heuristic") or {}
    meta = _meta(state)
    participants = state.get("participants") or []
    context_lines = [
        f"Contact: {meta['contactName'] or 'unknown'}",
        f"Company: {meta['companyName'] or 'unknown'}",
        f"Topic: {meta['topic'] or 'unknown'}",
        f"When: {meta['whenLabel'] or 'unknown'}",
        f"Sales owner (CRM): {meta['ownerName'] or 'unknown'}",
        f"Seller organization: {meta['sellerName']}",
    ]
    part_block = _participants_block(participants)
    if part_block:
        context_lines.append("")
        context_lines.append(part_block)
    user = (
        "\n".join(context_lines)
        + "\n\n--- TRANSCRIPT ---\n"
        + state["cleaned"]
    )

    def _validate(parsed: dict[str, Any]) -> dict[str, Any] | None:
        mom = _internal_mom(parsed, heur, meta)
        doc = normalize_customer_mom(parsed, meta)
        html = render_customer_mom_html(doc)
        if not doc["subject"] or "Minutes of Meeting" not in html:
            return None
        internal = _internal_email(mom, meta, state)
        if "MEETING OVERVIEW" not in internal["body"]:
            return None
        return {
            "mom": mom,
            "customer_email": {
                "subject": doc["subject"][:180],
                "body": html[:CUSTOMER_MOM_HTML_MAX],
            },
            "internal_email": internal,
        }

    validated, reason = await generate_json_with_retries(
        system=SYSTEM,
        user=user,
        max_tokens=4000,
        repair_hint=(
            "Convert into ONLY JSON with internal MOM fields and customerEmail "
            "object (subject, sections, next steps, actionItems). No HTML."
        ),
        validate=_validate,
    )
    if not validated:
        return {
            **state,
            "status": "failed",
            "reason": reason or "customer_email_missing",
            "mom": heur or None,
            "customer_email": None,
        }

    return {
        **state,
        "mom": validated["mom"],
        "customer_email": validated["customer_email"],
        "internal_email": validated["internal_email"],
        "status": "ok",
        "reason": None,
    }


def _detail_normalize(_before: MomState, after: MomState) -> dict[str, Any] | None:
    return {"transcriptChars": len(after.get("cleaned") or "")}


def _detail_extract(_before: MomState, after: MomState) -> dict[str, Any] | None:
    mom = after.get("mom") or {}
    return {"actionItemCount": len(mom.get("actionItems") or [])}


_PIPELINE_STEPS = (
    traced_step(
            MEETING_MOM_MODULE_PATH,
            MEETING_MOM_AGENT,
            "normalize",
            "Preparing the transcript",
            _detail_normalize,
            id_field="activity_id",
            job_id_field="job_id",
        )(normalize),
    traced_step(
            MEETING_MOM_MODULE_PATH,
            MEETING_MOM_AGENT,
            "extract",
            "Extracting minutes of meeting",
            _detail_extract,
            id_field="activity_id",
            job_id_field="job_id",
        )(extract),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    transcript: str = "",
    contactName: str | None = None,
    topic: str | None = None,
    companyName: str | None = None,
    heuristic: dict[str, Any] | None = None,
    organization_id: str | None = None,
    activityId: str | None = None,
    contactId: str | None = None,
    whenLabel: str | None = None,
    ownerName: str | None = None,
    sellerName: str | None = None,
    when_label: str | None = None,
    owner_name: str | None = None,
    seller_name: str | None = None,
    orgLogoUrl: str | None = None,
    org_logo_url: str | None = None,
    participants: list[dict[str, str]] | None = None,
    meetLink: str | None = None,
    meet_link: str | None = None,
    contactHref: str | None = None,
    contact_href: str | None = None,
    transcriptExcerpt: str | None = None,
    transcript_excerpt: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    excerpt = transcriptExcerpt or transcript_excerpt or ""
    if not excerpt and transcript:
        cleaned = re.sub(r"<[^>]+>", " ", transcript)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        excerpt = cleaned[:2500] + ("…" if len(cleaned) > 2500 else "")

    result = await _run_pipeline(
        {
            "transcript": transcript or "",
            "contact_name": contactName,
            "topic": topic,
            "company_name": companyName,
            "when_label": whenLabel or when_label,
            "owner_name": ownerName or owner_name,
            "seller_name": sellerName or seller_name or "Worktual",
            "org_logo_url": orgLogoUrl or org_logo_url,
            "participants": participants or [],
            "meet_link": meetLink or meet_link,
            "contact_href": contactHref or contact_href,
            "transcript_excerpt": excerpt,
            "heuristic": heuristic or {},
            "activity_id": activityId,
            "contact_id": contactId,
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "status": "running",
        }
    )
    mom = result.get("mom")
    ok = result.get("status") == "ok" and isinstance(mom, dict)
    internal_email = result.get("internal_email")
    if ok and isinstance(mom, dict) and not internal_email:
        meta = {
            "contactName": contactName,
            "companyName": companyName,
            "topic": topic,
            "whenLabel": whenLabel or when_label,
            "ownerName": ownerName or owner_name,
            "sellerName": sellerName or seller_name or "Worktual",
            "orgLogoUrl": orgLogoUrl or org_logo_url,
            "participants": participants or [],
        }
        internal_email = _internal_email(
            mom,
            meta,
            {
                "meet_link": meetLink or meet_link,
                "contact_href": contactHref or contact_href,
                "transcript_excerpt": excerpt,
            },
        )
    return {
        "ok": ok or bool(mom),
        "mom": mom,
        "customerEmail": result.get("customer_email"),
        "internalEmail": internal_email,
        "status": result.get("status"),
        "reason": result.get("reason"),
    }
