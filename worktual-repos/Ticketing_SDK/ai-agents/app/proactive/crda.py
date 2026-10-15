"""CRDA — Customer response drafting. High risk; never auto-send."""

from __future__ import annotations

from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, run_agent_llm

SPEC = AgentSpec(
    agent_id="crda",
    trigger=("customer.replied", "on_demand.draft"),
    inputs_required=("organization_id", "ticket_number"),
    tools_used=frozenset({"get_ticket", "add_ticket_note", "get_ticket_progress"}),
    output_type="ACTION_PROPOSAL",
    risk_level="high",
    confidence_threshold=0.5,
    audit_event="proactive.crda",
    full_name="Customer Response Drafting Agent",
)


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    tn = str(event.get("ticket_number") or (event.get("payload") or {}).get("ticket_number") or "")
    if not org or not tn:
        return None
    ticket: dict[str, Any] = event.get("payload") or {}
    try:
        from app.tools.ticket_read import get_ticket, get_ticket_progress
        from app.proactive.retrieval import ticket_from_tool

        ticket = ticket_from_tool(get_ticket(tn), ticket)
        progress = (get_ticket_progress(tn) or {}).get("payload") or {}
    except Exception:
        progress = {}
    obj = run_agent_llm(
        "crda",
        "Draft a customer reply. Return JSON: draft, confidence (0-1). Never send it.",
        f"ticket={ticket}\nprogress={progress}\ncustomer_message={(event.get('payload') or {}).get('text')}",
    )
    draft = str(obj.get("draft") or "").strip()
    if not draft:
        return None
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    channel = str(payload.get("channel") or "").strip()
    inbound = channel.lower().replace("-", "_")
    tool_args: dict[str, Any] = {
        "ticket_number": tn,
        "text": draft,
        "visibility": "public",
    }
    if inbound == "email":
        tool_args["send_customer_email"] = True
    return Proposal(
        agent_id="crda",
        organization_id=org,
        ticket_id=str(event.get("ticket_id") or ""),
        ticket_number=tn,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="ACTION_PROPOSAL",
        risk_level="high",
        confidence=confidence_of(obj, 0.6),
        tool_name="add_ticket_note",
        tool_args=tool_args,
        summary="Draft customer reply (approval required to send)",
        payload={"draft": draft, "channel": channel or None},
    )
