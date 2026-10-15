"""RQA — Resolution Quality Agent.

Runs only when a ticket is updated to Resolved. Checks whether the close is
documented (staff notes / resolution explanation). TSAA ai_summary is not a
passing record. Never auto-writes; never reopens; never on a timer.
"""

from __future__ import annotations

import os
from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import (
    confidence_of,
    flag_true,
    is_needful_summary,
    run_agent_llm,
)

SPEC = AgentSpec(
    agent_id="rqa",
    trigger=("ticket.updated",),
    inputs_required=("organization_id", "ticket_number"),
    tools_used=frozenset(
        {
            "get_ticket",
            "list_ticket_notes",
            "get_ticket_progress",
            "add_ticket_note",
        }
    ),
    output_type="ACTION_PROPOSAL",
    risk_level="high",
    confidence_threshold=0.65,
    audit_event="proactive.rqa",
    full_name="Resolution Quality Agent",
)

_RESOLVED = frozenset({"resolved", "closed", "solved"})
_SYSTEM = """You are the Resolution Quality Agent (RQA).

A ticket was just marked Resolved. Decide whether the close is documented well
enough for a later agent or auditor — not whether the AI summary looks polished.

Rules:
- Judge by meaning (LLM understanding), never keyword or regex lists.
- tickets.ai_summary is NOT a passing resolution record. Ignore it as evidence
  that staff documented the fix.
- Quality is OK only when staff notes (or an equivalent resolution field) explain
  what was done to resolve the issue.
- Empty notes, status-only closes, or "marked Resolved" with no fix → not OK.
- Never invent a fix that is not already in the ticket or notes.
- If docs are weak and you can write an internal closing note from existing
  facts only (subject, description, notes), set action=draft_note and put that
  text in draft. The draft may list what is missing; do not fabricate a solution.
- If docs are weak and you cannot ground a useful draft, set action=recommend.
- If quality is fine, set quality_ok=true and action=silence.

Return JSON only:
{"quality_ok": boolean, "gaps": [string], "action": "silence"|"recommend"|"draft_note",
 "draft": string, "confidence": number, "reason": string}
"""


