"""AI / heuristic categorization for new tickets (Flow 2–3).

Event-driven classification lives in `app.proactive.icpa` (do not delete this
inline create-path helper). Teams come from Ticketing agent_queues
(passed in as team_names). Never invent static team names — only use values
loaded from the Ticketing DB. Prefer matching team description to the issue.
"""

from __future__ import annotations

import json
import re
from typing import Any

from app.llm import get_llm
from app.tasks.schemas import Priority


def normalize_priority(raw: Any) -> Priority:
    t = str(raw or "").lower().strip()
    if t in ("urgent", "high", "medium", "low"):
        return t  # type: ignore[return-value]
    if re.search(r"\burgent\b", t):
        return "urgent"
    if re.search(r"\bhigh\b", t):
        return "high"
    if re.search(r"\blow\b", t):
        return "low"
    return "medium"


def parse_confidence(raw: Any) -> float | None:
    """LLM confidence 0–1, or None if missing/invalid."""
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value != value:  # NaN
        return None
    return max(0.0, min(1.0, value))


def extract_json_object(text: str) -> dict[str, Any] | None:
    trimmed = text.strip()
    try:
        obj = json.loads(trimmed)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", trimmed)
        if not match:
            return None
        try:
            obj = json.loads(match.group(0))
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None


def _pick_team_name(issue: str, team_names: list[str], teams_blob: str) -> str:
    if not team_names:
        return ""
    lower = issue.lower()
    scored: list[tuple[int, str]] = []
    for name in team_names:
        score = 0
        # teams_blob includes descriptions — weight description-bearing matches higher
        desc_blob = teams_blob.lower()
        name_l = name.lower()
        for token in re.split(r"[^a-z0-9]+", lower):
            if len(token) <= 3:
                continue
            if token in desc_blob:
                score += 3
            if token in name_l:
                score += 1
        scored.append((score, name))
    scored.sort(key=lambda t: (-t[0], t[1].lower()))
    if scored[0][0] > 0:
        return scored[0][1]
    # No description/name match — do not invent a default team
    return ""


def heuristic_triage(
    issue: str,
    *,
    team_names: list[str],
    teams_context: str = "",
) -> dict[str, Any]:
    lower = issue.lower()
    priority: Priority = "medium"
    if re.search(r"\b(urgent|asap|immediately|critical|down)\b", lower):
        priority = "urgent"
    elif re.search(r"\b(cannot|can't|broken|fail|outage)\b", lower):
        priority = "high"
    elif re.search(r"\b(question|how do|info|curious)\b", lower):
        priority = "low"

    subject = issue.strip() or "Support request"
    if len(subject) > 80:
        subject = subject[:77].rstrip() + "…"

    if not team_names:
        return {
            "subject": subject,
            "description": f"Customer reported:\n\n{issue.strip()}",
            "priority": priority,
            "skill": "",
            "category": "",
            "queue": "",
            "confidence": None,
            "rationale": "No teams configured in Ticketing yet.",
            "enrichedByAi": False,
        }

    team = _pick_team_name(issue, team_names, teams_context)
    return {
        "subject": subject,
        "description": f"Customer reported:\n\n{issue.strip()}",
        "priority": priority,
        "skill": team,
        "category": team,
        "queue": team,
        "confidence": None,
        "rationale": (
            f'Matched Ticketing team "{team}" by description.'
            if team
            else "No Ticketing team description matched; left unassigned."
        ),
        "enrichedByAi": False,
    }


def llm_compose_ticket_copy(
    *,
    customer_name: str,
    customer_email: str | None,
    customer_phone: str | None,
    issue: str,
) -> dict[str, Any] | None:
    """LLM subject + description + priority only (no team/roster required).

    Used when MyAccount has no teams yet, and as copy fallback when full triage
    is unavailable — never leave the ticket subject as a raw utterance truncate.
    """
    raw = (issue or "").strip()
    if not raw:
        return None
    system = (
        "You write helpdesk ticket fields for Worktual.\n"
        "Return ONLY a single JSON object (no markdown) with keys:\n"
        "subject (short, clear ticket subject — max ~80 chars; never paste the "
        "full customer rant),\n"
        "description (clear support description rewritten from the customer "
        "issue; keep facts, fix obvious typos, 2–5 sentences),\n"
        "priority (one of: low, medium, high, urgent).\n"
        "Rules:\n"
        "- subject and description MUST be written by you — never copy the "
        "issue text verbatim as the subject.\n"
        "- Do not invent customers, products, or facts not implied by the issue.\n"
        "- priority from urgency language in the issue."
    )
    user = (
        f"Customer name: {customer_name or '(unknown)'}\n"
        f"Email: {customer_email or '(none)'}\n"
        f"Phone: {customer_phone or '(none)'}\n"
        f"Customer issue:\n{raw}"
    )
    try:
        llm = get_llm()
        msg = llm.invoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
        )
        content = getattr(msg, "content", None) or str(msg)
        parsed = extract_json_object(str(content))
        if not parsed:
            return None
        subject = str(parsed.get("subject") or "").strip()
        description = str(parsed.get("description") or "").strip()
        if not subject or not description:
            return None
        if len(subject) > 120:
            subject = subject[:117].rstrip() + "…"
        return {
            "subject": subject,
            "description": description,
            "priority": normalize_priority(parsed.get("priority")),
            "skill": "",
            "category": "",
            "queue": "",
            "confidence": None,
            "rationale": "LLM wrote subject/description; assignment pending teams.",
            "enrichedByAi": True,
        }
    except Exception:  # noqa: BLE001
        return None


