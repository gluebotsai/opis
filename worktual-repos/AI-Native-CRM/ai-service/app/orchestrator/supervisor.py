"""Coworker supervisor with explicit active-agent continuity and handoffs."""

from __future__ import annotations

from typing import Optional, Sequence

from app.orchestrator.contracts import AgentContext, AgentSpec, Handoff, RunResult
from app.orchestrator.handoffs import HandoffTracker
from app.orchestrator.registry import AgentRegistry
from app.orchestrator.router import LlmRouter


class Supervisor:
    def __init__(
        self,
        registry: AgentRegistry,
        router: LlmRouter,
        *,
        max_handoffs: int = 3,
    ) -> None:
        self.registry = registry
        self.router = router
        self.handoffs = HandoffTracker(max_handoffs=max_handoffs)

    async def run(
        self,
        *,
        context: AgentContext,
        candidates: Sequence[AgentSpec],
        user_text: str,
        active_agent: Optional[str] = None,
    ) -> RunResult:
        """Run one turn; active agent is request state, never mutable global state."""
        from app.agent_log import console_coworker, trace
        from app.observability.turn_log import record_route, turn_active

        history: tuple[Handoff, ...] = ()
        context = context.model_copy(
            update={
                "metadata": {
                    **context.metadata,
                    "previousAgent": active_agent or context.metadata.get("previousAgent") or "",
                }
            }
        )
        decision = await self.router.route(
            context=context, candidates=candidates, user_text=user_text
        )
        current = decision.agent
        if turn_active():
            record_route(active_agent, current, query=user_text)
        trace(
            agent="native-coworker",
            step="route",
            targetAgent=current,
            reason=decision.reason,
            previousAgent=active_agent,
            user=user_text,
        )
        console_coworker(
            "route",
            agent=current,
            reason=decision.reason,
        )

        while True:
            registered = self.registry.get(current)
            result = await registered.runner(context)
            raw_handoff = getattr(result, "handoff", None)
            if not raw_handoff:
                return result
            handoff = (
                raw_handoff
                if isinstance(raw_handoff, Handoff)
                else Handoff.model_validate(raw_handoff)
            )
            if handoff.from_agent != current:
                handoff = handoff.model_copy(update={"from_agent": current})
            history = self.handoffs.append(history, handoff)
            from app.agent_log import trace_handoff
            from app.observability.turn_log import record_route, turn_active

            if turn_active():
                record_route(
                    handoff.from_agent,
                    handoff.to_agent,
                    query=getattr(handoff, "reason", None),
                )
            trace_handoff(
                from_agent=handoff.from_agent,
                to_agent=handoff.to_agent,
                reason=getattr(handoff, "reason", None),
            )
            console_coworker(
                "handoff",
                from_agent=handoff.from_agent,
                to_agent=handoff.to_agent,
                reason=getattr(handoff, "reason", None),
            )
            self.registry.get(handoff.to_agent)
            context = context.model_copy(
                update={
                    "metadata": {
                        **context.metadata,
                        **handoff.context_patch,
                        "handoffHistory": [
                            item.model_dump(by_alias=True) for item in history
                        ],
                    }
                }
            )
            current = handoff.to_agent
