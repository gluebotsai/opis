"""Guided create-ticket turn classifier — ported from Node guidedChatReply."""

from __future__ import annotations

import json
import random
import re
import time
from typing import Any, Literal

from app.messages_compat import HumanMessage, SystemMessage

from app.llm import build_llm
from app.llm_log import log_llm

TicketReasonIntent = Literal[
    "correct_field",
    "provide_issue",
    "confirm",
    "cancel",
    "ambiguous",
    "question",
    "continue",
]
TicketReasonField = Literal["email", "phone", "name", "issue", "contact"] | None

TICKET_REASON_SYSTEM = """You are the reasoning brain for Worktual's guided create-ticket chat.
You must CLASSIFY the user's latest message AND write the assistant reply.
Do all interpretation in this step — do not rely on hardcoded UI scripts.

Current flow steps: customerName → contact (email/phone) → issue → confirm.
The UI (not you) owns step order. Your reply must not invent a different next field.

## Critical distinction
- FIELD CORRECTION: user wants to fix name/email/phone/issue already collected in this guided chat
  → intent=correct_field. NEVER treat these as the ticket issue.
- REAL ISSUE: user is describing a customer problem to file
  → intent=provide_issue (when step is issue or they clearly describe a problem)
- QUESTION / OFF-TOPIC ASK: user asks for information instead of answering the current step
  → intent=question. NEVER store a question as name, contact, or issue.
- CONFIRM / CANCEL: only when step is confirm
- AMBIGUOUS: short phrases that could be either

## Step: customerName
- Real name → intent=continue with field="name" and newValue=the cleaned name.
- Question → intent=question.
- "change name" style edit → intent=correct_field with field="name".

## Output
Return ONLY valid JSON (no markdown fences):
{
  "intent": "correct_field" | "provide_issue" | "confirm" | "cancel" | "ambiguous" | "question" | "continue",
  "field": "email" | "phone" | "name" | "issue" | "contact" | null,
  "newValue": string | null,
  "reason": "1 short sentence of your reasoning (for logs; not shown)",
  "reply": "1–3 natural sentences; vary wording; use **bold**; no HTML; no UI click paths"
}

## Reply rules by intent
- correct_field + no newValue: ask for the correct value; mention previous if any.
- correct_field + newValue: confirm update; ask next missing piece from context if hinted.
- provide_issue: brief ack that you will draft from their issue.
- ambiguous: ask whether field correction OR support issue.
- question: do not invent product data; acknowledge; the UI will answer via specialists. Briefly steer back to the current step.
- confirm / cancel / continue: follow the intent naturally.
Fresh wording every time. Never copy a fixed script."""


def _llm(temperature: float):
    return build_llm(temperature=temperature)


def _extract_json(text: str) -> dict[str, Any] | None:
    trimmed = (text or "").strip()
    try:
        data = json.loads(trimmed)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", trimmed)
    if not match:
        return None
    try:
        data = json.loads(match.group(0))
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def _normalize_intent(raw: Any) -> TicketReasonIntent:
    v = str(raw or "").lower()
    if v in ("correct_field", "correction", "fix_field"):
        return "correct_field"
    if v in ("provide_issue", "issue", "new_issue"):
        return "provide_issue"
    if v in ("confirm", "yes"):
        return "confirm"
    if v in ("cancel", "stop"):
        return "cancel"
    if v in ("ambiguous", "clarify"):
        return "ambiguous"
    if v in ("question", "ask", "query"):
        return "question"
    return "continue"


def _normalize_field(raw: Any) -> TicketReasonField:
    v = str(raw or "").lower()
    if v in ("email", "mail", "e-mail"):
        return "email"
    if v in ("phone", "mobile", "number"):
        return "phone"
    if v in ("name", "customername"):
        return "name"
    if v in ("issue", "description", "problem"):
        return "issue"
    if v == "contact":
        return "contact"
    return None


def ticket_reason_turn(
    *,
    user_text: str,
    step_id: str,
    customer_name: str | None = None,
    customer_email: str | None = None,
    customer_phone: str | None = None,
    issue: str | None = None,
    subject: str | None = None,
    fallback_reply: str = "Let's continue.",
) -> dict[str, Any] | None:
    user = f"""Guided create-ticket turn — reason carefully.

Current step: {step_id}
Customer name on file: {customer_name or "(none)"}
Email on file: {customer_email or "(none)"}
Phone on file: {customer_phone or "(none)"}
Issue on file: {issue or "(none)"}
Draft subject (if any): {subject or "(none)"}

User just said: {user_text}

Decide intent with reasoning. If they said something like "change mail" right after providing contact, that is almost always correct_field for email — not provide_issue.
If they describe needing email changed ON AN ACCOUNT / LOGIN / APP, that is provide_issue.
If they are asking the co-worker something (counts, workload, capabilities) that is intent=question — never a field value.

Freshness: {time.time()}-{random.randrange(10**6):06d}

JSON only."""

    try:
        result = _llm(0.35).invoke(
            [
                SystemMessage(content=TICKET_REASON_SYSTEM),
                HumanMessage(content=user),
            ]
        )
        raw = result.content if isinstance(result.content, str) else str(result.content)
        raw = (raw or "").strip()
        parsed = _extract_json(raw)
        if not parsed:
            log_llm(
                kind="ticket_reason_error",
                user_text=user_text,
                response=raw[:300],
                agent="ticket-reason",
                error="parse_failed",
            )
            return None
        reply = str(parsed.get("reply") or "").strip()
        if not reply:
            return None
        out = {
            "intent": _normalize_intent(parsed.get("intent")),
            "field": _normalize_field(parsed.get("field")),
            "newValue": (
                None
                if parsed.get("newValue") is None
                else (str(parsed.get("newValue")).strip() or None)
            ),
            "reason": str(parsed.get("reason") or "").strip(),
            "reply": reply,
        }
        log_llm(
            kind="ticket_reason",
            user_text=user_text,
            response=f"intent={out['intent']} field={out['field']} | {reply[:200]}",
            agent="ticket-reason",
        )
        return out
    except Exception as exc:  # noqa: BLE001
        log_llm(
            kind="ticket_reason_error",
            user_text=user_text,
            response="",
            agent="ticket-reason",
            error=str(exc),
        )
        return None
