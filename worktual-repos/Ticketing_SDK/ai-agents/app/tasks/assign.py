"""Skill + workload assignment.

Teams/assignments are Ticketing-owned. Staff identity, role, status, product
access and skills are read live from MyAccount; ticketing.agents is only the FK
mapping. SEED_DEMO is the sole local identity fallback.
"""

from __future__ import annotations

import json
import os
from typing import Any

from app.db import fetch_all

FALLBACK_SKILLS = ["General"]


def _seed_demo_enabled() -> bool:
    return str(os.getenv("SEED_DEMO") or "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def _parse_skills(skill_text: Any, skills_json: Any) -> list[str]:
    """Merge accounts.setup_users.skill (comma text) + skills (jsonb list)."""
    out: list[str] = []
    if skill_text:
        out.extend(s.strip() for s in str(skill_text).split(",") if s.strip())
    values = skills_json
    if isinstance(values, str):
        try:
            values = json.loads(values)
        except (ValueError, TypeError):
            values = None
    if isinstance(values, list):
        for item in values:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
            elif isinstance(item, dict):
                name = str(item.get("name") or item.get("skill") or "").strip()
                if name:
                    out.append(name)
    seen: set[str] = set()
    unique = []
    for s in out:
        key = s.lower()
        if key not in seen:
            seen.add(key)
            unique.append(s)
    return unique


def _parse_member_ids(raw: Any) -> list[str]:
    value = raw
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError):
            return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    if isinstance(value, dict):
        return [str(v).strip() for v in value.values() if str(v).strip()]
    return []


def list_org_teams(org_id: str) -> list[dict[str, Any]]:
    """Active teams from ticketing.agent_queues for this organization."""
    try:
        teams = fetch_all(
            """
            SELECT id::text AS id,
                   queue_name AS name,
                   COALESCE(description, '') AS description,
                   'active' AS status
            FROM agent_queues
            WHERE organization_id = %s
            ORDER BY queue_name
            """,
            (org_id,),
        )
    except Exception:
        return []

    try:
        members = fetch_all(
            """
            SELECT queue_id::text AS queue_id, user_id::text AS user_id
            FROM agent_queue_members
            WHERE organization_id = %s
            """,
            (org_id,),
        )
    except Exception:
        members = []

    by_q: dict[str, list[str]] = {}
    for m in members:
        qid = str(m.get("queue_id") or "")
        uid = str(m.get("user_id") or "")
        if not qid or not uid:
            continue
        by_q.setdefault(qid, []).append(uid)

    for t in teams:
        t["member_ids"] = by_q.get(str(t.get("id") or ""), [])
    return teams


# Back-compat alias used by older call sites
def list_org_queues(org_id: str) -> list[dict[str, Any]]:
    teams = list_org_teams(org_id)
    return [
        {
            "id": t["id"],
            "queue_name": t["name"],
            "type": "Shared",
            "open_tickets": 0,
            "assigned": 0,
            "sla_status": "On Track",
            "description": t.get("description") or "",
            "member_ids": t.get("member_ids") or [],
        }
        for t in teams
    ]


def list_org_agents(
    org_id: str, *, conn: Any | None = None
) -> list[dict[str, Any]]:
    """Active MyAccount staff eligible for Ticketing assignment.

    Returns ticketing.agents.id (never setup_users.id) for assignee FKs.
    """
    try:
        rows = fetch_all(
            """
            SELECT DISTINCT ON (ag.id)
                   ag.id::text AS id,
                   NULLIF(TRIM(COALESCE(au.first_name, '') || ' ' ||
                               COALESCE(au.last_name, '')), '') AS name,
                   lower(au.work_email) AS email,
                   lower(r.name) AS role,
                   'Active' AS status
            FROM ticketing.agents ag
            JOIN accounts.setup_users au ON au.id = ag.setup_user_id
            JOIN accounts.setup_user_product_access a
              ON a.user_id = au.id
             AND a.product_id = 'ticketing'
             AND a.organization_id = ag.organization_id
            JOIN accounts.setup_roles r ON r.id = a.role_id
            WHERE ag.organization_id = %s::bigint
              AND ag.status = 'Active'
              AND lower(COALESCE(au.status, '')) = 'active'
              AND lower(r.name) IN ('agent', 'resolver', 'admin')
            ORDER BY ag.id, name
            """,
            (org_id,),
            conn=conn,
        )
    except Exception:
        rows = []
    if rows or not _seed_demo_enabled():
        return rows
    # SEED_DEMO only: agents bridge still requires an existing setup_users row.
    return fetch_all(
        """
        SELECT ag.id::text AS id,
               NULLIF(TRIM(COALESCE(au.first_name, '') || ' ' ||
                           COALESCE(au.last_name, '')), '') AS name,
               lower(COALESCE(au.work_email, ag.support_email, '')) AS email,
               lower(ag.role) AS role,
               ag.status
        FROM ticketing.agents ag
        JOIN accounts.setup_users au ON au.id = ag.setup_user_id
        WHERE ag.organization_id = %s::bigint
          AND ag.status = 'Active'
          AND ag.role IN ('agent', 'resolver', 'admin')
        ORDER BY name
        """,
        (org_id,),
        conn=conn,
    )


