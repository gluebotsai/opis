"""PNA — Personalized notifications → nav bell inbox (never Approvals).

Preferences are a hard gate; dedup per event/user. ASGA always executes
``send_staff_notification`` so staff see informational alerts in the header
bell — not Confirm/Reject in the Approvals module.

Recipients come from the event payload (assignee / resolver / notify_user_ids).
On ``ticket.created``, Express also includes org admins so creators who are
admins still see the ping in their own bell (Express assignment mail excludes
the actor).
"""

from __future__ import annotations

from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, run_agent_llm

SPEC = AgentSpec(
    agent_id="pna",
    trigger=(
        "ticket.created",
        "ticket.updated",
        "ticket.comment_added",
        "customer.replied",
        "resolver.status_changed",
        "ticket.sla_at_risk",
    ),
    inputs_required=("organization_id",),
    tools_used=frozenset({"send_staff_notification", "list_notifications", "get_ticket"}),
    output_type="ACTION_PROPOSAL",
    # Informational only: preference-gated + deduped → bell inbox, never Approvals.
    risk_level="low",
    confidence_threshold=0.4,
    audit_event="proactive.pna",
)

_seen: set[str] = set()


def _recipient_ids(payload: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    raw = payload.get("notify_user_ids")
    if isinstance(raw, (list, tuple)):
        for item in raw:
            uid = str(item or "").strip()
            if uid:
                ids.append(uid)
    for key in ("notify_user_id", "assignee_id", "resolver_id"):
        uid = str(payload.get(key) or "").strip()
        if uid:
            ids.append(uid)
    # Preserve order, drop empties/dupes.
    return list(dict.fromkeys(ids))


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    payload = event.get("payload") or {}
    if not isinstance(payload, dict):
        payload = {}
    if not org:
        return None
    if payload.get("opt_out") is True or payload.get("preference_enabled") is False:
        return None

    recipients = _recipient_ids(payload)
    et = str(event.get("event_type") or "")
    tid = str(event.get("ticket_id") or "")
    fresh: list[str] = []
    for uid in recipients:
        dedup = f"{org}:{et}:{tid}:{uid}"
        if dedup in _seen:
            continue
        _seen.add(dedup)
        fresh.append(uid)
    if not fresh:
        return None

    obj = run_agent_llm(
        "pna",
        "Write a short staff notification. Return JSON: title, message, kind "
        "(assignment|update|sla|product), confidence. Respect opt-out (already gated).",
        f"event={et} payload={payload}",
    )
    title = str(obj.get("title") or "Ticket update")
    message = str(
        obj.get("message")
        or payload.get("message")
        or payload.get("subject")
        or "A ticket you follow changed."
    )
    kind = str(obj.get("kind") or ("assignment" if et == "ticket.created" else "update"))
    return Proposal(
        agent_id="pna",
        organization_id=org,
        ticket_id=tid or None,
        ticket_number=event.get("ticket_number"),
        event_id=event.get("id") or event.get("event_id"),
        event_type=et,
        output_type="ACTION_PROPOSAL",
        risk_level="low",
        confidence=confidence_of(obj, 0.6),
        tool_name="send_staff_notification",
        tool_args={
            "user_id": fresh[0],
            "user_ids": fresh,
            "title": title,
            "message": message,
            "kind": kind,
            "ticket_uuid": event.get("ticket_id"),
            "customer_name": payload.get("customer_name"),
        },
        summary=title,
        payload={"llm": obj, "recipients": fresh},
    )
