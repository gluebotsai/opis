"""Native enterprise agent runtime (contract version 1.0)."""

from app.orchestrator.contracts import (
    CONTRACT_VERSION,
    AgentContext,
    AgentKind,
    AgentSpec,
    ExecutionEnvelope,
    ExecutionMode,
    Handoff,
    RunResult,
    ToolBudget,
)
__all__ = [
    "CONTRACT_VERSION",
    "AgentContext",
    "AgentKind",
    "AgentRegistry",
    "AgentSpec",
    "ExecutionEnvelope",
    "ExecutionMode",
    "Handoff",
    "Orchestrator",
    "RegisteredAgent",
    "RunResult",
    "RuntimeControls",
    "ToolBudget",
]


def __getattr__(name: str):
    """Keep package exports without eager cross-package import cycles."""
    if name in {"Orchestrator", "RuntimeControls"}:
        from app.orchestrator.orchestrator import Orchestrator, RuntimeControls

        return {"Orchestrator": Orchestrator, "RuntimeControls": RuntimeControls}[name]
    if name in {"AgentRegistry", "RegisteredAgent"}:
        from app.orchestrator.registry import AgentRegistry, RegisteredAgent

        return {"AgentRegistry": AgentRegistry, "RegisteredAgent": RegisteredAgent}[name]
    raise AttributeError(name)
