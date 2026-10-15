"""Agent router — map cheap intent → specialist (no LLM). pick_next for edges."""

from __future__ import annotations

from app.agents.policy import INTENT_TO_AGENT, apply_policy
from app.state import AgentName, AgentState

VALID_ROUTES: set[str] = {
    "tickets",
    "teams",
    "kb",
    "customers",
    "macros",
    "admin",
    "general",
}


def route_query(state: AgentState) -> dict:
    """
    Backward-compatible entry: ensure intent→route mapping.

    Prefer graph nodes `intent` + `policy`. When called alone (tests),
    classify intent if missing then apply policy.
    """
    if not state.get("intent"):
        from app.agents.intent import classify_intent

        updates = classify_intent(state)
        merged = {**state, **updates}
        return apply_policy(merged)  # type: ignore[arg-type]
    return apply_policy(state)


def pick_next(state: AgentState) -> AgentName:
    """Conditional-edge helper: return the route name for LangGraph."""
    route = state.get("route") or "general"
    if route not in VALID_ROUTES:
        return "general"
    return route  # type: ignore[return-value]


def intent_to_route(intent: str) -> AgentName:
    return INTENT_TO_AGENT.get((intent or "").strip().upper(), "general")
