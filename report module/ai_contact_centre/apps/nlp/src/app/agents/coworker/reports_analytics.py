"""Adapter for reports_analytics_agent in the co-worker runtime."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import logging

from app.agents.definitions import REPORTS_ANALYTICS_AGENT_DEFINITION
from app.config import get_settings
from app.runtime.agent import Agent
from app.runtime.context import RunContext
from app.runtime.memory import SessionMemory
from app.runtime.sse import sse_done, sse_text_delta, sse_thinking, sse_writing

logger = logging.getLogger("nlp.coworker.reports_analytics")


class ReportsAnalyticsAgent(Agent):
    """Wrap reports_analytics_agent.core.turn.run_turn() as an NLP Agent.

    Unlike standard agents that use the LLM tool loop, this agent delegates
    entirely to the reports module's internal pipeline:
      1. Domain planner classifies the question (certified_metric / free_sql / why_links)
      2. SQL executor runs certified KPI templates or LLM-generated SELECTs
      3. KG executor runs Cypher queries against Neo4j for causal analysis
      4. Facts are assembled and the brief is grounded (no hallucinated numbers)

    The adapter extracts the user's question and runtime context, calls run_turn()
    synchronously (offloaded to a thread), and returns the grounded HTML response.
    Both run() and stream() use that path — stream does not use the LLM tool loop.
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(REPORTS_ANALYTICS_AGENT_DEFINITION, **kwargs)

    async def _complete(
        self,
        messages: list[dict[str, Any]],
        context: RunContext,
        memory: SessionMemory | None = None,
        *,
        add_messages: bool = True,
    ) -> dict[str, Any]:
        memory = memory or SessionMemory(context.conversation_id or "default")
        if add_messages:
            memory.extend(messages)

        user_text = ""
        for msg in reversed(memory.get_messages()):
            if msg.get("role") == "user":
                user_text = str(msg.get("content") or "")
                break

        org_id = int(context.tenant_id) if str(context.tenant_id).isdigit() else 0
        uid = int(context.user_id) if str(context.user_id).isdigit() else 0
        role = context.role or "admin"
        dsn = get_settings().database_url

        recent_turns: list[dict[str, str]] = []
        for msg in memory.get_messages()[-8:]:
            r = msg.get("role")
            c = msg.get("content")
            if r in ("user", "assistant") and c:
                recent_turns.append({"role": str(r), "content": str(c)})

        queue_ids = None
        if context.queue_id and str(context.queue_id).isdigit():
            queue_ids = [int(context.queue_id)]

        from app.agents.reports_analytics_agent.core.turn import run_turn

        try:
            result = await asyncio.to_thread(
                run_turn,
                question=user_text,
                organization_id=org_id,
                user_id=uid,
                role=role,
                dsn=dsn,
                queue_ids=queue_ids,
                recent_turns=recent_turns if len(recent_turns) > 1 else None,
            )
        except Exception:
            logger.exception("reports_analytics_agent run_turn failed")
            reply = (
                "<p>I could not retrieve that report just now. "
                "Please try the question again in a moment.</p>"
            )
            memory.add_message({"role": "assistant", "content": reply})
            return {
                "response_type": "general_response",
                "reply": reply,
                "messages": memory.get_messages(),
                "agent": "reports_analytics_agent",
                "card": "card: none",
                "trace": None,
                "grounded": False,
            }

        reply = result.get("answer") or "<p>Report generated.</p>"
        card = result.get("card") or "card: none"

        memory.add_message({"role": "assistant", "content": reply})

        return {
            "response_type": "general_response",
            "reply": reply,
            "messages": memory.get_messages(),
            "agent": "reports_analytics_agent",
            "card": card,
            "trace": result.get("trace"),
            "grounded": result.get("grounded", False),
        }

    async def run(
        self,
        messages: list[dict[str, Any]],
        context: RunContext,
        memory: SessionMemory | None = None,
        *,
        add_messages: bool = True,
    ) -> dict[str, Any]:
        return await self._complete(
            messages,
            context,
            memory,
            add_messages=add_messages,
        )

    async def stream(
        self,
        messages: list[dict[str, Any]],
        context: RunContext,
        memory: SessionMemory | None = None,
    ) -> AsyncIterator[str]:
        yield sse_thinking(context.surface)
        result = await self._complete(messages, context, memory, add_messages=True)
        reply = str(result.get("reply") or "")
        if reply:
            yield sse_writing()
            yield sse_text_delta(reply)
        yield sse_done(
            route="reports_analytics_agent",
            routing_chain=["reports_analytics_agent"],
            prompt_versions={
                self.definition.name: self.definition.prompt_version,
            },
        )
