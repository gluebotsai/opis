"""SEMA — SLA & Escalation. LLM over tool-backed remaining SLA (not a silent cron)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, run_agent_llm

SPEC = AgentSpec(
    agent_id="sema",
    trigger=("ticket.updated", "ticket.sla_at_risk", "schedule.sema"),
    inputs_required=("organization_id",),
    tools_used=frozenset(
        {
            "get_ticket",
            "list_tickets",
            "escalate_ticket",
            "update_ticket",
            "send_staff_notification",
            "list_agents",
        }
    ),
    output_type="ACTION_PROPOSAL",
    risk_level="low",
    confidence_threshold=0.65,
    audit_event="proactive.sema",
)

_swept: set[str] = set()
_GENERIC = frozenset({"", "sla check", "ok", "none", "n/a", "no action", "checked"})
_CLOSED = frozenset({"closed", "resolved", "solved", "cancelled", "canceled"})
_NEAR_HOURS = 4.0


def _ticket_map(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        inner = raw.get("payload")
        return inner if isinstance(inner, dict) else raw
    return {}


def _due_iso(ticket: dict[str, Any]) -> str | None:
    due = ticket.get("dueAt") or ticket.get("due_at")
    if due is None:
        return None
    return due.isoformat() if hasattr(due, "isoformat") else str(due).strip() or None


def _hours_left(ticket: dict[str, Any]) -> float | None:
    iso = _due_iso(ticket)
    if not iso:
        return None
    try:
        due = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        return (due - datetime.now(timezone.utc)).total_seconds() / 3600.0
    except ValueError:
        return None


def _status(ticket: dict[str, Any]) -> str:
    return str(ticket.get("status") or "").strip().lower()


def _at_risk(ticket: dict[str, Any]) -> bool:
    if _status(ticket) in _CLOSED:
        return False
    hours = _hours_left(ticket)
    if hours is None:
        return False
    return hours <= _NEAR_HOURS


def _remain_phrase(ticket: dict[str, Any]) -> str | None:
    hours = _hours_left(ticket)
    if hours is None:
        return None
    if hours < 0:
        overdue = abs(hours)
        if overdue < 1:
            return f"overdue by {int(overdue * 60)} minutes"
        return f"overdue by {overdue:.1f} hours"
    if hours < 1:
        return f"{max(1, int(hours * 60))} minutes remaining"
    return f"{hours:.1f} hours remaining"


def _find_ticket(tickets: list[Any], target: str) -> dict[str, Any]:
    want = target.strip().lower()
    for raw in tickets:
        t = _ticket_map(raw)
        tn = str(t.get("ticketNumber") or t.get("ticket_number") or t.get("number") or "").lower()
        if want and tn == want:
            return t
    return _ticket_map(tickets[0]) if tickets else {}


def _advice(obj: dict[str, Any], ticket: dict[str, Any], target: str, action: str) -> str | None:
    rationale = str(obj.get("rationale") or "").strip()
    generic = rationale.lower() in _GENERIC
    risk = _at_risk(ticket) or bool(obj.get("near_breach"))
    if action in {"", "none"} and not risk:
        return None
    if action == "alert" and generic and not risk:
        return None
    remain = _remain_phrase(ticket)
    tn = target or str(ticket.get("ticketNumber") or ticket.get("ticket_number") or "").strip()
    assignee = str(ticket.get("assignee") or obj.get("assignee") or "").strip()
    title_bits = []
    if tn:
        title_bits.append(tn)
    if remain:
        title_bits.append(f"SLA {remain}")
    elif risk:
        title_bits.append("SLA at risk")
    else:
        title_bits.append("SLA needs attention")
    title = " — ".join(title_bits)
    if not generic:
        body = rationale
    elif remain and assignee:
        body = f"Notify {assignee} and act before the due time."
    elif remain:
        body = "Notify the assignee and consider escalating before the due time."
    else:
        body = "Review remaining SLA and escalate if the ticket will miss its due time."
    return f"{title}\n{body}"


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    if not org:
        return None
    tn = str(event.get("ticket_number") or (event.get("payload") or {}).get("ticket_number") or "")
    sweep_key = f"{org}:{tn or event.get('event_type')}"
    if event.get("event_type") == "schedule.sema" and sweep_key in _swept:
        return None
    tickets: list[Any] = []
    try:
        from app.tools.ticket_read import list_tickets, get_ticket
        from app.proactive.retrieval import ticket_from_tool

        if tn:
            tickets = [ticket_from_tool(get_ticket(tn), event.get("payload") or {})]
        else:
            raw = (list_tickets() or {}).get("payload") or []
            tickets = raw if isinstance(raw, list) else []
    except Exception:
        tickets = [event.get("payload") or {}]
    obj = run_agent_llm(
        "sema",
        "Reason about SLA remaining from ticket dueAt/status. Return JSON: "
        "ticket_number, action (alert|reassign|escalate|none), assignee, rationale, "
        "near_breach (boolean), confidence (0-1). "
        "If no ticket is due soon or overdue, action must be none. "
        "rationale must be a specific recommendation (which ticket, time left, what to do). "
        "Never use the words 'SLA check'. Alerts are recommendations; "
        "near-breach reassign/escalate is an action proposal. No predictive ML.",
        f"tickets={tickets}",
    )
    _swept.add(sweep_key)
    action = str(obj.get("action") or "none").lower()
    conf = confidence_of(obj, 0.4)
    target = str(obj.get("ticket_number") or tn or "")
    ticket = _find_ticket(tickets, target)
    if action in {"reassign", "escalate"} and target:
        # Express ticket ids use leading # (same as chat escalate_ticket).
        tn_norm = target.strip()
        if tn_norm and not tn_norm.startswith("#") and tn_norm.lstrip("#").isdigit():
            tn_norm = f"#{tn_norm.lstrip('#')}"
        existing_assignee = str(
            (ticket or {}).get("assignee") or obj.get("current_assignee") or ""
        ).strip()
        # Reassign when someone already owns the ticket is recommend-only
        # (ASGA / high-risk steal must not auto-fire from SEMA).
        if (
            action == "reassign"
            and existing_assignee
            and existing_assignee not in ("", "Unassigned")
        ):
            summary = _advice(obj, ticket, tn_norm, action) or str(
                obj.get("rationale") or action
            )
            return Proposal(
                agent_id="sema",
                organization_id=org,
                ticket_id=str(event.get("ticket_id") or ""),
                ticket_number=tn_norm,
                event_id=event.get("id") or event.get("event_id"),
                event_type=event.get("event_type"),
                output_type="RECOMMENDATION",
                risk_level="high",
                confidence=conf,
                tool_name=None,
                tool_args={"ticket_number": tn_norm, "assignee": obj.get("assignee")},
                summary=summary,
                payload={"llm": obj, "gated": "assignee_present"},
            )
        tool = "escalate_ticket" if action == "escalate" else "update_ticket"
        args: dict[str, Any] = {"ticket_number": tn_norm}
        if action == "reassign" and obj.get("assignee"):
            args["assignee"] = obj["assignee"]
        if action == "escalate":
            if obj.get("assignee"):
                args["assignee"] = obj["assignee"]
            rationale = str(obj.get("rationale") or "").strip()
            if rationale:
                args["rationale"] = rationale
            elif remain := _remain_phrase(ticket):
                args["rationale"] = f"SEMA SLA escalate ({remain})"
            else:
                args["rationale"] = "SEMA SLA escalate"
        target = tn_norm
        summary = _advice(obj, ticket, target, action) or str(obj.get("rationale") or action)
        return Proposal(
            agent_id="sema",
            organization_id=org,
            ticket_id=str(event.get("ticket_id") or ""),
            ticket_number=target,
            event_id=event.get("id") or event.get("event_id"),
            event_type=event.get("event_type"),
            output_type="ACTION_PROPOSAL",
            risk_level="high",
            confidence=conf,
            tool_name=tool,
            tool_args=args,
            summary=summary,
            payload={"llm": obj},
        )
    summary = _advice(obj, ticket, target, action)
    if not summary:
        return None
    return Proposal(
        agent_id="sema",
        organization_id=org,
        ticket_number=target or None,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="RECOMMENDATION",
        risk_level="low",
        confidence=conf,
        summary=summary,
        payload={"llm": obj},
    )