def _enabled() -> bool:
    return os.getenv("PROACTIVE_RQA", "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _payload(event: dict[str, Any]) -> dict[str, Any]:
    p = event.get("payload")
    return p if isinstance(p, dict) else {}


def _norm_tn(raw: Any) -> str:
    tn = str(raw or "").strip()
    if tn and not tn.startswith("#") and tn.lstrip("#").isdigit():
        return f"#{tn.lstrip('#')}"
    return tn


def _is_resolved_status(raw: Any) -> bool:
    s = str(raw or "").strip().lower()
    if not s:
        return False
    if s in _RESOLVED:
        return True
    if "reopen" in s:
        return False
    if s in {"cancelled", "canceled"}:
        return False
    return any(tok in s for tok in ("close", "resolv", "done", "complet"))


def _is_resolve_transition(event: dict[str, Any]) -> bool:
    if str(event.get("event_type") or "").strip() != "ticket.updated":
        return False
    p = _payload(event)
    new = str(p.get("new_status") or p.get("status") or "").strip()
    prev = str(p.get("prev_status") or "").strip()
    if not _is_resolved_status(new):
        return False
    if prev and _is_resolved_status(prev):
        return False
    return True


def _rows(result: Any) -> list[dict[str, Any]]:
    if isinstance(result, list):
        return [r for r in result if isinstance(r, dict)]
    if not isinstance(result, dict):
        return []
    payload = result.get("payload")
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("notes", "items", "history", "data"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [r for r in rows if isinstance(r, dict)]
    return []


def _note_text(row: dict[str, Any]) -> str:
    return str(
        row.get("text")
        or row.get("body")
        or row.get("content")
        or row.get("note")
        or ""
    ).strip()


def _format_notes(notes: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for row in notes[-30:]:
        text = _note_text(row)
        if not text:
            continue
        vis = str(row.get("visibility") or row.get("kind") or "internal").strip()
        lines.append(f"{vis}: {text[:500]}")
    return "\n".join(lines) if lines else "(none)"


def _already_queued(organization_id: str, ticket_number: str) -> bool:
    tn = _norm_tn(ticket_number)
    if not organization_id or not tn:
        return False
    try:
        from app.proactive.store import list_approvals, list_recommendations

        recs = list_recommendations(organization_id, ticket_number=tn)
        for rec in recs:
            if str(rec.get("agent_id") or "").strip().lower() != "rqa":
                continue
            status = str(rec.get("status") or "open").strip().lower()
            if status in {"", "open"}:
                return True
        for item in list_approvals(organization_id, status="pending"):
            if str(item.get("agent_id") or "").strip().lower() != "rqa":
                continue
            other = _norm_tn(item.get("ticket_number") or "")
            if other == tn:
                return True
    except Exception:
        return False
    return False


def propose(event: dict[str, Any]) -> Proposal | None:
    if not _enabled():
        return None
    if not _is_resolve_transition(event):
        return None
    org = str(event.get("organization_id") or "").strip()
    p = _payload(event)
    tn = _norm_tn(
        event.get("ticket_number") or p.get("ticket_number") or p.get("ticketNumber")
    )
    if not org or not tn:
        return None
    if _already_queued(org, tn):
        return None

    ticket: dict[str, Any] = dict(p)
    notes: list[dict[str, Any]] = []
    progress: dict[str, Any] = {}
    try:
        from app.proactive.retrieval import ticket_from_tool
        from app.tools.ticket_read import get_ticket, get_ticket_progress, list_ticket_notes

        ticket = ticket_from_tool(get_ticket(tn), ticket)
        notes = _rows(list_ticket_notes(tn))
        raw_progress = get_ticket_progress(tn) or {}
        inner = raw_progress.get("payload") if isinstance(raw_progress, dict) else None
        progress = inner if isinstance(inner, dict) else {}
    except Exception:
        pass

    obj = run_agent_llm(
        "rqa",
        _SYSTEM,
        (
            f"ticket_number={tn}\n"
            f"subject={ticket.get('subject') or ticket.get('title') or ''}\n"
            f"description={ticket.get('description') or ''}\n"
            f"status={ticket.get('status') or p.get('new_status') or ''}\n"
            f"ai_summary={ticket.get('ai_summary') or ticket.get('aiSummary') or ''}\n"
            f"resolution_field={ticket.get('resolution') or ''}\n"
            f"progress={progress}\n"
            f"notes=\n{_format_notes(notes)}\n"
        ),
    )
    if not obj:
        return None
    if flag_true(obj, "quality_ok") or str(obj.get("action") or "").strip().lower() in {
        "silence",
        "ok",
        "none",
    }:
        return None

    action = str(obj.get("action") or "").strip().lower()
    draft = str(obj.get("draft") or "").strip()
    reason = str(obj.get("reason") or "").strip()
    gaps = obj.get("gaps") if isinstance(obj.get("gaps"), list) else []
    conf = confidence_of(obj, 0.5)

    if action == "draft_note" and is_needful_summary(draft):
        summary = reason if is_needful_summary(reason) else (
            f"{tn} was Resolved without a complete resolution note. "
            "Review the drafted internal closing note."
        )
        return Proposal(
            agent_id="rqa",
            organization_id=org,
            ticket_id=str(event.get("ticket_id") or p.get("ticket_id") or ""),
            ticket_number=tn,
            event_id=event.get("id") or event.get("event_id"),
            event_type=event.get("event_type"),
            output_type="ACTION_PROPOSAL",
            risk_level="high",
            confidence=conf,
            tool_name="add_ticket_note",
            tool_args={
                "ticket_number": tn,
                "text": draft,
                "visibility": "internal",
            },
            summary=summary,
            payload={
                "draft": draft,
                "gaps": gaps,
                "reason": reason,
                "visibility": "internal",
            },
        )

    summary = reason if is_needful_summary(reason) else (
        f"{tn} was Resolved without a staff resolution note. "
        "Please add what was done to close this ticket."
    )
    if not is_needful_summary(summary):
        return None
    return Proposal(
        agent_id="rqa",
        organization_id=org,
        ticket_id=str(event.get("ticket_id") or p.get("ticket_id") or ""),
        ticket_number=tn,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="RECOMMENDATION",
        risk_level="high",
        confidence=conf,
        tool_name=None,
        tool_args={},
        summary=summary,
        payload={"gaps": gaps, "reason": reason, "action": "recommend"},
    )
