"""Backward-compatible entry strategies for co-worker orchestration."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

from app.runtime.context import RunContext

OrchestrationMode = Literal["flat", "shadow", "three_layer"]

FLAT_SURFACE_AGENT: dict[str, str] = {
    "contacts-list": "contact",
    "contacts-detail": "contact",
    "inbox": "inbox",
    "tasks-list": "task",
    "tasks-detail": "task",
    "queues-list": "queue",
    "queue-create": "queue",
    "queue-detail": "queue",
    "queue-edit": "queue",
    "workforce": "queue",
    "performance": "reports_analytics_agent",
    "reports": "reports_analytics_agent",
    "dashboard": "reports_analytics_agent",
    "analytics": "reports_analytics_agent",
    "monitoring": "monitoring",
}


@dataclass(frozen=True)
class EntryDecision:
    agent_name: str
    mode: OrchestrationMode
    authoritative: bool = True


class OrchestrationStrategy(Protocol):
    mode: OrchestrationMode

    def entry(self, context: RunContext, default_agent_name: str) -> EntryDecision: ...


@dataclass(frozen=True)
class FlatOrchestrationStrategy:
    mode: OrchestrationMode = "flat"

    def entry(self, context: RunContext, default_agent_name: str) -> EntryDecision:
        return EntryDecision(
            agent_name=FLAT_SURFACE_AGENT.get(context.surface, default_agent_name),
            mode=self.mode,
        )


@dataclass(frozen=True)
class ThreeLayerOrchestrationStrategy:
    super_agent_name: str = "contact_center_super"
    mode: OrchestrationMode = "three_layer"

    def entry(self, context: RunContext, default_agent_name: str) -> EntryDecision:
        del context, default_agent_name
        return EntryDecision(agent_name=self.super_agent_name, mode=self.mode)

