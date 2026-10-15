"""TCAA — Ticket Creation & Capture (inbound email/chat/widget)."""

from __future__ import annotations

from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, run_agent_llm

SPEC = AgentSpec(
    agent_id="tcaa",
    trigger=("inbound.message",),
    inputs_required=("organization_id", "text"),
    tools_used=frozenset({"create_ticket", "list_customers", "list_tickets", "list_kb"}),
    output_type="ACTION_PROPOSAL",
    risk_level="low",
    confidence_threshold=0.55,
    audit_event="proactive.tcaa",
    full_name="Ticket Creation and Capture Agent",
)


def _rows_from_tool(result: dict[str, Any] | None, *keys: str) -> list[dict[str, Any]]:
    if not isinstance(result, dict):
        return []
    payload = result.get("payload")
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return [row for row in data if isinstance(row, dict)]
        for key in keys:
            rows = payload.get(key)
            if isinstance(rows, list):
                return [row for row in rows if isinstance(row, dict)]
    return []


def _customer_tickets(name: str, email: str) -> list[dict[str, Any]]:
    key = (email or name or "").strip()
    if not key:
        return []
    try:
        from app.tools.ticket_read import list_tickets

        return _rows_from_tool(list_tickets(customer=key, limit=20), "tickets", "items")
    except Exception:
        return []


def _same_open_ticket(
    *,
    issue: str,
    tickets: list[dict[str, Any]],
) -> dict[str, Any]:
    compact = []
    for row in tickets[:20]:
        compact.append(
            {
                "ticket_number": row.get("ticket_number") or row.get("ticketNumber") or row.get("id"),
                "subject": row.get("subject") or row.get("title") or "",
                "status": row.get("status") or "",
                "description": str(row.get("description") or row.get("issue") or "")[:240],
            }
        )
    return run_agent_llm(
        "tcaa",
        "You compare one inbound issue to listed tickets for the same customer. "
        "Return JSON keys: same_open_ticket (boolean), ticket_number (string from "
        "the list or empty), confidence (0-1). same_open_ticket is true only when "
        "a listed ticket is still open (use that row's status) and is the same "
        "issue. Never invent a ticket_number.",
        f"Issue: {issue}\nTickets: {compact}",
    )


def propose(event: dict[str, Any]) -> Proposal | None:
    payload = event.get("payload") or {}
    text = str(payload.get("text") or payload.get("body") or "").strip()
    org = str(event.get("organization_id") or "")
    if not text or not org:
        return None
    if payload.get("skip_create"):
        return None
    obj = run_agent_llm(
        "tcaa",
        "Extract a support ticket from inbound text. Return JSON with keys: "
        "customerName, customerEmail, subject, description, channel, confidence (0-1).",
        text,
    )
    conf = confidence_of(obj, 0.5)
    args = {
        "customerName": obj.get("customerName") or payload.get("customerName") or "Unknown",
        "customerEmail": obj.get("customerEmail") or payload.get("customerEmail") or "",
        "subject": obj.get("subject") or text[:80],
        "description": obj.get("description") or text,
        "channel": obj.get("channel") or payload.get("channel") or "Email",
    }
    existing = _customer_tickets(str(args["customerName"]), str(args["customerEmail"]))
    if existing:
        from app.proactive.llm_json import flag_true

        verdict = _same_open_ticket(issue=str(args["description"]), tickets=existing)
        if flag_true(verdict, "same_open_ticket"):
            listed = str(verdict.get("ticket_number") or "").strip()
            grounded = ""
            for row in existing:
                tn = str(
                    row.get("ticket_number") or row.get("ticketNumber") or row.get("id") or ""
                ).strip()
                if listed and tn and listed.lstrip("#") == tn.lstrip("#"):
                    grounded = tn
                    break
            if grounded:
                return Proposal(
                    agent_id="tcaa",
                    organization_id=org,
                    event_id=event.get("id") or event.get("event_id"),
                    event_type=event.get("event_type"),
                    output_type="RECOMMENDATION",
                    risk_level="low",
                    confidence=confidence_of(verdict, conf),
                    tool_name=None,
                    tool_args={},
                    summary=f"Same open ticket {grounded} — did not create a new ticket.",
                    payload={"existing_ticket": grounded, "extracted": obj},
                )
    return Proposal(
        agent_id="tcaa",
        organization_id=org,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="ACTION_PROPOSAL",
        risk_level="low",
        confidence=conf,
        tool_name="create_ticket",
        tool_args=args,
        summary=f"Create ticket: {args['subject']}",
        payload={"extracted": obj},
    )
