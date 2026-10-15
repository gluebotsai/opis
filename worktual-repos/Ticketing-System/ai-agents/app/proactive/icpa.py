"""ICPA — Classification & Prioritization on ticket.created.

When lean create emits ``triage_complete=false``, this executor LLM-enriches
subject + description (same quality as ``enrich_ticket`` / ``categorize_ticket``)
plus priority / category / queue. Assignment stays with ITRA.
"""

from __future__ import annotations

from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, run_agent_llm

SPEC = AgentSpec(
    agent_id="icpa",
    trigger=("ticket.created",),
    inputs_required=("organization_id", "ticket_number"),
    tools_used=frozenset({"get_ticket", "update_ticket", "list_queues", "list_tickets"}),
    output_type="ACTION_PROPOSAL",
    risk_level="low",
    confidence_threshold=0.72,
    audit_event="proactive.icpa",
)


def _lean_needs_enrich(payload: dict[str, Any], ticket: dict[str, Any]) -> bool:
    """True when Domain owns post-insert enrich (lean create)."""
    if payload.get("domain_triage_owned") is True:
        return True
    # Explicit false only — missing key means legacy / pre-triaged create.
    if payload.get("triage_complete") is False:
        return True
    if payload.get("harness_triage_complete") is False:
        return True
    return False


