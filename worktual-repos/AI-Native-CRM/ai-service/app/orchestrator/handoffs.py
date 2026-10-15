"""Per-run handoff validation with limits and cycle detection."""

from __future__ import annotations

from typing import Sequence

from app.orchestrator.contracts import Handoff
from app.orchestrator.errors import HandoffCycleError, HandoffLimitError


class HandoffTracker:
    def __init__(self, *, max_handoffs: int = 3) -> None:
        if not 0 <= max_handoffs <= 3:
            raise ValueError("max_handoffs must be between zero and three")
        self.max_handoffs = max_handoffs

    def append(self, history: Sequence[Handoff], handoff: Handoff) -> tuple[Handoff, ...]:
        if len(history) >= self.max_handoffs:
            raise HandoffLimitError("Maximum handoff count reached")
        edges = {(item.from_agent, item.to_agent) for item in history}
        if (handoff.from_agent, handoff.to_agent) in edges:
            raise HandoffCycleError("Repeated handoff edge detected")
        path = [history[0].from_agent] if history else [handoff.from_agent]
        path.extend(item.to_agent for item in history)
        if handoff.to_agent in path:
            raise HandoffCycleError("Handoff would create an agent cycle")
        return (*history, handoff)
