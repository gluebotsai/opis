"""ITRA — Intelligent Ticket Routing.

Owns assignee / resolver for create, reassign, and proactive ticket.created.
LLM picks L1/L2 from the live roster using issue + listed skills only.
If the LLM fails, invents names, or finds no skill match, leave L1/L2 empty
— no deterministic / random / workload scorer fill. Never invents people.
WLOA is scheduled tips — not create-time assign.
"""

from __future__ import annotations

from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, run_agent_llm

SPEC = AgentSpec(
    agent_id="itra",
    trigger=("ticket.created", "icpa.completed"),
    inputs_required=("organization_id", "ticket_number"),
    tools_used=frozenset(
        {
            "get_ticket",
            "update_ticket",
            "auto_assign_ticket",
            "list_agents",
            "list_queues",
            "list_tickets",
        }
    ),
    output_type="ACTION_PROPOSAL",
    risk_level="low",
    confidence_threshold=0.55,
    audit_event="proactive.itra",
    full_name="Intelligent Routing Agent",
)


def _parse_skills(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(s).strip() for s in raw if str(s).strip()]
    if isinstance(raw, str) and raw.strip():
        return [s.strip() for s in raw.split(",") if s.strip()]
    return []


def _person_skills(
    person: dict[str, Any],
    skills_map: dict[str, list[str]],
) -> list[str]:
    aid = str(person.get("id") or "").strip()
    return list(skills_map.get(aid) or _parse_skills(person.get("skills")) or [])


