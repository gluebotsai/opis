"""
Compliance & Privacy Control Agent (LangGraph).

Classifies one inbound email that already matched the auto-reply agent's
GDPR/CCPA/privacy keyword filter (`SENSITIVE_PATTERNS` in
email-auto-reply-job.ts, category "compliance"). That existing regex-based
escalation is a blunt "a human should look at this" signal with no way to
tell a real legal demand apart from a passing mention of a compliance term
-- this agent adds the judgment call on top of it.

Stateless / event-driven, same shape as sales_coach_agent.py: TypeScript
packs the full payload (subject + body) into one call -- this agent never
calls back into the CRM.

HITL rule (hard constraint): this agent only ever classifies and drafts. It
never deletes data and never sends anything to a customer. Its output can
only lead to ONE autonomous mutation on the TypeScript side -- a reversible
marketing-opt-out flag -- everything else (data deletion, data access) is
queued for an admin to review and explicitly execute.

The existing regex escalation (needsManualResponse + notifyOwnerOrAdmins)
stays in place regardless of what this agent does -- so even if the LLM is
unavailable or misclassifies, a human still sees every flagged email.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional, TypedDict
from uuid import uuid4

from app.agents.native_pipeline import run_steps

from app.llm import generate_ai_text, is_ai_configured
from app.agents.step_trace import traced_step

COMPLIANCE_MODULE_PATH = "compliance"
COMPLIANCE_AGENT = "compliance_privacy"

REQUEST_TYPES = {
    "data_deletion",
    "marketing_optout",
    "data_access",
    "other",
    "not_a_privacy_request",
}
CONFIDENCE_LEVELS = {"high", "medium", "low"}


class ComplianceState(TypedDict, total=False):
    subject: str
    body: str
    contact_name: Optional[str]
    activity_id: Optional[str]
    contact_id: Optional[str]
    organization_id: Optional[str]
    job_id: str
    cleaned: str
    classification: Optional[dict[str, Any]]
    status: str
    reason: Optional[str]


SYSTEM = """You are a data-privacy officer reviewing ONE inbound customer email that
already matched a GDPR/CCPA/privacy keyword filter (so it may be a real request, or
just a passing mention of a compliance term -- your job is to tell the difference).

Classify it into exactly one requestType:
- "data_deletion": customer is asking for their personal data to be deleted / a
  "right to be forgotten" request.
- "marketing_optout": customer is asking to stop receiving marketing emails or to be
  removed from marketing lists (not necessarily a full data deletion).
- "data_access": customer is asking for a copy/export of the data held about them.
- "other": a genuine compliance-related question or complaint that is not one of the
  above (e.g. asking about a data breach, a SOC2/HIPAA audit question from a partner).
- "not_a_privacy_request": the email only mentions a compliance term in passing (e.g.
  "we are GDPR compliant hosting", a vendor's own compliance marketing copy) and is
  NOT an actual request from this customer about their own data.

Return ONLY valid JSON (no markdown):
{
  "requestType": "data_deletion|marketing_optout|data_access|other|not_a_privacy_request",
  "confidence": "high|medium|low",
  "reason": "1-2 sentences grounded in the email text explaining your classification",
  "draftConfirmation": "a short, customer-safe acknowledgment draft for a human to review and send, or null for other/not_a_privacy_request"
}

Rules:
- Ground your classification in the email text -- never invent facts not present in it.
- "draftConfirmation" must be polite, non-committal about timelines you cannot verify,
  and must NOT promise the request is already completed -- a human still has to act on it.
- Keep "draftConfirmation" to 2-4 sentences.
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


def normalize_classification(parsed: dict[str, Any]) -> dict[str, Any] | None:
    """Validate + normalize the LLM's raw JSON into the persisted shape.

    Returns None when the output isn't usable (unknown requestType/confidence
    or missing reason) -- caller treats that as a failed LLM turn, same
    contract as sales_coach_agent's `normalize_coaching_insight`.
    """
    request_type = str(parsed.get("requestType") or "").strip().lower()
    if request_type not in REQUEST_TYPES:
        return None
    confidence = str(parsed.get("confidence") or "").strip().lower()
    if confidence not in CONFIDENCE_LEVELS:
        return None
    reason = str(parsed.get("reason") or "").strip()
    if not reason:
        return None

    draft = parsed.get("draftConfirmation")
    draft_confirmation = (
        str(draft).strip()[:600] if isinstance(draft, str) and draft.strip() else None
    )

    return {
        "requestType": request_type,
        "confidence": confidence,
        "reason": reason[:400],
        "draftConfirmation": draft_confirmation,
    }


async def normalize(state: ComplianceState) -> ComplianceState:
    subject = re.sub(r"\s+", " ", (state.get("subject") or "")).strip()
    body = re.sub(r"<[^>]+>", " ", state.get("body") or "")
    body = re.sub(r"\s+", " ", body).strip()[:8000]
    cleaned = f"Subject: {subject}\n\n{body}".strip()

    if not body:
        return {
            **state,
            "cleaned": cleaned,
            "status": "skipped",
            "reason": "empty_body",
            "classification": None,
        }
    if not is_ai_configured():
        return {
            **state,
            "cleaned": cleaned,
            "status": "skipped",
            "reason": "llm_not_configured",
            "classification": None,
        }
    return {**state, "cleaned": cleaned, "status": "running"}


async def classify(state: ComplianceState) -> ComplianceState:
    if state.get("status") != "running":
        return state

    contact_name = state.get("contact_name") or "unknown"
    user = f"Customer: {contact_name}\n\n--- EMAIL ---\n{state['cleaned']}"

    raw = await generate_ai_text(
        system=SYSTEM,
        user=user,
        max_tokens=500,
        timeout_ms=30_000,
    )
    if not raw:
        return {**state, "status": "failed", "reason": "llm_empty", "classification": None}

    parsed = _extract_json(raw)
    if not parsed:
        return {**state, "status": "failed", "reason": "parse_failed", "classification": None}

    classification = normalize_classification(parsed)
    if not classification:
        return {**state, "status": "failed", "reason": "invalid_shape", "classification": None}

    return {**state, "classification": classification, "status": "ok", "reason": None}


def _detail_normalize(_before: ComplianceState, after: ComplianceState) -> dict[str, Any] | None:
    return {"bodyChars": len(after.get("cleaned") or "")}


def _detail_classify(_before: ComplianceState, after: ComplianceState) -> dict[str, Any] | None:
    classification = after.get("classification") or {}
    return {"requestType": classification.get("requestType")}


_PIPELINE_STEPS = (
    traced_step(
            COMPLIANCE_MODULE_PATH,
            COMPLIANCE_AGENT,
            "normalize",
            "Preparing the email for review",
            _detail_normalize,
            id_field="activity_id",
            job_id_field="job_id",
        )(normalize),
    traced_step(
            COMPLIANCE_MODULE_PATH,
            COMPLIANCE_AGENT,
            "classify",
            "Classifying the privacy request",
            _detail_classify,
            id_field="activity_id",
            job_id_field="job_id",
        )(classify),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(
    subject: str = "",
    body: str = "",
    contactName: str | None = None,
    organization_id: str | None = None,
    activityId: str | None = None,
    contactId: str | None = None,
    **_: Any,
) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "subject": subject or "",
            "body": body or "",
            "contact_name": contactName,
            "activity_id": activityId,
            "contact_id": contactId,
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "status": "running",
        }
    )
    classification = result.get("classification")
    return {
        "ok": bool(classification),
        "classification": classification,
        "status": result.get("status"),
        "reason": result.get("reason"),
    }
