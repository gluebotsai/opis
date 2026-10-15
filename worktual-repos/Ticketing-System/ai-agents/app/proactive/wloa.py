"""WLOA — Workload & optimization. Manager recommendations only.

Persists a load brief ITRA may read. Never assigns L1/L2.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, flag_true, is_needful_summary, run_agent_llm
from app.proactive.store import set_wloa_brief

SPEC = AgentSpec(
    agent_id="wloa",
    trigger=("schedule.wloa",),
    inputs_required=("organization_id",),
    tools_used=frozenset({"list_tickets", "list_agents", "list_queues", "get_metrics"}),
    output_type="RECOMMENDATION",
    risk_level="low",
    confidence_threshold=0.4,
    audit_event="proactive.wloa",
)

_CLOSED = frozenset({"closed", "resolved", "solved", "cancelled", "canceled"})


def _rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("tickets", "items", "agents", "queues"):
            rows = payload.get(key)
            if isinstance(rows, list):
                return [r for r in rows if isinstance(r, dict)]
    return []


def _open_load(tickets: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in _rows(tickets):
        status = str(row.get("status") or "open").strip().lower()
        if status in _CLOSED:
            continue
        who = str(row.get("assignee") or row.get("assigneeName") or "Unassigned").strip() or "Unassigned"
        counts[who] = counts.get(who, 0) + 1
    return counts


def _name_list(raw: Any) -> list[str]:
    """Normalize LLM name lists; empty if the model omitted them."""
    out: list[str] = []
    if isinstance(raw, str) and raw.strip():
        out.append(raw.strip())
    elif isinstance(raw, list):
        for item in raw:
            if isinstance(item, str) and item.strip():
                out.append(item.strip())
            elif isinstance(item, dict):
                name = str(item.get("name") or item.get("person") or "").strip()
                if name:
                    out.append(name)
            if len(out) >= 8:
                break
    seen: set[str] = set()
    unique: list[str] = []
    for name in out:
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(name)
    return unique


def _imbalanced(counts: dict[str, int], agent_count: int) -> bool:
    if sum(counts.values()) < 2:
        return False
    vals = list(counts.values())
    if len(vals) >= 2 and max(vals) - min(vals) >= 2:
        return True
    if counts.get("Unassigned", 0) >= 3 and agent_count >= 2:
        return True
    return False


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    if not org:
        return None
    try:
        from app.tools.ticket_read import list_tickets
        from app.tools.catalog_tools import list_agents, list_queues, get_metrics

        tickets = (list_tickets() or {}).get("payload") or []
        agents = (list_agents() or {}).get("payload") or []
        queues = (list_queues() or {}).get("payload") or []
        metrics = (get_metrics() or {}).get("payload") or {}
    except Exception:
        tickets, agents, queues, metrics = [], [], [], {}
    load = _open_load(tickets)
    if not _imbalanced(load, len(_rows(agents))):
        return None
    obj = run_agent_llm(
        "wloa",
        "Recommend workload balancing only if it is actually needed. Return JSON: "
        "needed (boolean), notes (who is overloaded vs who can take work, with counts), "
        "overloaded (list of exact roster names or empty), "
        "lighter (list of exact roster names who can take work, or empty), "
        "confidence. needed=false if load is even. Do not assign tickets. "
        "Never invent names. Never return the words 'workload recommendation' alone.",
        f"load={load}\ntickets={tickets}\nagents={agents}\nqueues={queues}\nmetrics={metrics}",
    )
    notes = str(obj.get("notes") or "").strip()
    if not flag_true(obj, "needed", "imbalance") and not is_needful_summary(notes):
        return None
    if not is_needful_summary(notes):
        return None
    brief = {
        "notes": notes,
        "overloaded": _name_list(obj.get("overloaded")),
        "lighter": _name_list(obj.get("lighter")),
        "load": load,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
    set_wloa_brief(org, brief)
    return Proposal(
        agent_id="wloa",
        organization_id=org,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="RECOMMENDATION",
        risk_level="low",
        confidence=confidence_of(obj, 0.5),
        summary=notes,
        payload={"llm": obj, "load": load, "wloa_brief": brief},
    )