def org_skills_by_user(
    org_id: str, *, conn: Any | None = None
) -> dict[str, list[str]]:
    """Read current MyAccount skills keyed by ticketing.agents.id."""
    try:
        rows = fetch_all(
            """
            SELECT ag.id::text AS id, au.skills
            FROM ticketing.agents ag
            JOIN accounts.setup_users au ON au.id = ag.setup_user_id
            JOIN accounts.setup_user_product_access a
              ON a.user_id = au.id
             AND a.product_id = 'ticketing'
             AND a.organization_id = ag.organization_id
            WHERE ag.organization_id = %s::bigint
              AND ag.status = 'Active'
              AND lower(COALESCE(au.status, '')) = 'active'
            """,
            (org_id,),
            conn=conn,
        )
    except Exception:
        return {}
    result: dict[str, list[str]] = {}
    for r in rows:
        skills = _parse_skills(None, r.get("skills"))
        if skills:
            result[str(r["id"])] = skills
    return result


def teams_context_text(
    teams: list[dict[str, Any]],
    agents: list[dict[str, Any]],
    skills_map: dict[str, list[str]],
) -> str:
    """Human-readable teams + members + skills for the LLM prompt."""
    by_id = {str(a["id"]): a for a in agents}
    lines: list[str] = []
    for t in teams:
        name = str(t.get("name") or t.get("queue_name") or "")
        desc = str(t.get("description") or "").strip()
        member_ids = t.get("member_ids") or _parse_member_ids(t.get("member_ids"))
        member_bits: list[str] = []
        for mid in member_ids:
            agent = by_id.get(str(mid))
            if not agent:
                continue
            skills = skills_map.get(str(mid), FALLBACK_SKILLS)
            member_bits.append(
                f"{agent['name']} ({agent.get('role') or 'staff'}; skills: {', '.join(skills)})"
            )
        members = "; ".join(member_bits) if member_bits else "(no onboarded members)"
        lines.append(
            f"- Team “{name}”"
            + (f" — {desc}" if desc else "")
            + f" | members: {members}"
        )
    return "\n".join(lines) if lines else "(no teams)"


def roster_text(
    agents: list[dict[str, Any]],
    skills_map: dict[str, list[str]] | None = None,
    workload: dict[str, int] | None = None,
    *,
    resolver_workload: dict[str, int] | None = None,
) -> str:
    """Roster lines with skills AND current open workload (L2 uses resolver load)."""
    skills_map = skills_map or {}
    workload = workload or {}
    resolver_workload = resolver_workload or {}
    lines: list[str] = []
    for a in agents:
        name = str(a["name"])
        skills = skills_map.get(str(a["id"]), FALLBACK_SKILLS)
        role = str(a.get("role") or "")
        if str(role).lower() == "resolver":
            open_count = resolver_workload.get(name, 0)
            load_label = "L2 open tickets"
        else:
            open_count = workload.get(name, 0)
            load_label = "open tickets"
        lines.append(
            f"- {name} | role: {role or 'staff'} | skills: {', '.join(skills)} | {load_label}: {open_count}"
        )
    return "\n".join(lines)


