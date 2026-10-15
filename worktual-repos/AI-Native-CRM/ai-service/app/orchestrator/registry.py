"""Immutable-after-construction registry for all native agent kinds."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Awaitable, Callable, Dict, Iterable, Mapping

from app.orchestrator.contracts import AgentContext, AgentSpec, RunResult
from app.orchestrator.errors import AgentNotFoundError, ContractError

AgentRunner = Callable[[AgentContext], Awaitable[RunResult]]


@dataclass(frozen=True)
class RegisteredAgent:
    spec: AgentSpec
    runner: AgentRunner


class AgentRegistry:
    """A registry instance is explicit; there is no process-global active agent."""

    def __init__(self, agents: Iterable[RegisteredAgent] = ()) -> None:
        entries: Dict[str, RegisteredAgent] = {}
        for agent in agents:
            if agent.spec.name in entries:
                raise ContractError(f"Duplicate agent: {agent.spec.name}")
            entries[agent.spec.name] = agent
        self._entries: Mapping[str, RegisteredAgent] = MappingProxyType(entries)

    def get(self, name: str) -> RegisteredAgent:
        try:
            return self._entries[name]
        except KeyError as exc:
            raise AgentNotFoundError(f"Unknown native agent: {name}") from exc

    def specs(self) -> tuple[AgentSpec, ...]:
        return tuple(entry.spec for entry in self._entries.values())

    def with_agent(self, agent: RegisteredAgent) -> "AgentRegistry":
        return AgentRegistry((*self._entries.values(), agent))
