"""Orchestrate categorize → team → dual Agent (L1) + Resolver (L2) assign."""

from __future__ import annotations

from app.tasks.assign import (
    _parse_member_ids,
    list_org_agents,
    list_org_teams,
    match_team_by_name,
    open_workload_by_assignee,
    open_workload_by_resolver,
    org_skills_by_user,
    resolve_org_id,
    roster_text,
    teams_context_text,
)
from app.tasks.schemas import TriageAssignRequest, TriageAssignResponse
from app.tasks.triage import categorize_ticket
from app.triage_api_client import _use_api, fetch_triage_context


def _load_triage_snapshot(org_id: str) -> dict | None:
    if not _use_api():
        return None
    try:
        return fetch_triage_context(org_id)
    except Exception:
        return None


def run_triage_assign(req: TriageAssignRequest) -> TriageAssignResponse:
    org_id = resolve_org_id(req.organization_id)
    snapshot = _load_triage_snapshot(org_id)
    if snapshot:
        teams = snapshot.get("teams") or []
        agents = snapshot.get("agents") or []
        skills_map = snapshot.get("skillsByUser") or {}
        workload = snapshot.get("workloadAssignee") or {}
        l2_workload = snapshot.get("workloadResolver") or {}
    else:
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

    empty = TriageAssignResponse(
        subject="",
        description="",
        priority="medium",
        assignee="Unassigned",
        queue="",
        channel="Web",
        rationale="",
        enrichedByAi=False,
        category="",
        skill="",
        assignee_id=None,
        resolver=None,
        resolver_id=None,
        resolver_confidence=None,
    )

    if not team_names:
        from app.tasks.triage import llm_compose_ticket_copy

        issue = req.issue.strip() or "Support request"
        copy = llm_compose_ticket_copy(
            customer_name=req.customer_name.strip(),
            customer_email=(req.customer_email or None),
            customer_phone=(req.customer_phone or None),
            issue=issue,
        )
        if copy:
            empty.subject = str(copy["subject"])
            empty.description = str(copy["description"])
            empty.priority = copy.get("priority") or "medium"
            empty.enrichedByAi = True
            empty.rationale = (
                "No teams configured in MyAccount; LLM wrote subject/description."
            )
        else:
            subject = issue if len(issue) <= 80 else issue[:77].rstrip() + "…"
            empty.subject = subject
            empty.description = f"Customer reported:\n\n{req.issue.strip()}"
            empty.rationale = "No teams configured in MyAccount."
        role = (req.created_by_role or "customer").lower()
        if role == "agent" and (req.force_assignee_id or req.force_assignee_name):
            empty.assignee = str(req.force_assignee_name or "Unassigned")
            empty.assignee_id = (
                str(req.force_assignee_id) if req.force_assignee_id else None
            )
        return empty

    agent_pool = [
        a for a in agents if str(a.get("role") or "").lower() == "agent"
    ]
    resolver_pool = [
        a for a in agents if str(a.get("role") or "").lower() == "resolver"
    ]
    triage = categorize_ticket(
        customer_name=req.customer_name.strip(),
        customer_email=(req.customer_email or None),
        customer_phone=(req.customer_phone or None),
        issue=req.issue.strip(),
        team_names=team_names,
        teams_context=teams_ctx,
        roster_text=roster,
        agent_names=[str(a.get("name") or "") for a in agent_pool if a.get("name")],
        resolver_names=[
            str(a.get("name") or "") for a in resolver_pool if a.get("name")
        ],
    )

    skill = str(triage.get("skill") or "")
    queue = str(triage.get("queue") or "")
    team = match_team_by_name(queue, teams)
    if team is None:
        team = teams[0]
        queue = str(team["name"])
    else:
        queue = str(team["name"])

    rationale = str(triage.get("rationale") or "").strip()
    created_role = (req.created_by_role or "customer").strip().lower()
    if created_role not in ("customer", "admin", "agent"):
        created_role = "customer"

    # --- L1 + L2 via ITRA only (skill-first). Force-creating-agent still wins. ---
    assignee_name = "Unassigned"
    assignee_id: str | None = None
    via_l1 = "none"
    resolver_name: str | None = None
    resolver_id: str | None = None
    resolver_confidence: float | None = None
    if created_role == "agent" and (
        req.force_assignee_id or req.force_assignee_name
    ):
        assignee_name = str(req.force_assignee_name or "").strip() or "Unassigned"
        assignee_id = (
            str(req.force_assignee_id).strip() if req.force_assignee_id else None
        )
        via_l1 = "creating-agent"
        rationale = (
            f"{rationale} L1 assignee forced to creating agent {assignee_name}."
        ).strip()
        # Still use ITRA for L2 resolver when forcing L1.
        from app.proactive.itra import route_assignment

        routed = route_assignment(
            organization_id=org_id,
            issue=req.issue.strip(),
            subject=str(triage.get("subject") or ""),
            description=str(triage.get("description") or ""),
            skill_hint=skill or queue,
            queue=queue,
            priority=str(triage.get("priority") or "medium"),
            target_role="resolver",
            exclude_user_id=assignee_id,
            agents=agents,
            skills_map=skills_map,
            team=team,
        )
        if routed.get("resolver") and routed.get("resolver_id"):
            resolver_name = str(routed["resolver"])
            resolver_id = str(routed["resolver_id"])
            resolver_confidence = float(routed.get("confidence") or 0.0)
            rationale = (
                f"{rationale} L2 resolver assigned by ITRA to {resolver_name}."
            ).strip()
    else:
        from app.proactive.itra import route_assignment

        routed = route_assignment(
            organization_id=org_id,
            issue=req.issue.strip(),
            subject=str(triage.get("subject") or ""),
            description=str(triage.get("description") or ""),
            skill_hint=skill or queue,
            queue=queue,
            priority=str(triage.get("priority") or "medium"),
            agents=agents,
            skills_map=skills_map,
            team=team,
        )
        if routed.get("agent") and routed.get("agent_id"):
            assignee_name = str(routed["agent"])
            assignee_id = str(routed["agent_id"])
            via_l1 = "itra"
            rationale = (
                f"{rationale} L1 assigned by ITRA to {assignee_name}."
            ).strip()
        else:
            via_l1 = "itra-unassigned"
            rationale = (
                f"{rationale} L1 left unassigned (ITRA found no agent on roster)."
            ).strip()
        if routed.get("resolver") and routed.get("resolver_id"):
            resolver_name = str(routed["resolver"])
            resolver_id = str(routed["resolver_id"])
            resolver_confidence = float(routed.get("confidence") or 0.0)
            rationale = (
                f"{rationale} L2 resolver assigned by ITRA to {resolver_name} "
                f"(confidence={resolver_confidence:.2f}; L1 via {via_l1})."
            ).strip()
        else:
            rationale = (
                f"{rationale} L2 resolver left unassigned "
                f"(ITRA found no resolver on roster; L1 via {via_l1})."
            ).strip()

    return TriageAssignResponse(
        subject=str(triage["subject"]),
        description=str(triage["description"]),
        priority=triage["priority"],
        assignee=assignee_name,
        queue=queue,
        channel="Web",
        rationale=rationale,
        enrichedByAi=bool(triage.get("enrichedByAi")),
        category=str(triage.get("category") or skill or queue),
        skill=skill or queue,
        assignee_id=assignee_id,
        resolver=resolver_name,
        resolver_id=resolver_id,
        resolver_confidence=resolver_confidence,
    )
