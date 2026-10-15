"""STDA — Similar / duplicate ticket detection + existing-solution recommendations.

Merge stays human-gated. When the LLM flags a duplicate or repeat, Approvals
gets a recommendation that points at solutions already in similar-ticket notes,
macros, or KB articles.
"""

from __future__ import annotations

from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, flag_true, is_needful_summary, run_agent_llm
from app.proactive.retrieval import retrieve

SPEC = AgentSpec(
    agent_id="stda",
    trigger=("ticket.created",),
    inputs_required=("organization_id", "ticket_number"),
    tools_used=frozenset(
        {
            "list_tickets",
            "get_ticket",
            "list_ticket_notes",
            "list_kb",
            "search_kb",
            "list_macros",
        }
    ),
    output_type="RECOMMENDATION",
    risk_level="low",
    confidence_threshold=0.5,
    audit_event="proactive.stda",
    full_name="Similar Ticket Detection Agent",
)


def _payload_rows(result: dict[str, Any] | None, keys: tuple[str, ...]) -> list[dict[str, Any]]:
    if not isinstance(result, dict):
        return []
    payload = result.get("payload")
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in keys:
            rows = payload.get(key)
            if isinstance(rows, list):
                return [r for r in rows if isinstance(r, dict)]
        data = payload.get("data")
        if isinstance(data, list):
            return [r for r in data if isinstance(r, dict)]
        if isinstance(data, dict):
            for key in keys:
                rows = data.get(key)
                if isinstance(rows, list):
                    return [r for r in rows if isinstance(r, dict)]
    return []


def _note_text(row: dict[str, Any]) -> str:
    return str(
        row.get("body")
        or row.get("text")
        or row.get("content")
        or row.get("note")
        or row.get("message")
        or ""
    ).strip()


def _notes_from_similar(similar: list[dict[str, Any]], *, per_ticket: int = 6) -> list[dict[str, Any]]:
    """Pull recent notes from top similar tickets (resolution steps often live here)."""
    out: list[dict[str, Any]] = []
    try:
        from app.tools.ticket_read import list_ticket_notes
    except Exception:
        return out
    for hit in similar[:5]:
        tid = str(hit.get("id") or "").strip()
        if not tid:
            continue
        try:
            rows = _payload_rows(
                list_ticket_notes(tid),
                ("notes", "items", "activity"),
            )
        except Exception:
            rows = []
        snippets: list[str] = []
        for row in rows[:per_ticket]:
            text = _note_text(row)
            if len(text) < 8:
                continue
            snippets.append(text[:350])
        if snippets:
            out.append(
                {
                    "ticket": tid,
                    "title": str(hit.get("title") or ""),
                    "notes": snippets,
                }
            )
    return out


def _macros_for_query(query_text: str, *, limit: int = 5) -> list[dict[str, Any]]:
    """Rank live macros by token overlap with the new ticket (same cosine as retrieve)."""
    try:
        from app.tools.catalog_tools import list_macros
        from app.proactive.retrieval import _cosine, _tokens
    except Exception:
        return []
    try:
        rows = _payload_rows(list_macros(), ("macros", "items"))
    except Exception:
        return []
    q = _tokens(query_text)
    scored: list[tuple[float, dict[str, Any]]] = []
    for row in rows:
        blob = " ".join(
            str(row.get(k) or "")
            for k in ("name", "title", "body", "content", "description", "actions")
        )
        score = _cosine(q, _tokens(blob))
        if score <= 0:
            continue
        scored.append(
            (
                score,
                {
                    "id": str(row.get("id") or row.get("externalId") or ""),
                    "name": str(row.get("name") or row.get("title") or ""),
                    "snippet": str(
                        row.get("body") or row.get("content") or row.get("description") or ""
                    )[:300],
                },
            )
        )
    scored.sort(key=lambda x: x[0], reverse=True)
    return [item for _, item in scored[:limit] if item.get("name") or item.get("snippet")]


