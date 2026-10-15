"""LLM-primary initial agent router with typed output validation."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, Optional, Sequence

from pydantic import BaseModel, Field

from app.agents.agent_md import load_agent_md
from app.agents.llm_result import extract_json, sectioned_system_prompt
from app.orchestrator.contracts import AgentContext, AgentSpec
from app.orchestrator.errors import ContractError, DeadlineExceededError

_SUPERVISOR_MD = (
    Path(__file__).resolve().parents[1] / "agents" / "supervisor" / "agent.md"
)

RouterLlm = Callable[..., Awaitable[Optional[Dict[str, Any]]]]


class RouteDecision(BaseModel):
    agent: str = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=500)


class LlmRouter:
    """Routing is model-selected; code only validates candidates and policy."""

    def __init__(self, llm: Optional[RouterLlm] = None) -> None:
        if llm is None:
            from app.llm import chat_with_tools

            llm = chat_with_tools
        self.llm = llm

    async def route(
        self,
        *,
        context: AgentContext,
        candidates: Sequence[AgentSpec],
        user_text: str,
    ) -> RouteDecision:
        allowed = {candidate.name for candidate in candidates}
        spec = load_agent_md(str(_SUPERVISOR_MD))
        memory_slots = (
            context.memory.get("slots")
            if isinstance(context.memory, dict)
            and isinstance(context.memory.get("slots"), dict)
            else {}
        )
        reports_context = (
            memory_slots.get("reportsContext")
            if isinstance(memory_slots.get("reportsContext"), dict)
            else None
        )
        prompt = sectioned_system_prompt(
            role=spec["role"],
            goal=spec["goal"],
            instructions=spec["instructions"],
            context=json.dumps(
                {
                    "candidates": [
                        {"name": item.name, "description": item.description}
                        for item in candidates
                    ],
                    "previousAgent": context.metadata.get("previousAgent")
                    or context.metadata.get("activeAgent"),
                    "taskContinuity": (
                        {
                            key: reports_context.get(key)
                            for key in (
                                "objectLock",
                                "timePhrase",
                                "lastKpiId",
                                "lastAnswerType",
                                "lastSummary",
                            )
                            if reports_context.get(key)
                        }
                        if reports_context
                        else None
                    ),
                    "surface": {
                        "module": context.metadata.get("activeDomain"),
                        **{
                            key: context.metadata[key]
                            for key in ("surfaceModule", "pathname")
                            if key in context.metadata
                        },
                    },
                },
                default=str,
            ),
            output=spec["output"],
            guardrails=spec["guardrails"],
        )
        from app.agent_log import console_coworker, trace, trace_api

        for attempt in range(2):
            remaining = context.envelope.remaining_seconds()
            if remaining <= 0:
                raise DeadlineExceededError("Deadline exceeded before routing")
            retry_instruction = (
                "\n\nYour previous response was invalid. Return exactly the required "
                "JSON object and select one agent from the supplied candidates."
                if attempt
                else ""
            )
            response = await asyncio.wait_for(
                self.llm(
                    messages=[
                        {"role": "system", "content": prompt},
                        {
                            "role": "user",
                            "content": user_text + retry_instruction,
                        },
                    ],
                    tools=None,
                    max_tokens=200,
                    timeout_ms=max(1, int(remaining * 1000)),
                    temperature=0.0,
                ),
                timeout=remaining,
            )
            raw_content = str((response or {}).get("content") or "")
            console_coworker("llm", kind="router", text=raw_content or "(no text)")
            trace_api(
                agent="native-coworker",
                service="llm",
                operation="router_retry" if attempt else "router",
                ok=bool(raw_content),
            )
            parsed = extract_json(raw_content)
            if parsed:
                try:
                    decision = RouteDecision.model_validate(parsed)
                    if decision.agent in allowed:
                        trace(
                            agent="native-coworker",
                            step="route",
                            targetAgent=decision.agent,
                            reason=decision.reason,
                            source=(
                                "llm_router_retry" if attempt else "llm_router"
                            ),
                        )
                        return decision
                except Exception:  # noqa: BLE001
                    pass

        continuity = str(
            context.metadata.get("previousAgent")
            or context.metadata.get("activeAgent")
            or ""
        )
        if continuity in allowed:
            trace(
                agent="native-coworker",
                step="route",
                targetAgent=continuity,
                reason="llm_router_invalid_json_continuity",
                source="continuity",
            )
            return RouteDecision(
                agent=continuity,
                reason="llm_router_invalid_json_continuity",
            )
        raise ContractError("Router returned invalid JSON after retry")
