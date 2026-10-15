"""RCAA — Root cause & continuous learning.

Learns from historical tickets / outcomes, identifies recurring issues, and
writes routing weights ITRA reads. Never mutates tickets. Never Approvals
(ASGA executes silently for audit only).
"""

from __future__ import annotations

from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, flag_true, is_needful_summary, run_agent_llm
from app.proactive.store import get_routing_weights, set_routing_weights

SPEC = AgentSpec(
    agent_id="rcaa",
    trigger=("schedule.rcaa",),
    inputs_required=("organization_id",),
    tools_used=frozenset(
        {
            "get_analytics",
            "list_tickets",
            "get_csat_reports",
            "list_audit",
            "ask_knowledge_graph",
        }
    ),
    output_type="RECOMMENDATION",
    risk_level="low",
    confidence_threshold=0.4,
    audit_event="proactive.rcaa",
    full_name="Root Cause and Learning Agent",
)


def _as_float(val: Any) -> float | None:
    try:
        if isinstance(val, bool):
            return None
        return float(val)
    except (TypeError, ValueError):
        return None


def _normalize_skill_weights(raw: Any) -> dict[str, float]:
    """Accept flat skill→number or nested skill_weights from the LLM."""
    if not isinstance(raw, dict):
        return {}
    nested = raw.get("skill_weights")
    source = nested if isinstance(nested, dict) else raw
    out: dict[str, float] = {}
    for key, val in source.items():
        if str(key).startswith("_") or key in {"recurring_issues", "skill_weights"}:
            continue
        num = _as_float(val)
        if num is None:
            continue
        name = str(key).strip()
        if name:
            out[name] = num
    return out


def _normalize_recurring(raw: Any) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for item in raw[:12]:
        if isinstance(item, str):
            theme = item.strip()
            if theme:
                out.append({"theme": theme[:200], "routing_hint": ""})
            continue
        if not isinstance(item, dict):
            continue
        theme = str(
            item.get("theme") or item.get("pattern") or item.get("issue") or ""
        ).strip()
        hint = str(
            item.get("routing_hint")
            or item.get("hint")
            or item.get("preferred")
            or ""
        ).strip()
        if not theme:
            continue
        out.append({"theme": theme[:200], "routing_hint": hint[:200]})
    return out


def _learning_blob(obj: dict[str, Any]) -> dict[str, Any]:
    return {
        "skill_weights": _normalize_skill_weights(obj.get("weights")),
        "recurring_issues": _normalize_recurring(obj.get("recurring_issues")),
    }


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    if not org:
        return None
    try:
        from app.config import get_settings
        from app.tools.catalog_tools import (
            ask_knowledge_graph,
            get_analytics,
            get_csat_reports,
            list_audit,
        )
        from app.tools.ticket_read import list_tickets

        semantic: Any = {}
        ontology_why: Any = None
        analytics = (get_analytics() or {}).get("payload") or {}
        csat = (get_csat_reports() or {}).get("payload") or {}
        if analytics or csat:
            semantic = {"analytics": analytics, "csat": csat}
        if (get_settings().ontology_chat_url or "").strip():
            ont = ask_knowledge_graph(
                query=(
                    "What recurring themes and root drivers explain recent ticket "
                    "patterns in this organization?"
                ),
                organization_id=org,
            )
            if ont.get("success") and isinstance(ont.get("payload"), dict):
                ontology_why = ont["payload"].get("answer")
        audit = (list_audit() or {}).get("payload")
        tickets = (list_tickets(limit=100) or {}).get("payload")
    except Exception:
        semantic = analytics = csat = audit = tickets = {}
        ontology_why = None

    prev = get_routing_weights(org)
    prev_learning = {
        "skill_weights": prev.get("skill_weights") or {},
        "recurring_issues": prev.get("recurring_issues") or [],
    }
    obj = run_agent_llm(
        "rcaa",
        "Learn from historical tickets, semantic metrics (preferred), optional "
        "ontology why-narrative, analytics, CSAT, and audit. Identify recurring "
        "issues / root patterns and update soft routing heuristics for the "
        "assignment engine. Return JSON: needed (boolean), "
        "recurring_issues (list of {theme, routing_hint}), weights (object of "
        "skill/team/agent -> numeric weight), notes (short internal learning summary), "
        "confidence (0-1). needed=false when there is nothing useful to learn. "
        "Do not invent people. Do not update tickets. Use ontology_why for themes "
        "only — never invent KPI numbers from it.",
        (
            f"previous_learning={prev}\n"
            f"semantic_metrics={semantic}\n"
            f"ontology_why={ontology_why}\n"
            f"analytics={analytics}\n"
            f"csat={csat}\n"
            f"audit={audit}\n"
            f"tickets={tickets}"
        ),
    )

    if obj and "needed" in obj and not flag_true(obj, "needed"):
        return None

    learning = _learning_blob(obj)
    skill_weights = learning.get("skill_weights") or {}
    recurring = learning.get("recurring_issues") or []
    if not skill_weights and not recurring:
        return None
    if learning == prev_learning:
        return None

    conf = confidence_of(obj, 0.5)
    if conf < SPEC.confidence_threshold:
        return None

    # Keep WLOA brief (and any other keys) when refreshing RCAA learning.
    set_routing_weights(org, {**prev, **learning})
    notes = str(obj.get("notes") or "").strip()
    if not is_needful_summary(notes):
        bits: list[str] = []
        if skill_weights:
            bits.append(
                "Routing weights updated for "
                + ", ".join(str(k) for k in list(skill_weights)[:6])
            )
        if recurring:
            themes = [str(r.get("theme") or "") for r in recurring[:3] if r.get("theme")]
            if themes:
                bits.append("Recurring issues: " + "; ".join(themes))
        notes = ". ".join(bits).strip() or "Routing learning updated"

    return Proposal(
        agent_id="rcaa",
        organization_id=org,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="RECOMMENDATION",
        confidence=conf,
        summary=notes,
        payload={
            "learning": learning,
            "weights": skill_weights,
            "recurring_issues": recurring,
            "llm": obj,
        },
    )
