"""Supervisor → specialist loop. Handoff is an LLM tool call, never a keyword map."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Callable

from sql_agent.agent import AgentTurn, Completer, SqlDeveloperAgent
from sql_agent.history import history_messages
from sql_agent.minimax import MiniMaxClient
from sql_agent.prompt import build_system_prompt
from sql_agent.status import StatusEvent
from sql_agent.tools import SqlAgentTools, parse_tool_arguments

MAX_SUPERVISOR_ROUNDS = 4

ROUTE_TO_AGENT_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": "route_to_agent",
        "description": (
            "Hand the current request to a specialist. "
            "Use sql_developer for analytics, KPI, catalog, SQL, or reporting questions."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "agent_name": {
                    "type": "string",
                    "enum": ["sql_developer"],
                    "description": "Specialist to receive the request",
                },
                "query": {
                    "type": "string",
                    "description": "The user question to pass through unchanged",
                },
            },
            "required": ["agent_name", "query"],
            "additionalProperties": False,
        },
    },
}

SPECIALISTS = frozenset({"sql_developer"})


@dataclass
class OrchestratorTurn:
    reply: str
    model: str
    host: str = ""
    routed_to: str | None = None
    supervisor_rounds: int = 0
    specialist: AgentTurn | None = None
    events: list[StatusEvent] = field(default_factory=list)
    elapsed_ms: int = 0


class SqlOrchestrator:
    def __init__(
        self,
        *,
        tools: SqlAgentTools | None = None,
        client: Completer | None = None,
    ) -> None:
        self.client = client or MiniMaxClient()
        catalog_tools = tools or SqlAgentTools()
        self.specialist = SqlDeveloperAgent(tools=catalog_tools, client=self.client)
        self.system_prompt = build_system_prompt("sql_supervisor")

    def run(
        self,
        question: str,
        *,
        period_start: str | None = None,
        period_end: str | None = None,
        history: list[dict[str, Any]] | None = None,
        on_event: Callable[[StatusEvent], None] | None = None,
    ) -> OrchestratorTurn:
        started = time.perf_counter()
        events: list[StatusEvent] = []

        def notify(event: StatusEvent) -> None:
            events.append(event)
            if on_event is not None:
                on_event(event)

        def emit(agent: str, state: str, detail: str = "", **kwargs: Any) -> None:
            notify(StatusEvent(agent=agent, state=state, detail=detail, **kwargs))

        emit("sql_supervisor", "thinking", "reading the user question")
        messages: list[dict[str, Any]] = [{"role": "system", "content": self.system_prompt}]
        messages.extend(history_messages(history))
        messages.append({"role": "user", "content": question.strip()})
        model = ""
        reply = ""
        routed_to: str | None = None
        specialist_turn: AgentTurn | None = None
        rounds = 0
        for rounds in range(1, MAX_SUPERVISOR_ROUNDS + 1):
            result = self.client.complete(messages, tools=[ROUTE_TO_AGENT_TOOL])
            model = str(result.get("model") or model)
            tool_calls = result.get("tool_calls") or []
            content = str(result.get("content") or "")
            if not tool_calls:
                emit("sql_supervisor", "writing", "answering without a specialist")
                reply = content
                emit("sql_supervisor", "done", "replied directly")
                break
            route = next(
                (
                    call
                    for call in tool_calls
                    if str((call.get("function") or {}).get("name") or "") == "route_to_agent"
                ),
                None,
            )
            if route is None:
                emit("sql_supervisor", "error", "unknown tool on router")
                reply = "<p>I could not route that request.</p>"
                break
            arguments = parse_tool_arguments(str((route.get("function") or {}).get("arguments") or "{}"))
            target = str(arguments.get("agent_name") or "").strip()
            handed = str(arguments.get("query") or question).strip() or question.strip()
            emit(
                "sql_supervisor",
                "routing",
                f"route_to_agent → {target}",
                tool="route_to_agent",
            )
            if target not in SPECIALISTS:
                emit("sql_supervisor", "error", f"unknown specialist {target}")
                reply = "<p>That specialist is not available in this experiment.</p>"
                break
            routed_to = target
            emit("sql_supervisor", "done", f"handed off to {target}")
            specialist_turn = self.specialist.ask(
                handed,
                period_start=period_start,
                period_end=period_end,
                history=history,
                on_event=notify,
            )
            reply = specialist_turn.reply
            model = specialist_turn.model or model
            break
        else:
            reply = reply or "<p>The router reached its turn limit before handing off.</p>"
            emit("sql_supervisor", "error", "turn limit")

        host = ""
        settings = getattr(self.client, "settings", None)
        if settings is not None:
            host = getattr(settings, "host", "")
            model = model or getattr(settings, "model", "")
        if specialist_turn is not None:
            host = specialist_turn.host or host
        return OrchestratorTurn(
            reply=reply,
            model=model,
            host=host,
            routed_to=routed_to,
            supervisor_rounds=rounds,
            specialist=specialist_turn,
            events=events,
            elapsed_ms=int((time.perf_counter() - started) * 1000),
        )
