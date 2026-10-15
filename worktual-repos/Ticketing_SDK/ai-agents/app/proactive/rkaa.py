"""RKAA — Resolution knowledge recommendations (chat reads via tool, no injection)."""

from __future__ import annotations

from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import (
    confidence_of,
    flag_true,
    is_needful_summary,
    run_agent_llm,
)
from app.proactive.retrieval import retrieve

SPEC = AgentSpec(
    agent_id="rkaa",
    trigger=("ticket.created", "on_demand.knowledge"),
    inputs_required=("organization_id", "ticket_number"),
    tools_used=frozenset(
        {"search_kb", "list_kb", "list_tickets", "get_ticket", "list_ticket_recommendations"}
    ),
    output_type="RECOMMENDATION",
    risk_level="low",
    confidence_threshold=0.4,
    audit_event="proactive.rkaa",
    full_name="Resolution Knowledge Agent",
)


def _fallback_summary(kb: list[dict[str, Any]], similar: list[dict[str, Any]]) -> str:
    """Deterministic next-best-action text when the LLM returns empty notes."""
    kb_titles = [str(h.get("title") or "").strip() for h in kb if h.get("title")]
    sim_titles = [str(h.get("title") or h.get("id") or "").strip() for h in similar if h.get("title") or h.get("id")]
    kb_titles = [t for t in kb_titles if t][:3]
    sim_titles = [t for t in sim_titles if t][:3]
    parts: list[str] = []
    if kb_titles:
        parts.append(
            "Suggested resolution knowledge for the assignee/resolver: "
            + "; ".join(kb_titles)
            + ". Open these articles for next steps."
        )
    if sim_titles:
        parts.append(
            "Similar past tickets that may help: " + "; ".join(sim_titles) + "."
        )
    return " ".join(parts).strip()


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    tn = str(
        event.get("ticket_number")
        or (event.get("payload") or {}).get("ticket_number")
        or ""
    )
    if not org or not tn:
        return None
    ticket: dict[str, Any] = event.get("payload") or {}
    try:
        from app.tools.ticket_read import get_ticket
        from app.proactive.retrieval import ticket_from_tool

        ticket = ticket_from_tool(get_ticket(tn), ticket)
    except Exception:
        pass
    q = (
        str(ticket.get("subject") or "")
        + " "
        + str(ticket.get("description") or ticket.get("issue") or "")
    ).strip()
    if not q:
        q = tn
    kb = retrieve(q, source="kb", limit=4)
    similar = [
        h
        for h in retrieve(q, source="tickets", limit=6)
        if str(h.get("id") or "").strip().lstrip("#")
        != str(tn).strip().lstrip("#")
    ][:4]
    obj = run_agent_llm(
        "rkaa",
        "Recommend knowledge only when a KB article or similar ticket clearly helps. "
        "Return JSON: needed (boolean), notes (actionable next steps for the assignee/"
        "resolver naming the article or similar ticket), confidence (0-1). "
        "Do not mutate the ticket. needed=false if kb/similar are empty or unrelated.",
        f"ticket={ticket}\nkb={kb}\nsimilar={similar}",
    )
    if not kb and not similar:
        return None

    # Explicit LLM veto when retrieval is weak / unrelated.
    if obj and "needed" in obj and not flag_true(obj, "needed"):
        return None

    notes = str(obj.get("notes") or "").strip()
    if not is_needful_summary(notes):
        notes = _fallback_summary(kb, similar)
    if not is_needful_summary(notes):
        return None

    return Proposal(
        agent_id="rkaa",
        organization_id=org,
        ticket_id=str(event.get("ticket_id") or ""),
        ticket_number=tn,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="RECOMMENDATION",
        risk_level="low",
        confidence=confidence_of(obj, 0.55 if kb else 0.45),
        summary=notes,
        payload={
            "kb": kb,
            "similar": similar,
            "llm": obj,
            "next_best_action": True,
        },
    )