def llm_triage(
    *,
    customer_name: str,
    customer_email: str | None,
    customer_phone: str | None,
    issue: str,
    team_names: list[str],
    teams_context: str,
    roster_text: str,
    agent_names: list[str] | None = None,
    resolver_names: list[str] | None = None,
) -> dict[str, Any] | None:
    """Return triage + L1/L2 names from LLM, or None on failure."""
    if not team_names:
        return llm_compose_ticket_copy(
            customer_name=customer_name,
            customer_email=customer_email,
            customer_phone=customer_phone,
            issue=issue,
        )

    teams = ", ".join(team_names)
    agents_list = ", ".join(agent_names) if agent_names else "(see roster)"
    resolvers_list = ", ".join(resolver_names) if resolver_names else "(see roster)"
    system = (
        "You are a helpdesk triage assistant for Worktual.\n"
        "Return ONLY a single JSON object (no markdown) with keys:\n"
        "subject (short ticket subject),\n"
        "description (clear ticket description based on the customer issue),\n"
        "priority (one of: low, medium, high, urgent),\n"
        "category (short label),\n"
        "skill (short skill label matching a roster member skill when possible),\n"
        f"queue (MUST be exactly one team name from: {teams}),\n"
        "agent (exact L1 agent name from the Agents list, or empty),\n"
        "resolver (exact L2 resolver name from the Resolvers list),\n"
        "confidence (number 0.0–1.0: how well the ISSUE matches the chosen "
        "RESOLVER's skills),\n"
        "rationale (one short sentence explaining team + L1 + L2 using skills, "
        "workload, and priority).\n"
        "Rules:\n"
        "- Use ONLY teams listed below. Never invent team names.\n"
        "- Pick the team whose DESCRIPTION best matches the customer issue; "
        "then use member skills as a secondary signal.\n"
        f"- agent MUST be an exact name from Agents: {agents_list}. "
        "Never invent a person. Empty only if that list is empty.\n"
        f"- resolver MUST be an exact name from Resolvers: {resolvers_list}. "
        "Never invent a person. Different person from agent.\n"
        "- ALWAYS pick a resolver whenever the Resolvers list is not empty. "
        "Do not leave resolver empty to defer assignment.\n"
        "- Choose resolver from the roster using ONLY: (1) skill overlap with "
        "the issue, (2) that resolver's listed open/L2 workload, (3) the "
        "priority you assigned. Urgent/high → strongest skill match; "
        "medium/low → skill match then lighter workload. Never score in code "
        "terms — reason as a specialist.\n"
        "- Prefer a skill label that matches roster skills when possible.\n"
        "- queue must be an exact team name from the list.\n"
        "- confidence describes skill fit only; it must not be used to skip "
        "naming a resolver."
    )
    user = (
        f"Customer name: {customer_name}\n"
        f"Email: {customer_email or '(none)'}\n"
        f"Phone: {customer_phone or '(none)'}\n"
        f"Issue:\n{issue}\n\n"
        f"Teams from Ticketing (description + members + skills):\n{teams_context or '(none)'}\n\n"
        f"Agents (L1):\n{agents_list}\n"
        f"Resolvers (L2):\n{resolvers_list}\n\n"
        f"Assignable roster (skills + current open workload):\n{roster_text or '(empty)'}"
    )
    try:
        llm = get_llm()
        msg = llm.invoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
        )
        content = getattr(msg, "content", None) or str(msg)
        parsed = extract_json_object(str(content))
        if not parsed:
            return None

        allowed = {n.lower(): n for n in team_names}
        queue_raw = str(parsed.get("queue") or "").strip()
        queue = allowed.get(queue_raw.lower(), "")
        if not queue:
            # Prefer a team name that appears in the skill/rationale; never invent.
            skill = str(parsed.get("skill") or "").lower()
            rationale = str(parsed.get("rationale") or "").lower()
            match = next(
                (
                    n
                    for n in team_names
                    if skill and skill in n.lower()
                ),
                None,
            )
            if not match:
                match = next(
                    (n for n in team_names if n.lower() in rationale),
                    None,
                )
            queue = match or ""

        subject = str(parsed.get("subject") or "").strip()
        description = str(parsed.get("description") or "").strip()
        if not subject or not description:
            return None

        skill = str(parsed.get("skill") or queue).strip() or queue or "General"
        agent = str(parsed.get("agent") or parsed.get("assignee") or "").strip()
        resolver = str(parsed.get("resolver") or "").strip()
        allowed_agents = {n.lower(): n for n in (agent_names or []) if n}
        allowed_resolvers = {n.lower(): n for n in (resolver_names or []) if n}
        if agent:
            agent = allowed_agents.get(agent.lower(), agent if not allowed_agents else "")
        if resolver:
            resolver = allowed_resolvers.get(
                resolver.lower(), resolver if not allowed_resolvers else ""
            )
        if agent and resolver and agent.lower() == resolver.lower():
            resolver = ""
        return {
            "subject": subject,
            "description": description,
            "priority": normalize_priority(parsed.get("priority")),
            "skill": skill,
            "category": str(parsed.get("category") or skill).strip() or skill,
            "queue": queue,
            "agent": agent or None,
            "assignee": agent or None,
            "resolver": resolver or None,
            "confidence": parse_confidence(
                parsed.get("confidence", parsed.get("resolver_confidence"))
            ),
            "rationale": str(parsed.get("rationale") or "").strip() or "LLM triage",
            "enrichedByAi": True,
        }
    except Exception:  # noqa: BLE001
        return None


