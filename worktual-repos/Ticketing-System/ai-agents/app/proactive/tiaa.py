"""TIAA — Insights & analytics. Semantic layer primary; Express fallback."""

from __future__ import annotations

from typing import Any

from app.proactive.contract import AgentSpec, Proposal
from app.proactive.llm_json import confidence_of, flag_true, is_needful_summary, run_agent_llm

SPEC = AgentSpec(
    agent_id="tiaa",
    trigger=("schedule.tiaa", "on_demand.insights"),
    inputs_required=("organization_id",),
    tools_used=frozenset(
        {
            "ask_semantic_layer",
            "get_analytics",
            "get_metrics",
            "list_tickets",
            "get_csat_reports",
        }
    ),
    output_type="RECOMMENDATION",
    risk_level="low",
    confidence_threshold=0.3,
    audit_event="proactive.tiaa",
)


def _empty(payload: Any) -> bool:
    if payload in (None, {}, [], ""):
        return True
    if isinstance(payload, dict):
        counts = [payload.get(k) for k in ("total", "count", "tickets", "open")]
        if all(c in (None, 0, "0", []) for c in counts if c is not None) and not any(
            isinstance(v, list) and v for v in payload.values()
        ):
            return True
    return False


def _tiaa_dedupe_key(notes: str) -> str:
    low = (notes or "").lower()
    if "sla" in low or "breach" in low or "overdue" in low:
        return "insight:sla_critical"
    if "csat" in low:
        return "insight:csat"
    if "volume" in low or "spike" in low:
        return "insight:volume"
    return "insight:analytics"


def _load_insight_context(org: str) -> tuple[Any, str]:
    """Return (payload, source) preferring semantic layer for numbers."""
    try:
        from app.config import get_settings
        from app.tools.catalog_tools import (
            ask_ontology,
            ask_semantic_layer,
            get_analytics,
            get_csat_reports,
            get_metrics,
        )

        sem = ask_semantic_layer(
            query=(
                "Organization ticketing insight check: open volume, SLA breach risk, "
                "CSAT trend, and anything managers must act on now."
            ),
            organization_id=org,
        )
        why = None
        if (get_settings().ontology_chat_url or "").strip():
            ont = ask_ontology(
                query=(
                    "Why are tickets elevated or at risk right now — main drivers "
                    "and themes managers should know?"
                ),
                organization_id=org,
            )
            if ont.get("success") and isinstance(ont.get("payload"), dict):
                why = ont["payload"].get("answer")

        if sem.get("success") and not _empty(sem.get("payload")):
            payload = sem.get("payload")
            if why:
                if isinstance(payload, dict):
                    payload = {**payload, "ontology_why": why}
                else:
                    payload = {"metrics": payload, "ontology_why": why}
            return payload, "ask_semantic_layer"

        analytics = (get_analytics() or {}).get("payload")
        metrics = (get_metrics() or {}).get("payload")
        csat = (get_csat_reports() or {}).get("payload")
        combined = {
            "analytics": analytics,
            "metrics": metrics,
            "csat": csat,
            "ontology_why": why,
        }
        return combined, "express_fallback"
    except Exception:
        return {}, "error"


def propose(event: dict[str, Any]) -> Proposal | None:
    org = str(event.get("organization_id") or "")
    if not org:
        return None
    context, source = _load_insight_context(org)
    on_demand = str(event.get("event_type") or "") == "on_demand.insights"
    if _empty(context):
        if not on_demand:
            return None
        return Proposal(
            agent_id="tiaa",
            organization_id=org,
            event_id=event.get("id") or event.get("event_id"),
            event_type=event.get("event_type"),
            output_type="RECOMMENDATION",
            confidence=1.0,
            summary="No analytics yet — the database has no KPI rows for this range.",
            payload={"empty": True, "source": source, "context": context},
        )
    obj = run_agent_llm(
        "tiaa",
        "Recommend an insight only if managers must act (SLA risk, volume spike, CSAT drop). "
        "Return JSON: needed (boolean), notes (cite real numbers only), confidence. "
        "needed=false for a routine status update. Never invent KPIs. "
        "Never return the words 'analytics summary' alone.",
        f"source={source}\nmetrics_context={context}",
    )
    notes = str(obj.get("notes") or "").strip()
    if not on_demand and not flag_true(obj, "needed", "actionable"):
        return None
    if not is_needful_summary(notes):
        return None
    return Proposal(
        agent_id="tiaa",
        organization_id=org,
        event_id=event.get("id") or event.get("event_id"),
        event_type=event.get("event_type"),
        output_type="RECOMMENDATION",
        confidence=confidence_of(obj, 0.5),
        summary=notes,
        payload={
            "llm": obj,
            "empty": False,
            "source": source,
            "dedupe_key": _tiaa_dedupe_key(notes),
        },
    )
