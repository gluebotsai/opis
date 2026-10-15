"""ARA — LLM-only ticket lifecycle (close / reopen) on customer replies.

No keyword gates. No create-time password/unlock playbooks.
LLM judges close vs reopen vs silence. Customer close is Closed
(Approvals). Staff already set Resolved. Reopen still executes
status-only update_ticket. Express still mutates.

Ticket-scoped channels (portal note, email) pass ticket_number on the event.
Portal chat passes conversation history + the customer's ticket catalog; the LLM
resolves references like "that ticket" and whether close/reopen is needed.
"""

from __future__ import annotations

import re
from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, flag_true, run_agent_llm

SPEC = AgentSpec(
    agent_id="ara",
    trigger=("customer.replied", "on_demand.ara"),
    inputs_required=("organization_id",),
    tools_used=frozenset({"get_ticket", "update_ticket"}),
    output_type="ACTION_PROPOSAL",
    risk_level="low",
    confidence_threshold=0.55,
    audit_event="proactive.ara",
    full_name="Autonomous Resolution Agent",
)

_ACTIONS = frozenset({"close_ticket", "reopen_ticket"})
_TN_RE = re.compile(r"#?(\d{1,10})")


def _customer_message(event: dict[str, Any]) -> str:
    payload = event.get("payload") or {}
    for key in ("text", "message", "body", "note", "content"):
        val = str(payload.get(key) or "").strip()
        if val:
            return val
    return str(event.get("text") or "").strip()


def _normalize_status(action: str, raw: str) -> str:
    if action == "close_ticket":
        return "Closed"
    return "Reopened"


def _normalize_ticket_number(raw: Any) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    m = _TN_RE.search(s)
    if not m:
        return ""
    return f"#{m.group(1)}"


def _format_history(payload: dict[str, Any]) -> str:
    history = payload.get("history") or payload.get("conversation") or []
    if not isinstance(history, list):
        return ""
    lines: list[str] = []
    for turn in history[-24:]:
        if not isinstance(turn, dict):
            continue
        role = str(turn.get("role") or "user").strip().lower() or "user"
        text = str(turn.get("text") or turn.get("content") or "").strip()
        if not text:
            continue
        lines.append(f"{role}: {text[:400]}")
    return "\n".join(lines)


def _format_customer_tickets(payload: dict[str, Any]) -> str:
    rows = payload.get("customer_tickets") or payload.get("tickets") or []
    if not isinstance(rows, list) or not rows:
        return "(none provided)"
    parts: list[str] = []
    for row in rows[:20]:
        if not isinstance(row, dict):
            continue
        tn = _normalize_ticket_number(
            row.get("ticket_number") or row.get("id") or row.get("number")
        )
        if not tn:
            continue
        status = str(row.get("status") or "").strip()
        subject = str(row.get("subject") or "").strip()[:80]
        parts.append(f"{tn} status={status} subject={subject}")
    return "\n".join(parts) if parts else "(none provided)"


