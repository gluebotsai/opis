"""
Invoice Escalation Agent (LangGraph).

Judges the collections risk of one overdue B2B invoice — a severity band
(watch|escalate|urgent) grounded in days overdue, invoice amount, payment
terms, the linked deal's stage, and the company's own prior payment history
— and drafts an internal note plus a customer-safe reminder for a human to
review and send.

Primary path: LLM returns structured severity/reason/drafts JSON.
Heuristic decide_invoice_escalation_heuristic is offline fallback only.

HITL rule (hard constraint): this agent never marks an invoice paid/void and
never changes dueAt/total — it only writes the escalation* overlay fields
(plus notifications). It never sends customerDraft itself; that stays a
human copy/send action.
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict, Optional
from uuid import uuid4

from app.agents.native_pipeline import run_steps

from app.agents.llm_result import (
    generate_json_with_retries,
    label_ai,
    label_fallback,
    sectioned_system_prompt,
)
from app.agents.step_trace import traced_step
from app.crm_client import CrmClient

logger = logging.getLogger(__name__)

INVOICE_ESCALATION_MODULE_PATH = "invoice-escalation"
INVOICE_ESCALATION_AGENT = "invoice_escalation"

ESCALATION_SEVERITIES = {"watch", "escalate", "urgent"}


class InvoiceEscalationState(TypedDict, total=False):
    invoice_id: str
    organization_id: Optional[str]
    job_id: str
    context: dict[str, Any]
    decision: dict[str, Any]
    status: str
    source: str
    reason: Optional[str]
    persist_result: dict[str, Any]


INVOICE_ESCALATION_SYSTEM = sectioned_system_prompt(
    role=(
        "You are an accounts-receivable / collections analyst for Worktual. "
        "You judge the collections risk of one overdue B2B invoice — you "
        "never mark it paid or change its amount/due date, only assess risk "
        "and draft text for a human to review."
    ),
    goal=(
        "Judge a severity band for this overdue invoice and draft an "
        "internal note plus a customer-safe payment-reminder for a human "
        "to send."
    ),
    instructions=(
        "- Use ONLY the provided invoice, deal, and prior-payment facts. Never invent evidence.\n"
        "- severity=watch: recently overdue, no red flags — a light nudge is enough.\n"
        "- severity=escalate: meaningfully overdue, or the company has a history of paying "
        "late — warrants a firmer, timely follow-up.\n"
        "- severity=urgent: severely overdue, large amount at risk, or a pattern of repeated "
        "late/non-payment — warrants immediate account-owner attention.\n"
        "- Weigh context, not just days overdue: a strategic account with an active "
        "negotiate-stage renewal deal deserves a different tone than a quiet, closed account.\n"
        "- internalNote is for the account owner (short, factual context).\n"
        "- customerDraft must be polite and professional — a payment reminder a human can "
        "copy/send as-is, never accusatory."
    ),
    context="Invoice, linked deal, and prior-payment-history facts are in the user message.",
    output=(
        "Return ONLY valid JSON (no markdown):\n"
        "{\n"
        '  "severity": "watch|escalate|urgent",\n'
        '  "reason": "<1-2 sentence evidence-grounded rationale>",\n'
        '  "internalNote": "<1-2 sentences for the account owner>",\n'
        '  "customerDraft": "<polite payment-reminder draft for a human to review/send>"\n'
        "}"
    ),
    guardrails=(
        "- Never invent invoices, deals, or payment history not present in the context.\n"
        "- Never claim you sent anything, marked the invoice paid, or changed its terms — "
        "you only assess and draft.\n"
        "- Prefer a higher severity over guessing when evidence is thin."
    ),
)


def _context_user_payload(ctx: dict[str, Any]) -> str:
    history = ctx.get("priorPaymentHistory") or []
    history_lines = (
        "; ".join(
            f"{h.get('daysLate')}d late (amount {h.get('total')})" for h in history[:5]
        )
        or "no prior paid invoices on file"
    )
    lines = [
        f"Invoice: {ctx.get('number')} ({ctx.get('status')})",
        f"Amount: {ctx.get('total')} {ctx.get('currency')}",
        f"Company: {ctx.get('companyName') or '—'}",
        f"Deal: {ctx.get('dealTitle') or '—'} (stage={ctx.get('dealStage') or '—'})",
        f"Issue date: {ctx.get('issueDate') or 'unknown'}",
        f"Due date: {ctx.get('dueAt') or 'unknown'}",
        f"Days overdue: {ctx.get('daysOverdue')}",
        f"Payment terms: {ctx.get('paymentTerms') or 'unspecified'}",
        f"Prior payment history for this company: {history_lines}",
        f"Previous escalation: severity={ctx.get('escalationSeverity') or 'none'} "
        f"reason={ctx.get('escalationReason') or 'none'}",
    ]
    return "\n".join(lines)


def _normalize_llm_escalation(parsed: dict[str, Any]) -> dict[str, Any] | None:
    severity = str(parsed.get("severity") or "").strip().lower()
    if severity not in ESCALATION_SEVERITIES:
        return None
    reason = str(parsed.get("reason") or "").strip()
    if not reason:
        return None
    customer_draft = str(parsed.get("customerDraft") or "").strip()
    if not customer_draft:
        return None
    internal_note = str(parsed.get("internalNote") or "").strip() or None
    return {
        "severity": severity,
        "reason": reason[:500],
        "internalNote": internal_note[:500] if internal_note else None,
        "customerDraft": customer_draft[:2000],
    }


async def decide_via_llm(ctx: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
    return await generate_json_with_retries(
        system=INVOICE_ESCALATION_SYSTEM,
        user=_context_user_payload(ctx),
        max_tokens=900,
        repair_hint=(
            "Convert into ONLY valid escalation JSON with keys severity, "
            "reason, internalNote, customerDraft. No markdown."
        ),
        validate=_normalize_llm_escalation,
    )


def decide_invoice_escalation_heuristic(ctx: dict[str, Any]) -> dict[str, Any]:
    """Offline fallback — simple days-overdue thresholds as a floor."""
    days_overdue = ctx.get("daysOverdue")
    number = ctx.get("number") or "this invoice"
    days_overdue = days_overdue if isinstance(days_overdue, (int, float)) else 0

    history = ctx.get("priorPaymentHistory") or []
    avg_days_late = None
    if history:
        late_values = [h.get("daysLate") for h in history if isinstance(h.get("daysLate"), (int, float))]
        if late_values:
            avg_days_late = sum(late_values) / len(late_values)

    if days_overdue > 30:
        severity = "urgent"
    elif days_overdue > 15:
        severity = "escalate"
    else:
        severity = "watch"

    if avg_days_late is not None and avg_days_late > 15 and severity == "watch":
        severity = "escalate"

    reason_parts = [f"{days_overdue} day(s) overdue"]
    if avg_days_late is not None:
        reason_parts.append(f"company averages {avg_days_late:.0f}d late on prior invoices")
    reason = "; ".join(reason_parts)[:500]

    internal_note = f"Invoice {number} is {days_overdue}d overdue — follow up with the account."
    customer_draft = (
        f"Hi, this is a friendly reminder that invoice {number} is now past its due date. "
        "Could you please arrange payment at your earliest convenience, or let us know if "
        "you have any questions? Thank you."
    )

    return {
        "severity": severity,
        "reason": reason,
        "internalNote": internal_note[:500],
        "customerDraft": customer_draft[:2000],
    }


async def load_context(state: InvoiceEscalationState) -> InvoiceEscalationState:
    client = CrmClient(state.get("organization_id"))
    ctx = await client.get_invoice_escalation_context(state["invoice_id"])
    return {**state, "context": ctx}


async def decide(state: InvoiceEscalationState) -> InvoiceEscalationState:
    ctx = state.get("context") or {}
    if not ctx:
        return {
            **state,
            "decision": None,
            "status": "skipped",
            "source": "heuristic",
            "reason": "invoice_not_found",
        }

    decision, llm_reason = await decide_via_llm(ctx)
    source = "ai"
    reason: str | None = None
    if decision is None:
        logger.warning(
            "invoice-escalation LLM unavailable after retries; using heuristic "
            "fallback invoice=%s reason=%s",
            state.get("invoice_id"),
            llm_reason,
        )
        decision = decide_invoice_escalation_heuristic(ctx)
        source = "heuristic"
        reason = llm_reason or "llm_failed"

    domain_reason = str(decision.get("reason") or "").strip()
    tagged = (
        label_ai(decision)
        if source == "ai"
        else label_fallback(decision, reason or "llm_failed")
    )
    decision_clean = {k: v for k, v in tagged.items() if k != "source"}
    if domain_reason:
        decision_clean["reason"] = domain_reason
    return {
        **state,
        "decision": decision_clean,
        "status": "decided",
        "source": source,
        "reason": reason,
    }


async def persist(state: InvoiceEscalationState) -> InvoiceEscalationState:
    decision = state.get("decision")
    if not decision:
        return {**state, "persist_result": {"status": "skipped"}, "status": "skipped"}

    client = CrmClient(state.get("organization_id"))
    result = await client.persist_invoice_escalation(state["invoice_id"], decision)
    return {
        **state,
        "persist_result": result,
        "status": result.get("status") or state.get("status"),
    }


def _detail_load_context(
    _before: InvoiceEscalationState, after: InvoiceEscalationState
) -> dict[str, Any] | None:
    ctx = after.get("context") or {}
    return {
        "daysOverdue": ctx.get("daysOverdue"),
        "total": ctx.get("total"),
        "status": ctx.get("status"),
    }


def _detail_decide(
    _before: InvoiceEscalationState, after: InvoiceEscalationState
) -> dict[str, Any] | None:
    decision = after.get("decision") or {}
    return {
        "severity": decision.get("severity"),
        "source": after.get("source"),
    }


def _detail_persist(
    _before: InvoiceEscalationState, after: InvoiceEscalationState
) -> dict[str, Any] | None:
    result = after.get("persist_result") or {}
    return {"status": result.get("status") or after.get("status")}


_PIPELINE_STEPS = (
    traced_step(
            INVOICE_ESCALATION_MODULE_PATH,
            INVOICE_ESCALATION_AGENT,
            "load_context",
            "Loading invoice, deal & payment history",
            _detail_load_context,
            id_field="invoice_id",
            job_id_field="job_id",
        )(load_context),
    traced_step(
            INVOICE_ESCALATION_MODULE_PATH,
            INVOICE_ESCALATION_AGENT,
            "decide",
            "Judging collections risk",
            _detail_decide,
            id_field="invoice_id",
            job_id_field="job_id",
        )(decide),
    traced_step(
            INVOICE_ESCALATION_MODULE_PATH,
            INVOICE_ESCALATION_AGENT,
            "persist",
            "Saving severity & drafting reminder",
            _detail_persist,
            id_field="invoice_id",
            job_id_field="job_id",
        )(persist),
)


async def _run_pipeline(state: dict[str, Any]) -> dict[str, Any]:
    return await run_steps(state, _PIPELINE_STEPS)


async def run(invoice_id: str, organization_id: str | None = None) -> dict[str, Any]:
    result = await _run_pipeline(
        {
            "invoice_id": invoice_id,
            "organization_id": organization_id,
            "job_id": str(uuid4()),
            "status": "running",
        }
    )
    return {
        "invoiceId": invoice_id,
        "status": result.get("status") or "failed",
        "source": result.get("source") or "heuristic",
        "reason": result.get("reason"),
        "decision": result.get("decision"),
        "persistResult": result.get("persist_result"),
    }