def _fallback_summary(
    dup_ids: list[str],
    notes_by_ticket: list[dict[str, Any]],
    kb: list[dict[str, Any]],
    macros: list[dict[str, Any]],
) -> str:
    parts: list[str] = []
    if dup_ids:
        parts.append(
            "Looks like a duplicate or repeat of "
            + ", ".join(dup_ids[:3])
            + "."
        )
    note_bits = []
    for block in notes_by_ticket[:2]:
        tid = str(block.get("ticket") or "")
        first = (block.get("notes") or [None])[0]
        if tid and first:
            note_bits.append(f"{tid}: {str(first)[:120]}")
    if note_bits:
        parts.append("Reuse resolution notes from " + "; ".join(note_bits) + ".")
    kb_titles = [str(h.get("title") or "").strip() for h in kb if h.get("title")][:3]
    if kb_titles:
        parts.append("KB articles that may already solve this: " + "; ".join(kb_titles) + ".")
    macro_names = [str(m.get("name") or "").strip() for m in macros if m.get("name")][:3]
    if macro_names:
        parts.append("Consider macros: " + "; ".join(macro_names) + ".")
    return " ".join(parts).strip()


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    tn = str(event.get("ticket_number") or (event.get("payload") or {}).get("ticket_number") or "")
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
    similar = [
        h
        for h in retrieve(q or tn, source="tickets", limit=6)
        if str(h.get("id") or "").strip().lstrip("#") != str(tn).strip().lstrip("#")
    ]
    notes_by_ticket = _notes_from_similar(similar) if similar else []
    kb = retrieve(q or tn, source="kb", limit=5) if q or similar else []
    macros = _macros_for_query(q) if q else []

    obj = run_agent_llm(
        "stda",
        "Decide if this new ticket is a duplicate or repeated incident of similar "
        "existing tickets. If it is, recommend existing solutions from similar-ticket "
        "notes, macros, and KB articles — do not invent solutions. "
        "Return JSON: needed (boolean), is_duplicate_or_repeat (boolean), "
        "possible_duplicates (ticket ids), recommended_solutions (short actionable "
        "strings citing notes/macros/KB), notes (staff-facing recommendation), "
        "confidence (0-1). needed=false when similar is weak or unrelated. "
        "Do not merge tickets.",
        (
            f"new_ticket={ticket}\n"
            f"similar_tickets={similar}\n"
            f"resolution_notes_from_similar={notes_by_ticket}\n"
            f"kb_articles={kb}\n"
            f"macros={macros}"
        ),
    )

    dups = obj.get("possible_duplicates")
    dup_ids = [str(x) for x in dups] if isinstance(dups, list) else []
    solutions = obj.get("recommended_solutions")
    solution_list = (
        [str(x).strip() for x in solutions if str(x).strip()]
        if isinstance(solutions, list)
        else []
    )
    notes = str(obj.get("notes") or "").strip()
    is_dup = flag_true(obj, "is_duplicate_or_repeat") or bool(dup_ids)

    if not similar and not is_dup:
        return None
    if obj and "needed" in obj and not flag_true(obj, "needed") and not is_dup:
        return None
    # Solutions are only recommended when the LLM treats this as a duplicate/repeat.
    if not is_dup:
        return None

    if not is_needful_summary(notes):
        if solution_list:
            notes = (
                (f"Possible duplicate of {', '.join(dup_ids[:3])}. " if dup_ids else "")
                + "Existing solutions: "
                + "; ".join(solution_list[:4])
            ).strip()
        else:
            notes = _fallback_summary(dup_ids, notes_by_ticket, kb, macros)
    if not is_needful_summary(notes):
        notes = (
            f"Possible duplicate of {', '.join(dup_ids[:3])}."
            if dup_ids
            else ""
        )
    if not is_needful_summary(notes):
        return None

    return Proposal(
        agent_id="stda",
        organization_id=org,
        ticket_id=str(event.get("ticket_id") or ""),
        ticket_number=tn,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="RECOMMENDATION",
        confidence=confidence_of(obj, 0.55),
        summary=notes,
        payload={
            "similar": similar,
            "notes_from_similar": notes_by_ticket,
            "kb": kb,
            "macros": macros,
            "possible_duplicates": dup_ids,
            "recommended_solutions": solution_list,
            "llm": obj,
        },
    )