def _seed_ticket_number(event: dict[str, Any]) -> str:
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    return _normalize_ticket_number(
        event.get("ticket_number")
        or payload.get("ticket_number")
        or payload.get("ticketNumber")
    )


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    event_type = str(event.get("event_type") or "").strip()
    if not org:
        return None
    # Create-time playbooks deferred — ignore ticket.created if ever routed.
    if event_type == "ticket.created":
        return None

    customer_msg = _customer_message(event)
    if not customer_msg:
        return None

    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    seed_tn = _seed_ticket_number(event)
    # Ticket-scoped channels must already know the ticket.
    if event_type == "customer.replied" and not seed_tn:
        return None

    history_blob = _format_history(payload)
    tickets_blob = _format_customer_tickets(payload)
    channel = str(payload.get("channel") or event_type or "").strip()

    ticket_hint: dict[str, Any] = dict(payload)
    if seed_tn:
        try:
            from app.tools.ticket_read import get_ticket
            from app.proactive.retrieval import ticket_from_tool

            ticket_hint = ticket_from_tool(get_ticket(seed_tn), ticket_hint)
        except Exception:
            pass

    hint_status = str(ticket_hint.get("status") or payload.get("status") or "").strip()
    hint_subject = str(ticket_hint.get("subject") or payload.get("subject") or "").strip()

    obj = run_agent_llm(
        "ara",
        "You are the Autonomous Resolution Agent. You only decide ticket close/reopen "
        "from the customer's conversation intent — never invent other actions. "
        "Allowed actions: close_ticket (customer confirms the staff fix / asks to close), "
        "reopen_ticket (customer says still broken / please reopen that ticket). "
        "Return JSON: needed (boolean), action (close_ticket|reopen_ticket|empty), "
        "ticket_number (e.g. #9 — required when needed=true), "
        "status (Closed|Reopened), confidence (0-1), rationale (short). "
        "close_ticket is only valid when seed_status is Resolved (staff finished; "
        "customer is acknowledging). If the ticket is not Resolved, needed=false "
        "for close — do not set Resolved; staff own that status. "
        "When the customer says 'that ticket' / 'it' / 'the same one', resolve which "
        "ticket they mean from conversation history and customer_tickets — do not pick "
        "a different open ticket. "
        "needed=false for thanks-only, KB/how-to chat, new-issue filing, unclear, or "
        "off-topic. If already Closed and they only ask to close again, needed=false. "
        "A CSAT rating plus optional comment is a customer message about whether the "
        "staff resolution held. Judge reopen vs silence from that meaning (comment and "
        "rating together). Never treat the number as a rule. Satisfied or unclear "
        "feedback without an unresolved-issue meaning → needed=false. If they still "
        "have the problem or the resolution failed → reopen_ticket when seed is "
        "Resolved or Closed. "
        "No password-reset or unlock playbooks.",
        f"channel={channel}\n"
        f"seed_ticket_number={seed_tn or '(none — resolve from conversation)'}\n"
        f"seed_status={hint_status}\n"
        f"seed_subject={hint_subject}\n"
        f"customer_tickets:\n{tickets_blob}\n"
        f"conversation:\n{history_blob or '(no prior turns)'}\n"
        f"latest_customer_message={customer_msg}",
    )

    if not flag_true(obj, "needed"):
        return None
    action = str(obj.get("action") or "").strip().lower()
    if action not in _ACTIONS:
        return None

    tn = _normalize_ticket_number(obj.get("ticket_number") or seed_tn)
    if not tn:
        return None

    ticket: dict[str, Any] = dict(payload)
    try:
        from app.tools.ticket_read import get_ticket
        from app.proactive.retrieval import ticket_from_tool

        ticket = ticket_from_tool(get_ticket(tn), ticket)
    except Exception:
        pass

    listed_status = ""
    rows = payload.get("customer_tickets") or payload.get("tickets") or []
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            if _normalize_ticket_number(
                row.get("ticket_number") or row.get("id") or row.get("number")
            ) == tn:
                listed_status = str(row.get("status") or "").strip()
                break
    current_status = str(
        ticket.get("status") or hint_status or listed_status or ""
    ).strip()
    cur_l = current_status.lower()
    if action == "close_ticket" and cur_l == "closed":
        return None
    if action == "close_ticket" and cur_l != "resolved":
        return None
    if action == "reopen_ticket" and cur_l not in {"resolved", "closed"}:
        return None

    status = _normalize_status(action, str(obj.get("status") or ""))
    if action == "close_ticket":
        status = "Closed"
    if action == "reopen_ticket":
        status = "Reopened"

    rationale = str(obj.get("rationale") or "").strip()
    summary = (
        f"ARA: close {tn} → {status}"
        if action == "close_ticket"
        else f"ARA: reopen {tn} → {status}"
    )
    if rationale:
        summary = f"{summary} — {rationale[:160]}"

    return Proposal(
        agent_id="ara",
        organization_id=org,
        ticket_id=str(event.get("ticket_id") or ticket.get("id") or ""),
        ticket_number=tn,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="ACTION_PROPOSAL",
        risk_level="high" if action == "close_ticket" else "low",
        confidence=confidence_of(obj, 0.55),
        tool_name="update_ticket",
        tool_args={"ticket_number": tn, "status": status},
        summary=summary,
        payload={
            "llm": obj,
            "action": action,
            "customer_message": customer_msg,
            "prior_status": current_status,
            "channel": channel,
        },
    )
