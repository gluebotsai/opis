"""TCAA — Ticket Creation & Capture (inbound email/chat/widget)."""

from __future__ import annotations

from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, run_agent_llm

SPEC = AgentSpec(
    agent_id="tcaa",
    trigger=("inbound.message",),
    inputs_required=("organization_id", "text"),
    tools_used=frozenset({"create_ticket", "list_customers", "list_kb"}),
    output_type="ACTION_PROPOSAL",
    risk_level="low",
    confidence_threshold=0.55,
    audit_event="proactive.tcaa",
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