def _triage_enrich_fields(
    *,
    organization_id: str,
    customer_name: str,
    customer_email: str | None,
    customer_phone: str | None,
    issue: str,
) -> dict[str, Any]:
    """Reuse categorize_ticket — same subject/description quality as enrich_ticket."""
    from app.tasks.assign import (
        _parse_member_ids,
        list_org_agents,
        list_org_teams,
        org_skills_by_user,
        open_workload_by_assignee,
        open_workload_by_resolver,
        resolve_org_id,
        roster_text,
        teams_context_text,
    )
    from app.tasks.triage import categorize_ticket

    org_id = resolve_org_id(organization_id)
    teams = list_org_teams(org_id)
    agents = list_org_agents(org_id)
    skills_map = org_skills_by_user(org_id)
    workload = open_workload_by_assignee(org_id)
    l2_workload = open_workload_by_resolver(org_id)
    for t in teams:
        t["member_ids"] = _parse_member_ids(t.get("member_ids"))
        t["queue_name"] = t.get("name")
    team_names = [str(t["name"]) for t in teams if t.get("name")]
    roster = roster_text(
        agents, skills_map, workload, resolver_workload=l2_workload
    )
    teams_ctx = teams_context_text(teams, agents, skills_map)
    agent_pool = [
        a for a in agents if str(a.get("role") or "").lower() == "agent"
    ]
    resolver_pool = [
        a for a in agents if str(a.get("role") or "").lower() == "resolver"
    ]
    return categorize_ticket(
        customer_name=(customer_name or "").strip() or "Customer",
        customer_email=customer_email,
        customer_phone=customer_phone,
        issue=(issue or "").strip() or "Support request",
        team_names=team_names,
        teams_context=teams_ctx,
        roster_text=roster,
        agent_names=[str(a.get("name") or "") for a in agent_pool if a.get("name")],
        resolver_names=[
            str(a.get("name") or "") for a in resolver_pool if a.get("name")
        ],
    )


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    tn = str(event.get("ticket_number") or (event.get("payload") or {}).get("ticket_number") or "")
    if not org or not tn:
        return None
    ticket: dict[str, Any] = {}
    queues: Any = []
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    try:
        from app.tools.ticket_read import get_ticket
        from app.tools.catalog_tools import list_queues
        from app.proactive.retrieval import ticket_from_tool

        ticket = ticket_from_tool(get_ticket(tn), payload)
        queues = (list_queues() or {}).get("payload") or []
    except Exception:
        ticket = dict(payload or {})
        queues = []

    # Pre-insert triage already classified — do not duplicate.
    triage_done = bool(payload.get("triage_complete") or payload.get("harness_triage_complete"))
    existing_priority = str(ticket.get("priority") or payload.get("priority") or "").strip()
    existing_category = str(ticket.get("category") or payload.get("category") or "").strip()
    if triage_done and existing_priority and existing_category and not _lean_needs_enrich(
        payload, ticket
    ):
        return Proposal(
            agent_id="icpa",
            organization_id=org,
            ticket_id=str(event.get("ticket_id") or ""),
            ticket_number=tn,
            event_id=event.get("id") or event.get("event_id"),
            event_type=event.get("event_type"),
            output_type="RECOMMENDATION",
            risk_level="low",
            confidence=1.0,
            tool_name=None,
            tool_args={"ticket_number": tn},
            summary="ICPA skipped: intake already classified and prioritized",
            payload={
                "classification": {
                    "priority": existing_priority,
                    "category": existing_category,
                    "skipped": True,
                }
            },
        )

    issue = str(
        ticket.get("description")
        or payload.get("description")
        or ticket.get("subject")
        or payload.get("subject")
        or ""
    ).strip()
    customer_name = str(
        ticket.get("customerName")
        or ticket.get("customer_name")
        or payload.get("customerName")
        or payload.get("customer_name")
        or "Customer"
    ).strip()
    customer_email = str(
        ticket.get("customerEmail")
        or ticket.get("customer_email")
        or payload.get("customerEmail")
        or ""
    ).strip() or None
    customer_phone = str(
        ticket.get("customerPhone")
        or ticket.get("customer_phone")
        or payload.get("customerPhone")
        or ""
    ).strip() or None

    # Lean / Domain-owned: full enrich (subject+description+priority+category+queue).
    if _lean_needs_enrich(payload, ticket):
        try:
            triage = _triage_enrich_fields(
                organization_id=org,
                customer_name=customer_name,
                customer_email=customer_email,
                customer_phone=customer_phone,
                issue=issue,
            )
        except Exception:  # noqa: BLE001
            triage = {}
        if triage:
            args: dict[str, Any] = {"ticket_number": tn}
            if triage.get("subject"):
                args["subject"] = triage["subject"]
            if triage.get("description"):
                args["description"] = triage["description"]
            if triage.get("priority"):
                args["priority"] = triage["priority"]
            category = str(triage.get("category") or triage.get("skill") or "").strip()
            if category:
                args["category"] = category
            if triage.get("queue"):
                args["queue"] = triage["queue"]
            conf = 0.85 if triage.get("enrichedByAi") else 0.78
            return Proposal(
                agent_id="icpa",
                organization_id=org,
                ticket_id=str(event.get("ticket_id") or ""),
                ticket_number=tn,
                event_id=event.get("id") or event.get("event_id"),
                event_type=event.get("event_type"),
                output_type="ACTION_PROPOSAL",
                risk_level="low",
                confidence=conf,
                tool_name="update_ticket" if len(args) > 1 else None,
                tool_args=args,
                summary="Enrich subject/description and classify ticket",
                payload={
                    "classification": triage,
                    "domain_triage_step": "classify_enrich",
                },
            )

    # Priority/category/queue JSON path (legacy non-lean creates needing ICPA).
    obj = run_agent_llm(
        "icpa",
        "Classify a support ticket. Return JSON: category, priority (low|medium|high|urgent), "
        "sentiment (negative|neutral|positive), queue (team name or empty), confidence (0-1). "
        "Be conservative.",
        f"ticket={ticket}\nqueues={queues}\nissue={issue}",
    )
    conf = confidence_of(obj, 0.4)
    args = {"ticket_number": tn}
    if obj.get("priority"):
        args["priority"] = obj["priority"]
    if obj.get("category"):
        args["category"] = obj["category"]
    if obj.get("queue"):
        args["queue"] = obj["queue"]
    return Proposal(
        agent_id="icpa",
        organization_id=org,
        ticket_id=str(event.get("ticket_id") or ""),
        ticket_number=tn,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="ACTION_PROPOSAL",
        risk_level="low",
        confidence=conf,
        tool_name="update_ticket" if len(args) > 1 else None,
        tool_args=args,
        summary="Classify and prioritize ticket",
        payload={"classification": obj},
    )