def _hits_from_routing_hints(
    hints: dict[str, Any] | None,
    *,
    agent_pool: list[dict[str, Any]],
    resolver_pool: list[dict[str, Any]],
    skills_map: dict[str, list[str]],
    workload_l1: dict[str, int],
    workload_l2: dict[str, int],
    exclude_user_id: str | None,
    need_agent: bool,
    need_resolver: bool,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Roster-validate ICPA triage picks before a second ITRA LLM call."""
    if not isinstance(hints, dict) or not hints:
        return None, None
    exclude = str(exclude_user_id or "").strip()
    agent_hit = None
    resolver_hit = None
    if need_agent and hints.get("agent"):
        agent_hit = _match_roster_person(
            str(hints.get("agent") or ""),
            agent_pool,
            skills_map=skills_map,
            workload=workload_l1,
        )
        if exclude and agent_hit and str(agent_hit.get("id")) == exclude:
            agent_hit = None
    if need_resolver and hints.get("resolver"):
        resolver_hit = _match_roster_person(
            str(hints.get("resolver") or ""),
            resolver_pool,
            skills_map=skills_map,
            workload=workload_l2,
        )
    if (
        agent_hit
        and resolver_hit
        and str(agent_hit.get("id")) == str(resolver_hit.get("id"))
    ):
        resolver_hit = None
    return agent_hit, resolver_hit


def _skill_roster_fallback(
    *,
    organization_id: str,
    skill_hint: str,
    queue: str,
    team: dict[str, Any] | None,
    agents: list[dict[str, Any]],
    skills_map: dict[str, list[str]],
    workload_l1: dict[str, int],
    workload_l2: dict[str, int],
    need_agent: bool,
    need_resolver: bool,
    exclude_user_id: str | None,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Validated skill/workload pick when ITRA LLM returns no roster match."""
    from app.tasks.assign import pick_assignee

    agent_hit = None
    resolver_hit = None
    skill = str(skill_hint or queue or "").strip()

    if need_agent:
        pick = pick_assignee(
            org_id=organization_id,
            skill=skill,
            queue=queue,
            agents=agents,
            skills_map=skills_map,
            team=team,
            prefer_agents=True,
            exclude_user_id=exclude_user_id,
            workload=workload_l1,
        )
        name = str(pick.get("assignee") or "").strip()
        if name and name.lower() != "unassigned":
            agent_hit = {
                "id": str(pick.get("assignee_id") or "").strip(),
                "name": name,
                "role": "agent",
                "skills": list(skills_map.get(str(pick.get("assignee_id") or ""), [])),
                "open_workload": 0,
                "confidence": float(pick.get("confidence") or 0.75),
            }
    if need_resolver:
        pick = pick_assignee(
            org_id=organization_id,
            skill=skill,
            queue=queue,
            agents=agents,
            skills_map=skills_map,
            team=team,
            prefer_resolvers=True,
            exclude_user_id=exclude_user_id,
            workload=workload_l2,
        )
        name = str(pick.get("assignee") or "").strip()
        if name and name.lower() != "unassigned":
            resolver_hit = {
                "id": str(pick.get("assignee_id") or "").strip(),
                "name": name,
                "role": "resolver",
                "skills": list(skills_map.get(str(pick.get("assignee_id") or ""), [])),
                "open_workload": 0,
                "confidence": float(pick.get("confidence") or 0.75),
            }
    if (
        agent_hit
        and resolver_hit
        and str(agent_hit.get("id")) == str(resolver_hit.get("id"))
    ):
        resolver_hit = None
    return agent_hit, resolver_hit


def _match_roster_person(
    name: str | None,
    pool: list[dict[str, Any]],
    *,
    skills_map: dict[str, list[str]],
    workload: dict[str, int],
) -> dict[str, Any] | None:
    want = str(name or "").strip().lower()
    if not want:
        return None
    for a in pool:
        if not isinstance(a, dict):
            continue
        cand = str(a.get("name") or "").strip()
        if not cand or cand.lower() != want:
            continue
        skills = _person_skills(a, skills_map)
        return {
            "id": str(a.get("id") or "").strip(),
            "name": cand,
            "role": str(a.get("role") or ""),
            "skills": skills,
            "open_workload": int(workload.get(cand, 0) or 0),
            "confidence": 0.85,
        }
    return None


def _wloa_brief_text(brief: dict[str, Any] | None) -> str:
    """Compact WLOA hint for the ITRA LLM. Empty brief is '(none)'."""
    if not isinstance(brief, dict) or not brief:
        return "(none)"
    notes = str(brief.get("notes") or "").strip()
    overloaded = brief.get("overloaded") if isinstance(brief.get("overloaded"), list) else []
    lighter = brief.get("lighter") if isinstance(brief.get("lighter"), list) else []
    as_of = str(brief.get("as_of") or "").strip()
    lines: list[str] = []
    if notes:
        lines.append(f"notes={notes}")
    over_s = ", ".join(str(x).strip() for x in overloaded if str(x).strip())
    if over_s:
        lines.append(f"overloaded={over_s}")
    light_s = ", ".join(str(x).strip() for x in lighter if str(x).strip())
    if light_s:
        lines.append(f"lighter={light_s}")
    if as_of:
        lines.append(f"as_of={as_of}")
    return "\n".join(lines) if lines else "(none)"


def _roster_line(
    person: dict[str, Any],
    *,
    skills_map: dict[str, list[str]],
    workload: dict[str, int],
) -> str:
    name = str(person.get("name") or "").strip()
    role = str(person.get("role") or "").strip()
    skills = _person_skills(person, skills_map)
    open_n = int(workload.get(name, 0) or 0)
    skill_label = ", ".join(skills) if skills else "(none)"
    return (
        f"- {name} | role={role or '—'} | skills={skill_label} "
        f"| open_tickets={open_n}"
    )


def _llm_pick_assignment(
    *,
    issue_blob: str,
    subject: str,
    description: str,
    skill_hint: str,
    queue: str,
    priority: str,
    agent_pool: list[dict[str, Any]],
    resolver_pool: list[dict[str, Any]],
    skills_map: dict[str, list[str]],
    workload_l1: dict[str, int],
    workload_l2: dict[str, int],
    target_role: str,
    exclude_user_id: str | None,
    wloa_brief: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """LLM chooses L1/L2 from roster lines; None if unusable."""
    need_agent = target_role != "resolver"
    need_resolver = target_role != "agent"
    exclude = str(exclude_user_id or "").strip()
    agent_lines = [
        _roster_line(a, skills_map=skills_map, workload=workload_l1)
        for a in (agent_pool or [])
        if isinstance(a, dict)
        and str(a.get("name") or "").strip()
        and (not exclude or str(a.get("id") or "").strip() != exclude)
    ]
    resolver_lines = [
        _roster_line(a, skills_map=skills_map, workload=workload_l2)
        for a in (resolver_pool or [])
        if isinstance(a, dict) and str(a.get("name") or "").strip()
    ]
    if need_agent and not agent_lines:
        return None
    if need_resolver and not resolver_lines and not need_agent:
        return None

    system = (
        "You are ITRA (Intelligent Ticket Routing) for Worktual ticketing.\n"
        "Pick the L1 agent and L2 resolver whose listed skills match this ticket.\n"
        "Return ONLY a JSON object with keys: agent (exact L1 name or empty), "
        "resolver (exact L2 name or empty), confidence (0-1), rationale (short).\n"
        "Rules:\n"
        "- Assign ONLY by skill overlap with the issue and skill_hint. "
        "The rationale must name the matching skill(s).\n"
        "- WLOA load brief is a hint among people who already match skills. "
        "Never pick a WLOA name that lacks a skill match. WLOA never assigns.\n"
        "- Never leave a role empty because of workload, open_tickets, or WLOA. "
        "If at least one person in that role's list has a skill match, you MUST "
        "name one of them. Use the live L1/L2 candidate counts — when that "
        "skill-matched set has one person, assign them even if they look busy.\n"
        "- Do not pick by name order, team membership alone, or to fill a slot.\n"
        "- Do not treat missing skills or '(none)' as a match. Do not invent General.\n"
        "- If two or more skill-matched people exist, you may prefer the lighter "
        "person from the WLOA brief or lower open_tickets.\n"
        "- Leave a role empty only when that role's list is empty or nobody "
        "there has a skill match — never because they are overloaded.\n"
        "- agent MUST be copied exactly from the Agents list (or empty).\n"
        "- resolver MUST be copied exactly from the Resolvers list (or empty).\n"
        "- Never invent names. Prefer different people for L1 and L2 when possible."
    )
    user = (
        f"priority={priority or 'medium'}\n"
        f"queue/team={queue or '(none)'}\n"
        f"skill_hint={skill_hint or '(none)'}\n"
        f"subject={subject or '(none)'}\n"
        f"description={description or '(none)'}\n"
        f"issue_blob={issue_blob or '(none)'}\n"
        f"need_L1_agent={need_agent}\n"
        f"need_L2_resolver={need_resolver}\n"
        f"L1_agent_candidate_count={len(agent_lines)}\n"
        f"L2_resolver_candidate_count={len(resolver_lines)}\n"
        "WLOA load brief (hint only; skill match is required):\n"
        + _wloa_brief_text(wloa_brief)
        + "\nAgents (L1 candidates):\n"
        + ("\n".join(agent_lines) if agent_lines else "(none)")
        + "\nResolvers (L2 candidates):\n"
        + ("\n".join(resolver_lines) if resolver_lines else "(none)")
    )
    obj = run_agent_llm("itra", system, user)
    if not obj:
        return None

    agent_hit = None
    resolver_hit = None
    if need_agent:
        agent_hit = _match_roster_person(
            obj.get("agent"),
            agent_pool,
            skills_map=skills_map,
            workload=workload_l1,
        )
        if exclude and agent_hit and str(agent_hit.get("id")) == exclude:
            agent_hit = None
    if need_resolver:
        resolver_hit = _match_roster_person(
            obj.get("resolver"),
            resolver_pool,
            skills_map=skills_map,
            workload=workload_l2,
        )
        if (
            agent_hit
            and resolver_hit
            and str(agent_hit.get("id")) == str(resolver_hit.get("id"))
        ):
            resolver_hit = None

    if need_agent and not agent_hit and need_resolver and not resolver_hit:
        return None
    if need_agent and not agent_hit and not need_resolver:
        return None
    if need_resolver and not resolver_hit and not need_agent:
        return None

    conf = confidence_of(obj, 0.75)
    rationale = str(obj.get("rationale") or "").strip() or "ITRA LLM roster fit"
    return {
        "agent_hit": agent_hit,
        "resolver_hit": resolver_hit,
        "confidence": conf,
        "rationale": rationale,
        "via": "itra-llm",
    }


def route_assignment(
    *,
    organization_id: str,
    issue: str = "",
    subject: str = "",
    description: str = "",
    skill_hint: str = "",
    queue: str = "",
    priority: str = "medium",
    target_role: str | None = None,
    exclude_user_id: str | None = None,
    agents: list[dict[str, Any]] | None = None,
    skills_map: dict[str, list[str]] | None = None,
    team: dict[str, Any] | None = None,
    routing_hints: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Suggest L1 agent and/or L2 resolver — LLM skill match only from roster.

    Never invents names. Empty roles stay empty when LLM fails or finds no
    skill match. No code/random scorer. WLOA may share a load brief; this
    executor still assigns. Create-time assign stays here (WLOA does not assign).
    """
    org = str(organization_id or "").strip()
    if not org:
        return {
            "agent": None,
            "agent_id": None,
            "resolver": None,
            "resolver_id": None,
            "rationale": "ITRA: organization_id required",
            "confidence": 0.0,
            "via": "itra",
            "weights_applied": False,
        }

    from app.tasks.assign import (
        agents_for_team,
        list_org_agents,
        list_org_teams,
        match_team_by_name,
        open_workload_by_assignee,
        open_workload_by_resolver,
        org_skills_by_user,
        _parse_member_ids,
    )

    resolved_agents = agents if agents is not None else list_org_agents(org)
    resolved_skills = (
        skills_map if skills_map is not None else org_skills_by_user(org)
    )
    teams = list_org_teams(org)
    for t in teams:
        t["member_ids"] = _parse_member_ids(t.get("member_ids"))
        t["queue_name"] = t.get("name")
    resolved_team = team
    if resolved_team is None and queue:
        resolved_team = match_team_by_name(queue, teams)
    pool = agents_for_team(resolved_team, resolved_agents)
    if not pool:
        pool = list(resolved_agents)

    agent_pool = [a for a in pool if str(a.get("role") or "").lower() == "agent"]
    resolver_pool = [a for a in pool if str(a.get("role") or "").lower() == "resolver"]
    if not agent_pool:
        agent_pool = [a for a in resolved_agents if str(a.get("role") or "").lower() == "agent"]
    if not resolver_pool:
        resolver_pool = [
            a for a in resolved_agents if str(a.get("role") or "").lower() == "resolver"
        ]

    try:
        workload_l1 = open_workload_by_assignee(org)
    except Exception:  # noqa: BLE001
        workload_l1 = {}
    try:
        workload_l2 = open_workload_by_resolver(org)
    except Exception:  # noqa: BLE001
        workload_l2 = {}

    wloa_brief: dict[str, Any] = {}
    try:
        from app.proactive.store import get_wloa_brief

        got = get_wloa_brief(org)
        if isinstance(got, dict):
            wloa_brief = got
    except Exception:  # noqa: BLE001
        wloa_brief = {}

    issue_blob = " ".join(
        x for x in (skill_hint, queue, subject, description, issue) if str(x or "").strip()
    ).strip()
    hint = (skill_hint or queue or subject or issue or "").strip()

    role = str(target_role or "").strip().lower()
    if role in {"", "any", "all"}:
        role = ""
    need_agent = role != "resolver"
    need_resolver = role != "agent"

    agent_hit: dict[str, Any] | None = None
    resolver_hit: dict[str, Any] | None = None
    via = "itra-llm"
    llm_rationale = ""
    llm_conf: float | None = None

    hint_agent, hint_resolver = _hits_from_routing_hints(
        routing_hints,
        agent_pool=agent_pool or pool,
        resolver_pool=resolver_pool or [],
        skills_map=resolved_skills or {},
        workload_l1=workload_l1,
        workload_l2=workload_l2,
        exclude_user_id=exclude_user_id,
        need_agent=need_agent,
        need_resolver=need_resolver,
    )
    if hint_agent or hint_resolver:
        agent_hit = hint_agent or agent_hit
        resolver_hit = hint_resolver or resolver_hit
        via = "icpa-hints"
        llm_rationale = "ICPA triage roster pick"

    llm = _llm_pick_assignment(
        issue_blob=issue_blob,
        subject=subject,
        description=description,
        skill_hint=hint,
        queue=queue,
        priority=str(priority or "medium"),
        agent_pool=agent_pool or pool,
        resolver_pool=resolver_pool or [],
        skills_map=resolved_skills or {},
        workload_l1=workload_l1,
        workload_l2=workload_l2,
        target_role=role,
        exclude_user_id=exclude_user_id,
        wloa_brief=wloa_brief,
    )
    if llm:
        llm_agent = llm.get("agent_hit") if isinstance(llm.get("agent_hit"), dict) else None
        llm_resolver = (
            llm.get("resolver_hit") if isinstance(llm.get("resolver_hit"), dict) else None
        )
        if llm_agent:
            agent_hit = llm_agent
        if llm_resolver:
            resolver_hit = llm_resolver
        via = str(llm.get("via") or "itra-llm")
        llm_rationale = str(llm.get("rationale") or "")
        try:
            llm_conf = float(llm.get("confidence") or 0)
        except (TypeError, ValueError):
            llm_conf = 0.75

    missing_agent = need_agent and not agent_hit
    missing_resolver = need_resolver and not resolver_hit
    if missing_agent or missing_resolver:
        fb_agent, fb_resolver = _skill_roster_fallback(
            organization_id=org,
            skill_hint=hint,
            queue=queue,
            team=resolved_team,
            agents=resolved_agents,
            skills_map=resolved_skills or {},
            workload_l1=workload_l1,
            workload_l2=workload_l2,
            need_agent=missing_agent,
            need_resolver=missing_resolver,
            exclude_user_id=exclude_user_id,
        )
        if fb_agent:
            agent_hit = fb_agent
            if via == "itra-llm" and not llm_rationale:
                llm_rationale = "ITRA skill/workload roster fallback"
            via = "itra-skill-fallback"
        if fb_resolver:
            resolver_hit = fb_resolver
            if via == "itra-llm" and not llm_rationale:
                llm_rationale = "ITRA skill/workload roster fallback"
            via = "itra-skill-fallback"

    bits: list[str] = []
    if agent_hit:
        bits.append(
            f"L1 {agent_hit['name']} (skills={', '.join(agent_hit.get('skills') or []) or '—'}; "
            f"open={agent_hit.get('open_workload')})"
        )
    if resolver_hit:
        bits.append(
            f"L2 {resolver_hit['name']} (skills={', '.join(resolver_hit.get('skills') or []) or '—'}; "
            f"open={resolver_hit.get('open_workload')})"
        )
    if llm_rationale:
        rationale = llm_rationale
        if bits:
            rationale = f"{llm_rationale}; {'; '.join(bits)}"
    elif agent_hit or resolver_hit:
        rationale = "ITRA LLM roster fit" + (f": {'; '.join(bits)}" if bits else "")
    else:
        rationale = "ITRA LLM: no valid L1/L2 roster pick (left unassigned)"
    conf_vals = [
        float(x.get("confidence") or 0)
        for x in (agent_hit, resolver_hit)
        if isinstance(x, dict)
    ]
    if llm_conf is not None:
        conf_vals.append(llm_conf)
    confidence = max(conf_vals) if conf_vals else 0.0

    return {
        "agent": str(agent_hit["name"]) if agent_hit else None,
        "agent_id": str(agent_hit["id"]) if agent_hit else None,
        "resolver": str(resolver_hit["name"]) if resolver_hit else None,
        "resolver_id": str(resolver_hit["id"]) if resolver_hit else None,
        "agent_skills": list((agent_hit or {}).get("skills") or []),
        "resolver_skills": list((resolver_hit or {}).get("skills") or []),
        "skill": hint or queue or None,
        "rationale": rationale,
        "confidence": confidence,
        "via": via,
        "weights_applied": False,
        "routing": {
            "agent": agent_hit,
            "resolver": resolver_hit,
            "skill_hint": hint,
            "queue": queue,
        },
    }


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    tn = str(event.get("ticket_number") or (event.get("payload") or {}).get("ticket_number") or "")
    if not org or not tn:
        return None
    payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
    ticket: dict[str, Any] = {}
    try:
        from app.tools.ticket_read import get_ticket
        from app.proactive.retrieval import ticket_from_tool

        ticket = ticket_from_tool(get_ticket(tn), payload)
    except Exception:  # noqa: BLE001
        ticket = dict(payload or {})

    current = str(ticket.get("assignee") or payload.get("assignee") or "").strip()
    triage_done = bool(payload.get("triage_complete") or payload.get("harness_triage_complete"))
    domain_owned = bool(payload.get("domain_triage_owned")) or (
        not triage_done and payload.get("triage_complete") is False
    )
    # Intake already assigned once — do not run a second ITRA steal/reassign.
    if triage_done and current and current not in ("", "Unassigned") and not domain_owned:
        return Proposal(
            agent_id="itra",
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
            summary="ITRA skipped: intake already assigned",
            payload={"routing": {"assignee": current, "skipped": True}},
        )

    created_by_role = str(
        payload.get("created_by_role") or ticket.get("created_by_role") or ""
    ).strip().lower()
    force_keep_l1 = created_by_role == "agent" and current and current not in (
        "",
        "Unassigned",
    )
    exclude_l1 = (
        str(ticket.get("assignee_id") or ticket.get("assigneeId") or "").strip() or None
    )

    routing_hints = payload.get("icpa_routing_hints")
    if not isinstance(routing_hints, dict):
        routing_hints = None
    routed = route_assignment(
        organization_id=org,
        issue=str(ticket.get("description") or ticket.get("issue") or ""),
        subject=str(ticket.get("subject") or ""),
        description=str(ticket.get("description") or ""),
        skill_hint=str(
            ticket.get("skill")
            or ticket.get("category")
            or payload.get("skill")
            or payload.get("category")
            or ""
        ),
        queue=str(ticket.get("queue") or ticket.get("team") or payload.get("queue") or ""),
        priority=str(ticket.get("priority") or payload.get("priority") or "medium"),
        target_role="resolver" if force_keep_l1 else "",
        exclude_user_id=exclude_l1 if force_keep_l1 else None,
        routing_hints=routing_hints,
    )
    if force_keep_l1:
        routed = {
            **routed,
            "agent": current,
            "agent_id": exclude_l1,
            "rationale": (
                f"{routed.get('rationale') or 'ITRA'}; L1 kept as creating agent"
            ).strip(),
        }

    conf = float(routed.get("confidence") or 0.0)
    if conf < 0.35:
        conf = confidence_of({"confidence": conf}, 0.4)
    assignee = None if force_keep_l1 else str(routed.get("agent") or "").strip()
    resolver = str(routed.get("resolver") or "").strip() or None
    steal = bool(
        assignee and current and current not in ("", "Unassigned") and not force_keep_l1
    )
    # Same person already assigned — still may need resolver.
    if assignee and current and assignee.lower() == current.lower():
        assignee = None
        steal = False
    args: dict[str, Any] = {"ticket_number": tn}
    tool = None
    if assignee:
        args["assignee"] = assignee
        if steal:
            args["steal_assignment"] = True
        tool = "update_ticket"
    if resolver:
        args["resolver"] = resolver
        tool = "update_ticket"
    if not tool:
        return Proposal(
            agent_id="itra",
            organization_id=org,
            ticket_id=str(event.get("ticket_id") or ""),
            ticket_number=tn,
            event_id=event.get("id") or event.get("event_id"),
            event_type=event.get("event_type"),
            output_type="RECOMMENDATION",
            risk_level="low",
            confidence=conf,
            tool_name=None,
            tool_args={"ticket_number": tn},
            summary=routed.get("rationale") or "ITRA: no assignment change",
            payload={"routing": routed, "weights_applied": routed.get("weights_applied")},
        )
    return Proposal(
        agent_id="itra",
        organization_id=org,
        ticket_id=str(event.get("ticket_id") or ""),
        ticket_number=tn,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="ACTION_PROPOSAL",
        risk_level="high" if steal else "low",
        confidence=conf,
        tool_name=tool,
        tool_args=args,
        summary=routed.get("rationale") or "ITRA skill-first assignee suggestion",
        payload={"routing": routed, "weights_applied": bool(routed.get("weights_applied"))},
    )