def llm_pick_resolver(
    *,
    issue: str,
    priority: str,
    skill: str,
    queue: str,
    roster_text: str,
    resolver_names: list[str],
    exclude_name: str | None = None,
) -> dict[str, Any] | None:
    """LLM-only L2 pick when the main triage JSON omitted a valid resolver."""
    names = [n for n in resolver_names if n and n.strip()]
    exclude = (exclude_name or "").strip().lower()
    if exclude:
        names = [n for n in names if n.strip().lower() != exclude]
    if not names:
        return None
    listed = ", ".join(names)
    system = (
        "You assign the L2 resolver for a new Worktual ticket.\n"
        "Return ONLY JSON: "
        '{"resolver":"exact name","confidence":0.0,'
        '"rationale":"one sentence"}\n'
        f"- resolver MUST be an exact name from: {listed}. Never invent.\n"
        "- Choose using issue↔skills, listed L2 open workload, and priority "
        f"({priority}). Urgent/high → best skill fit; otherwise skill then "
        "lighter workload.\n"
        "- Always name a resolver from the list."
    )
    user = (
        f"Priority: {priority}\n"
        f"Skill/category: {skill or '(none)'}\n"
        f"Team: {queue or '(none)'}\n"
        f"Issue:\n{issue}\n\n"
        f"Resolvers (skills + workload):\n{roster_text or listed}"
    )
    try:
        llm = get_llm()
        msg = llm.invoke(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
        )
        content = getattr(msg, "content", None) or str(msg)
        parsed = extract_json_object(str(content))
        if not parsed:
            return None
        raw = str(parsed.get("resolver") or "").strip()
        allowed = {n.lower(): n for n in names}
        name = allowed.get(raw.lower(), "")
        if not name:
            return None
        return {
            "resolver": name,
            "confidence": parse_confidence(
                parsed.get("confidence", parsed.get("resolver_confidence"))
            ),
            "rationale": str(parsed.get("rationale") or "").strip(),
        }
    except Exception:  # noqa: BLE001
        return None


def categorize_ticket(
    *,
    customer_name: str,
    customer_email: str | None,
    customer_phone: str | None,
    issue: str,
    team_names: list[str],
    teams_context: str,
    roster_text: str,
    agent_names: list[str] | None = None,
    resolver_names: list[str] | None = None,
) -> dict[str, Any]:
    if not team_names:
        copy = llm_compose_ticket_copy(
            customer_name=customer_name,
            customer_email=customer_email,
            customer_phone=customer_phone,
            issue=issue,
        )
        if copy:
            copy = dict(copy)
            copy["rationale"] = (
                "No teams configured in MyAccount; LLM wrote subject/description."
            )
            return copy
        return heuristic_triage(issue, team_names=[], teams_context="")

    ai = llm_triage(
        customer_name=customer_name,
        customer_email=customer_email,
        customer_phone=customer_phone,
        issue=issue,
        team_names=team_names,
        teams_context=teams_context,
        roster_text=roster_text,
        agent_names=agent_names,
        resolver_names=resolver_names,
    )
    if ai:
        return ai
    # Full triage failed — still prefer LLM copy over raw utterance truncate.
    copy = llm_compose_ticket_copy(
        customer_name=customer_name,
        customer_email=customer_email,
        customer_phone=customer_phone,
        issue=issue,
    )
    if copy:
        fallback = heuristic_triage(
            issue, team_names=team_names, teams_context=teams_context
        )
        fallback["subject"] = copy["subject"]
        fallback["description"] = copy["description"]
        fallback["priority"] = copy.get("priority") or fallback["priority"]
        fallback["enrichedByAi"] = True
        fallback["rationale"] = (
            f"{fallback.get('rationale') or ''} LLM wrote subject/description."
        ).strip()
        return fallback
    return heuristic_triage(issue, team_names=team_names, teams_context=teams_context)