def match_agent_by_name(
    name: str, agents: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Validate an LLM-chosen assignee against the real roster."""
    from app.workflow_schemas import resolve_entity, resolve_roster_name

    wanted = (name or "").strip()
    if not wanted:
        return None
    names = [str(a.get("name") or "").strip() for a in agents if str(a.get("name") or "").strip()]
    canonical = resolve_roster_name(wanted, names)
    if canonical:
        wanted = canonical
    wanted_lower = wanted.lower()
    for a in agents:
        if str(a["name"]).strip().lower() == wanted_lower:
            return a
    for a in agents:
        an = str(a["name"]).strip().lower()
        if wanted_lower in an or an in wanted_lower:
            return a
    hit = resolve_entity(wanted, agents, "agent")
    if isinstance(hit, dict) and hit.get("name") and not hit.get("ambiguous"):
        for a in agents:
            if str(a["name"]).strip() == str(hit["name"]).strip():
                return a
    return None


def match_team_by_name(
    name: str, teams: list[dict[str, Any]]
) -> dict[str, Any] | None:
    wanted = (name or "").strip().lower()
    if not wanted:
        return None
    for t in teams:
        tn = str(t.get("name") or t.get("queue_name") or "").strip().lower()
        if tn == wanted:
            return t
    for t in teams:
        tn = str(t.get("name") or t.get("queue_name") or "").strip().lower()
        if wanted in tn or tn in wanted:
            return t
    return None


def open_workload_by_assignee(
    org_id: str, *, conn: Any | None = None
) -> dict[str, int]:
    rows = fetch_all(
        """
        SELECT COALESCE(assignee_name, '') AS assignee_name,
               COUNT(*)::int AS open_count
        FROM tickets
        WHERE organization_id = %s
          AND status IN ('Open', 'Pending', 'In Progress', 'Reopened', 'Overdue')
          AND assignee_name IS NOT NULL
          AND assignee_name <> ''
          AND assignee_name <> 'Unassigned'
        GROUP BY assignee_name
        """,
        (org_id,),
        conn=conn,
    )
    return {str(r["assignee_name"]): int(r["open_count"]) for r in rows}


def open_workload_by_resolver(
    org_id: str, *, conn: Any | None = None
) -> dict[str, int]:
    """Open tickets counted by L2 resolver_name (dual-owner model)."""
    rows = fetch_all(
        """
        SELECT COALESCE(resolver_name, '') AS resolver_name,
               COUNT(*)::int AS open_count
        FROM tickets
        WHERE organization_id = %s
          AND status IN ('Open', 'Pending', 'In Progress', 'Reopened', 'Overdue')
          AND resolver_name IS NOT NULL
          AND resolver_name <> ''
        GROUP BY resolver_name
        """,
        (org_id,),
        conn=conn,
    )
    return {str(r["resolver_name"]): int(r["open_count"]) for r in rows}


def skill_score_to_confidence(skill_score: int) -> float:
    if skill_score >= 2:
        return 1.0
    if skill_score == 1:
        return 0.5
    return 0.0


def resolver_auto_assign_min_confidence() -> float:
    """L2 auto-assign when confidence is strictly greater than this value (default 0.5)."""
    import os

    raw = (os.environ.get("RESOLVER_AUTO_ASSIGN_MIN_CONFIDENCE") or "0.5").strip()
    try:
        return float(raw)
    except ValueError:
        return 0.5


def agents_for_team(
    team: dict[str, Any] | None,
    agents: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not team:
        return agents
    member_ids = set(team.get("member_ids") or _parse_member_ids(team.get("member_ids")))
    if not member_ids:
        return agents
    filtered = [a for a in agents if str(a["id"]) in member_ids]
    return filtered or agents


def _role_rank(role: str | None) -> int:
    """Lower is better for first-line assignment: agent → resolver → admin."""
    r = (role or "").strip().lower()
    if r == "agent":
        return 0
    if r == "resolver":
        return 1
    if r == "admin":
        return 2
    return 3


def pick_assignee(
    *,
    org_id: str,
    skill: str,
    queue: str,
    agents: list[dict[str, Any]] | None = None,
    skills_map: dict[str, list[str]] | None = None,
    team: dict[str, Any] | None = None,
    prefer_agents: bool = True,
    prefer_resolvers: bool = False,
    exclude_user_id: str | None = None,
    workload: dict[str, int] | None = None,
) -> dict[str, Any]:
    """
    Pick best assignee by skill match, then role, then lowest open workload.
    Prefers members of the selected Ticketing team when available.
    Create/triage: prefer_agents=True (L1). Escalate: prefer_resolvers=True.
    """
    if agents is not None and skills_map is not None and workload is not None:
        resolved_agents = agents
        resolved_skills = skills_map
    else:
        from app.db import db_conn

        # One DB connection for roster + skills + workload (avoids 3× connect latency).
        with db_conn() as conn:
            resolved_agents = (
                agents if agents is not None else list_org_agents(org_id, conn=conn)
            )
            resolved_skills = (
                skills_map
                if skills_map is not None
                else org_skills_by_user(org_id, conn=conn)
            )
            if workload is None:
                if prefer_resolvers:
                    workload = open_workload_by_resolver(org_id, conn=conn)
                else:
                    workload = open_workload_by_assignee(org_id, conn=conn)

    pool = agents_for_team(team, resolved_agents)
    exclude = (exclude_user_id or "").strip()
    if exclude:
        pool = [a for a in pool if str(a.get("id") or "") != exclude]
    if not pool:
        return {
            "assignee": "Unassigned",
            "assignee_id": None,
            "skill_score": 0,
            "confidence": 0.0,
            "rationale_extra": "No active agents in org.",
        }

    skills_map = resolved_skills or {}
    skill_l = (skill or "").lower()
    queue_l = (queue or "").lower()

    if prefer_resolvers:
        resolvers_only = [
            a for a in pool if str(a.get("role") or "").lower() == "resolver"
        ]
        if resolvers_only:
            pool = resolvers_only
    elif prefer_agents:
        # L1 first: if any agents exist on the team/pool, only score agents unless none match.
        agents_only = [a for a in pool if str(a.get("role") or "").lower() == "agent"]
        if agents_only:
            pool = agents_only

    scored: list[tuple[int, int, int, int, dict[str, Any]]] = []
    for a in pool:
        name = str(a["name"])
        skills = [s.lower() for s in skills_map.get(str(a["id"]), FALLBACK_SKILLS)]
        skill_score = 0
        # Exact/partial skill match counts as strong only when not the generic "General" bucket.
        if (
            skill_l
            and skill_l != "general"
            and any(skill_l == s or skill_l in s or s in skill_l for s in skills)
        ):
            skill_score = 2
        elif (
            queue_l
            and queue_l != "general"
            and any(queue_l in s or s in queue_l for s in skills)
        ):
            skill_score = 2
        elif "general" in skills:
            skill_score = 1
        open_count = workload.get(name, 0)
        # Escalation: resolvers rank ahead of agents/admins
        role_rank = (
            _role_rank_escalate(str(a.get("role")))
            if prefer_resolvers
            else _role_rank(str(a.get("role")))
        )
        scored.append((-skill_score, role_rank, open_count, skill_score, a))

    scored.sort(key=lambda t: (t[0], t[1], t[2], str(t[4]["name"])))
    best_row = scored[0]
    best = best_row[4]
    best_skill = int(best_row[3])
    confidence = skill_score_to_confidence(best_skill)
    name = str(best["name"])
    open_count = workload.get(name, 0)
    role = str(best.get("role") or "staff")
    team_label = str((team or {}).get("name") or queue or "team")
    mode = "prefer resolver" if prefer_resolvers else "prefer agent first"
    return {
        "assignee": name,
        "assignee_id": str(best["id"]),
        "skill_score": best_skill,
        "confidence": confidence,
        "rationale_extra": (
            f"Assigned to {name} ({role}) for team “{team_label}” "
            f"(open workload={open_count}; {mode}; confidence={confidence:.2f})."
        ),
    }


def _role_rank_escalate(role: str | None) -> int:
    """Lower is better for escalation: resolver → admin → agent."""
    r = (role or "").strip().lower()
    if r == "resolver":
        return 0
    if r == "admin":
        return 1
    if r == "agent":
        return 2
    return 3


def skill_pick_agent_and_resolver(
    *,
    org_id: str,
    skill_hint: str,
    queue: str = "",
    ticket_subject: str = "",
    ticket_description: str = "",
    exclude_user_id: str | None = None,
    use_llm: bool = True,
) -> dict[str, Any]:
    """Suggest L1 agent + L2 resolver via ITRA (LLM skill match only).

    ``use_llm`` is kept for call-site compatibility; ITRA's LLM owns the pick
    from live roster skills. No deterministic / random scorer.
    """
    del use_llm
    from app.proactive.itra import route_assignment

    routed = route_assignment(
        organization_id=str(org_id or "").strip(),
        skill_hint=str(skill_hint or "").strip(),
        queue=str(queue or "").strip(),
        subject=str(ticket_subject or "").strip(),
        description=str(ticket_description or "").strip(),
        issue=str(ticket_description or ticket_subject or skill_hint or "").strip(),
        exclude_user_id=exclude_user_id,
    )
    return {
        "agent": routed.get("agent"),
        "agent_id": routed.get("agent_id"),
        "resolver": routed.get("resolver"),
        "resolver_id": routed.get("resolver_id"),
        "rationale": routed.get("rationale") or "ITRA skill-first routing",
        "via": "itra",
        "confidence": routed.get("confidence"),
        "weights_applied": routed.get("weights_applied"),
    }


def resolve_org_id(organization_id: str | None) -> str:
    org = (organization_id or "").strip()
    if not org:
        raise ValueError("organization_id is required")
    return org
