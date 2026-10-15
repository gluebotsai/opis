"""LLM supervisor handoff execution (max handoffs, no semantic reinterpretation)."""

from __future__ import annotations

from typing import Any, Callable

from app.contracts.errors import HandoffCycleError, ToolLoopExhausted
from app.contracts.execution import AgentDefinition
from app.memory.session import SharedMemory


SPECIALIST_NAMES = frozenset(
    {"tickets", "customers", "teams", "kb", "macros", "admin", "general"}
)

SUPER_AGENT_ID = "ticketing_super_agent"
DOMAIN_AGENT_IDS = frozenset(
    {
        "intake_deflection_domain",
        "triage_routing_domain",
        "resolution_lifecycle_domain",
        "knowledge_domain",
        "catalog_administration_domain",
    }
)


def canonical_agent_definitions() -> dict[str, AgentDefinition]:
    """Return the validated 1 Super + 5 Domain + 25 Executor registry."""
    from app.prompts.builder import load_agent_definitions

    definitions = load_agent_definitions()
    layers = {
        layer: [item.id for item in definitions.values() if item.layer == layer]
        for layer in ("super", "domain", "executor")
    }
    counts = {layer: len(ids) for layer, ids in layers.items()}
    if counts != {"super": 1, "domain": 5, "executor": 25}:
        raise ValueError(f"invalid canonical agent layer counts: {counts}")
    if set(layers["domain"]) != set(DOMAIN_AGENT_IDS):
        raise ValueError("canonical Domain registry does not match frozen architecture")
    if layers["super"] != [SUPER_AGENT_ID]:
        raise ValueError("canonical Super Agent registry does not match frozen architecture")
    return definitions


def executors_for_domain(domain_id: str) -> tuple[str, ...]:
    definition = canonical_agent_definitions().get(str(domain_id or "").strip())
    if not definition or definition.layer != "domain":
        return ()
    return tuple(definition.handoff_targets)


def skills_for_executor(executor_id: str) -> tuple[str, ...]:
    definition = canonical_agent_definitions().get(str(executor_id or "").strip())
    if not definition or definition.layer != "executor":
        return ()
    return tuple(definition.skills)


def resolve_route_target(tool_arguments: dict[str, Any]) -> str | None:
    name = str(
        tool_arguments.get("agent_name")
        or tool_arguments.get("agent")
        or tool_arguments.get("specialist")
        or ""
    ).strip().lower()
    aliases = {
        "ticket": "tickets",
        "customer": "customers",
        "team": "teams",
        "queue": "teams",
        "queues": "teams",
        "knowledge": "kb",
        "article": "kb",
        "macro": "macros",
        "priority": "admin",
        "priorities": "admin",
        "status": "admin",
        "analytics": "admin",
        "settings": "admin",
    }
    name = aliases.get(name, name)
    if name in SPECIALIST_NAMES:
        return name
    return None


def run_with_handoffs(
    *,
    memory: SharedMemory,
    start_agent: str,
    max_handoffs: int,
    run_agent: Callable[[str, SharedMemory, str | None], dict[str, Any]],
    initial_query: str,
) -> dict[str, Any]:
    """
    Run agent; if it returns a routing_response, hand off (bounded).

    run_agent(agent_name, memory, query) -> {
      response_type: "final"|"routing_response",
      assistant_text?: str,
      agent_name?: str,
      query?: str,
      data?: dict,
      ...
    }
    """
    current = start_agent
    query: str | None = initial_query
    seen: list[str] = [current]
    handoffs = 0

    while True:
        result = run_agent(current, memory, query)
        if result.get("response_type") != "routing_response":
            result.setdefault("agent", current)
            return result

        target = resolve_route_target(result.get("route_args") or {})
        if not target:
            # Invalid route — treat any text as final or error via caller
            if result.get("assistant_text"):
                result["response_type"] = "final"
                result["agent"] = current
                return result
            raise HandoffCycleError("Invalid route_to_agent target")

        handoffs += 1
        if handoffs > max_handoffs:
            raise ToolLoopExhausted(
                "Exceeded max specialist handoffs",
                details={"handoffs": handoffs, "trace": seen},
            )
        if target in seen:
            raise HandoffCycleError(
                "Specialist handoff cycle detected",
                details={"trace": seen + [target]},
            )

        memory.record_handoff(current, target)
        try:
            from app.observability.turn_log import record_route

            record_route(current, target, str(result.get("query") or query or ""))
        except Exception:  # noqa: BLE001
            pass
        current = target
        seen.append(current)
        query = str(result.get("query") or query or "")
