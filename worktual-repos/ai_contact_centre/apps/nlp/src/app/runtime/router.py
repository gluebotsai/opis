"""Agent Router for directing queries to domain specialist agents."""

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import replace
from typing import Any

from app.config import get_settings
from app.runtime.agent import Agent
from app.runtime.context import RunContext
from app.runtime.memory import SessionMemory
from app.runtime.orchestration import (
    FlatOrchestrationStrategy,
    OrchestrationMode,
    ThreeLayerOrchestrationStrategy,
)
from app.runtime.handoff import fill_handoff_query
from app.runtime.sse import (
    sse_action,
    sse_contact_draft,
    sse_done,
    sse_queue_draft,
    sse_routing,
)

logger = logging.getLogger("nlp.coworker.router")
_shadow_tasks: set[asyncio.Task[None]] = set()
_memory_tasks: set[asyncio.Task[None]] = set()

AGENT_HOME_PATHS: dict[str, dict[str, str]] = {
    "contact": {"admin": "/admin/contacts", "agent": "/agent/contacts"},
    "inbox": {"admin": "/admin/workspace", "agent": "/agent/workspace"},
    "task": {"admin": "/agent/tasks", "agent": "/agent/tasks"},
    "queue": {"admin": "/admin/workforce/queues"},
    "analytics": {"admin": "/admin/dashboard/analytics", "agent": "/agent/performance"},
    "monitoring": {"admin": "/admin/monitoring"},
    "general": {"admin": "/admin/dashboard", "agent": "/agent/workspace"},
}

def agent_home_path(agent_name: str, role: str) -> str | None:
    role_paths = AGENT_HOME_PATHS.get(agent_name)
    if not role_paths:
        return None
    return role_paths.get(role) or role_paths.get("agent") or role_paths.get("admin")


def _public_agent_name(agent_name: str, surface: str) -> str:
    if agent_name == "coworker_task_assist":
        return "inbox" if surface == "inbox" else "general"
    if agent_name == "conversation_assist":
        return "inbox"
    return agent_name


def _paths_differ(current_path: str, target_path: str) -> bool:
    return current_path.rstrip("/") != target_path.rstrip("/")


def _already_on_agent_home(agent_name: str, current_path: str, role: str) -> bool:
    current = current_path.rstrip("/")
    if agent_name == "analytics" and role == "admin":
        return current == "/admin/dashboard" or current.startswith("/admin/dashboard/")
    home = agent_home_path(agent_name, role)
    return bool(home) and not _paths_differ(current, home)


def _is_user_reply_frame(event_name: str | None, data: dict[str, Any]) -> bool:
    if event_name == "text_delta":
        return True
    return event_name == "status" and data.get("phase") == "writing"


def _parse_sse_frame(frame: str) -> tuple[str | None, dict[str, Any]]:
    event_name: str | None = None
    data_raw: str | None = None
    for line in frame.split("\n"):
        if line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            data_raw = line[5:].strip()
    data: dict[str, Any] = {}
    if data_raw:
        try:
            parsed = json.loads(data_raw)
            if isinstance(parsed, dict):
                data = parsed
        except (TypeError, ValueError):
            pass
    return event_name, data


def _strip_routing_prose(memory: SessionMemory) -> None:
    for message in reversed(memory.messages):
        if message.get("role") != "assistant":
            continue
        tool_calls = message.get("tool_calls") or []
        if any(str(call.get("function", {}).get("name")) == "route_to_agent" for call in tool_calls):
            message["content"] = ""
            return


def _prime_handoff_target(
    memory: SessionMemory,
    query: str | None,
    context: RunContext | None = None,
) -> None:
    _strip_routing_prose(memory)
    cleaned_query = str(query or "").strip()
    if not cleaned_query:
        return
    if context is not None:
        context.extra["handoff_this_turn"] = True
    memory.add_message(
        {
            "role": "system",
            "content": (
                "Handoff complete. Handle the user's request directly now. "
                f"Request: {cleaned_query}. "
                "Begin the workflow immediately in your first response. "
                "If this is a create or update workflow, call the staging tool in this "
                "same turn before asking the next question so the preview panel can open. "
                "Do not mention handoffs, routing, specialists, or other agents."
            ),
        }
    )


def _handoff_query(handoff: dict[str, Any], messages: list[dict[str, Any]]) -> str:
    filled = fill_handoff_query(dict(handoff), messages)
    return str(filled.get("query") or "").strip()


def _prime_invalid_handoff_recovery(
    memory: SessionMemory,
    current_agent: str,
    query: str,
) -> None:
    _strip_routing_prose(memory)
    request = query.strip() or "the user's last message"
    memory.add_message(
        {
            "role": "system",
            "content": (
                "The previous route_to_agent call did not transfer the turn. "
                f"You remain {current_agent}. Solve this request with your own tools now. "
                f"Request: {request}. Never call route_to_agent to yourself. "
                "Do not mention routing, handoffs, specialists, or this recovery."
            ),
        }
    )


def _collect_navigation_paths(messages: list[dict[str, Any]], role: str) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()
    for message in messages:
        if message.get("role") != "tool":
            continue
        name = str(message.get("name") or "")
        try:
            payload = json.loads(message.get("content") or "{}")
        except (TypeError, ValueError):
            payload = {}
        if name == "route_to_agent":
            target = str(payload.get("agent_name") or "")
            path = agent_home_path(target, role)
            if path and path not in seen:
                seen.add(path)
                paths.append(path)
        if name == "navigate":
            path = str(payload.get("path") or "")
            if path.startswith(("/admin/", "/agent/")) and path not in seen:
                seen.add(path)
                paths.append(path)
    return paths


def _handoff_error(
    handoff: dict[str, Any],
    current_agent: str,
    agents: dict[str, Agent],
    visited_agents: set[str],
    *,
    enforce_targets: bool = True,
) -> str | None:
    target = handoff.get("agent_name")
    query = handoff.get("query")
    if not isinstance(target, str) or not target.strip():
        return "Agent handoff requires a non-empty agent_name."
    if not isinstance(query, str) or not query.strip():
        return "Agent handoff requires a non-empty query."
    if target not in agents:
        return f"Agent '{target}' is not available."
    if target == current_agent:
        return f"Agent '{current_agent}' cannot hand off to itself."
    allowed_targets = agents[current_agent].definition.handoff_targets
    if enforce_targets and allowed_targets and target not in allowed_targets:
        return f"Agent '{current_agent}' cannot hand off to '{target}'."
    target_layer = agents[target].definition.layer
    if target in visited_agents and target_layer != "super":
        return f"Agent handoff cycle to '{target}' was prevented."
    if enforce_targets:
        current_layer = agents[current_agent].definition.layer
        allowed_edge = (
            (current_layer == "super" and target_layer == "domain")
            or (current_layer == "domain" and target_layer == "executor")
            or (current_layer == "executor" and target_layer == "super")
        )
        if not allowed_edge:
            return (
                f"Layer transition '{current_layer}' to '{target_layer}' is not allowed."
            )
    return None


async def _repair_missing_draft(
    agent: Agent,
    result: dict[str, Any],
    context: RunContext,
    memory: SessionMemory,
) -> dict[str, Any] | None:
    draft_kind = agent.definition.name
    draft_key = f"{draft_kind}_draft"
    if draft_kind not in {"contact", "queue"} or result.get(draft_key):
        return None
    active_workflow_skills = {
        "contact": {"contact-create", "contact-update", "contact-deactivate"},
        "queue": {"queue-create", "queue-update", "queue-staff", "queue-delete"},
    }[draft_kind]
    trusted_draft = context.extra.get(draft_key)
    handoff_this_turn = bool(context.extra.get("handoff_this_turn"))
    workflow_is_active = (
        isinstance(trusted_draft, dict)
        and not (
            trusted_draft.get("persistedContactId")
            or trusted_draft.get("persistedQueueId")
        )
    ) or bool(active_workflow_skills.intersection(context.active_skills))
    if not workflow_is_active and not handoff_this_turn:
        return None
    if result.get("response_type") not in {"general_response", "confirmation_required"}:
        return None
    repaired = await agent.repair_missing_workflow_draft(
        draft_kind,
        context,
        memory,
        str(result.get("response_type") or ""),
    )
    context.extra.pop("handoff_this_turn", None)
    return repaired


def _scope_active_skills(context: RunContext, target: Agent) -> None:
    """Keep only skills explicitly allowed by the handoff target."""
    allowed = set(target.definition.allowed_skills) | set(target.definition.required_skills)
    context.active_skills = {
        skill_id: skill
        for skill_id, skill in context.active_skills.items()
        if skill_id in allowed
    }


class AgentRouter:
    def __init__(
        self,
        agents: dict[str, Agent],
        default_agent_name: str = "general",
        memory: SessionMemory | None = None,
        max_handoffs: int = 5,
        orchestration_mode: OrchestrationMode | None = None,
        super_agent_name: str = "contact_center_super",
        internal_handoff_limit: int | None = None,
    ) -> None:
        if default_agent_name not in agents:
            raise ValueError(f"Default agent '{default_agent_name}' is not registered")
        self.agents = agents
        self.default_agent_name = default_agent_name
        self.memory = memory
        self.max_handoffs = max_handoffs
        self.orchestration_mode = orchestration_mode
        self.super_agent_name = super_agent_name
        self.internal_handoff_limit = internal_handoff_limit
        self.flat_strategy = FlatOrchestrationStrategy()
        self.three_layer_strategy = ThreeLayerOrchestrationStrategy(super_agent_name)

    def select_agent(self, surface: str) -> Agent:
        """Return the legacy surface-selected agent.

        This method intentionally remains the flat compatibility contract used
        by API fallbacks and existing tests.
        """
        context = RunContext(tenant_id="selection", surface=surface)
        target_name = self.flat_strategy.entry(context, self.default_agent_name).agent_name
        return self.agents.get(target_name, self.agents[self.default_agent_name])

    def mode_for(self, context: RunContext) -> OrchestrationMode:
        if self.orchestration_mode is not None:
            return self.orchestration_mode
        return get_settings().coworker_mas_mode_for(context.tenant_id)

    def select_entry_agent(self, context: RunContext) -> Agent:
        mode = self.mode_for(context)
        strategy = self.three_layer_strategy if mode == "three_layer" else self.flat_strategy
        decision = strategy.entry(context, self.default_agent_name)
        return self.agents.get(decision.agent_name, self.select_agent(context.surface))

    def _handoff_limit(self, mode: OrchestrationMode) -> int:
        if mode != "three_layer":
            return self.max_handoffs
        configured = self.internal_handoff_limit
        if configured is None:
            configured = get_settings().coworker_mas_internal_handoff_limit
        return max(self.max_handoffs + 2, configured)

    def _ensure_agent_memory(self, context: RunContext, agent: Agent) -> None:
        if context.agent_memory is not None or not get_settings().agent_memory_v2_enabled:
            return
        from app.memory import (
            AgentMemory,
            CcCoreAgentMemoryBackend,
            MemoryScope,
        )

        scope = MemoryScope(
            tenant_id=context.tenant_id,
            user_id=context.user_id,
            conversation_id=context.conversation_id,
            task_id=context.task_id,
        )
        backend = CcCoreAgentMemoryBackend(agent.build_tool_context(context))
        context.agent_memory = AgentMemory.in_process(
            scope,
            long_term=backend,
            preferences=backend,
        )

    @staticmethod
    def _next_visited(visited_agents: set[str], target: Agent) -> set[str]:
        if target.definition.layer == "super":
            return {target.definition.name}
        return {*visited_agents, target.definition.name}

    async def _run_agent(
        self,
        agent: Agent,
        messages: list[dict[str, Any]],
        context: RunContext,
        memory: SessionMemory,
        mode: OrchestrationMode,
        *,
        add_messages: bool = True,
    ) -> dict[str, Any]:
        if mode != "three_layer" or agent.definition.layer == "executor":
            return await agent.run(
                messages,
                context,
                memory,
                add_messages=add_messages,
            )
        try:
            async with asyncio.timeout(
                get_settings().coworker_mas_routing_timeout_seconds
            ):
                return await agent.run(
                    messages,
                    context,
                    memory,
                    add_messages=add_messages,
                )
        except TimeoutError:
            logger.warning(
                "Three-layer routing agent timed out",
                extra={"event": "coworker_mas_timeout", "agent": agent.definition.name},
            )
            return {"response_type": "orchestration_timeout", "messages": memory.get_messages()}

    async def _stream_agent_events(
        self,
        agent: Agent,
        messages: list[dict[str, Any]],
        context: RunContext,
        memory: SessionMemory,
        mode: OrchestrationMode,
    ) -> AsyncIterator[str]:
        if mode != "three_layer" or agent.definition.layer == "executor":
            async for event in agent.stream(messages, context, memory):
                yield event
            return
        try:
            async with asyncio.timeout(
                get_settings().coworker_mas_routing_timeout_seconds
            ):
                async for event in agent.stream(messages, context, memory):
                    yield event
        except TimeoutError:
            logger.warning(
                "Three-layer streaming router timed out",
                extra={"event": "coworker_mas_timeout", "agent": agent.definition.name},
            )

    def _schedule_shadow(self, messages: list[dict[str, Any]], context: RunContext) -> None:
        if self.mode_for(context) != "shadow" or self.super_agent_name not in self.agents:
            return
        shadow_context = replace(
            context,
            confirmed_actions=[],
            active_skills={},
            active_metrics={},
            active_schema=None,
            recent_tool_data=[],
            executed_tool_results={},
            agent_memory=None,
            extra=dict(context.extra),
        )
        task = asyncio.create_task(
            self._bounded_shadow_route(list(messages), shadow_context)
        )
        _shadow_tasks.add(task)
        task.add_done_callback(_shadow_tasks.discard)

    async def _bounded_shadow_route(
        self,
        messages: list[dict[str, Any]],
        context: RunContext,
    ) -> None:
        try:
            async with asyncio.timeout(
                get_settings().coworker_mas_routing_timeout_seconds
            ):
                await self._observe_shadow_route(messages, context)
        except TimeoutError:
            logger.warning(
                "Coworker MAS shadow routing timed out",
                extra={"event": "coworker_mas_shadow_timeout"},
            )

    def _schedule_memory_write(
        self,
        context: RunContext,
        agent: Agent,
        memory: SessionMemory,
    ) -> None:
        if (
            context.agent_memory is None
            or context.conversation_id is None
            or not get_settings().agent_memory_v2_enabled
        ):
            return
        user_text = ""
        assistant_text = ""
        for message in reversed(memory.get_messages()):
            role = message.get("role")
            content = str(message.get("content") or "").strip()
            if role == "assistant" and content and not assistant_text:
                assistant_text = content[:4000]
            if role == "user" and content and not user_text:
                user_text = content[:4000]
            if user_text and assistant_text:
                break
        if not user_text and not assistant_text:
            return
        view = context.agent_memory.for_agent(agent.definition.name)
        task = asyncio.create_task(
            self._persist_memory_item(
                view,
                {
                    "kind": "agent_turn",
                    "agent": agent.definition.name,
                    "surface": context.surface,
                    "user_request": user_text,
                    "assistant_response": assistant_text,
                },
            )
        )
        _memory_tasks.add(task)
        task.add_done_callback(_memory_tasks.discard)

    @staticmethod
    async def _persist_memory_item(view: Any, item: dict[str, Any]) -> None:
        try:
            await view.long_term.store(item)
        except Exception:
            logger.exception("Non-blocking long-term memory persistence failed")

    async def _observe_shadow_route(
        self,
        messages: list[dict[str, Any]],
        context: RunContext,
    ) -> None:
        memory = SessionMemory(context.conversation_id or "shadow")
        agent = self.agents[self.super_agent_name]
        chain = [agent.definition.name]
        try:
            result = fill_handoff_query(
                await agent.run(messages, context, memory),
                memory.get_messages(),
            )
            while result.get("response_type") == "routing_response" and len(chain) < 3:
                target_name = str(result.get("agent_name") or "")
                if target_name not in self.agents:
                    break
                target = self.agents[target_name]
                chain.append(target_name)
                if target.definition.layer == "executor":
                    break
                _prime_handoff_target(memory, str(result.get("query") or ""), context)
                result = fill_handoff_query(
                    await target.run([], context, memory, add_messages=False),
                    memory.get_messages(),
                )
            logger.info(
                "Coworker MAS shadow route",
                extra={
                    "event": "coworker_mas_shadow",
                    "tenant_id": context.tenant_id,
                    "surface": context.surface,
                    "routing_chain": chain,
                },
            )
        except Exception:
            logger.exception("Coworker MAS shadow routing failed")

    async def route_and_run(
        self,
        messages: list[dict[str, Any]],
        context: RunContext,
    ) -> dict[str, Any]:
        mode = self.mode_for(context)
        self._schedule_shadow(messages, context)
        agent = self.select_entry_agent(context)
        self._ensure_agent_memory(context, agent)
        memory = self.memory or SessionMemory(context.conversation_id or "request")
        result = await self._run_agent(agent, messages, context, memory, mode)
        handoffs = 0
        internal_handoffs = 0
        executor_handoffs = 0
        invalid_recoveries = 0
        visited_agents = {agent.definition.name}
        routing_chain = [agent.definition.name]
        prompt_versions = {
            agent.definition.name: agent.definition.prompt_version
        }
        while result.get("response_type") == "routing_response":
            internal_edge = mode == "three_layer" and agent.definition.layer in {
                "super",
                "domain",
            }
            if (
                internal_edge
                and internal_handoffs >= self._handoff_limit(mode)
            ) or (
                not internal_edge
                and executor_handoffs >= self.max_handoffs
            ):
                if internal_edge and executor_handoffs == 0:
                    fallback = self.select_agent(context.surface)
                    fallback_memory = self.memory or SessionMemory(
                        context.conversation_id or "request"
                    )
                    return await fallback.run(messages, context, fallback_memory)
                _prime_invalid_handoff_recovery(
                    memory,
                    agent.definition.name,
                    str(result.get("query") or ""),
                )
                result = await self._run_agent(
                    agent,
                    [],
                    context,
                    memory,
                    mode,
                    add_messages=False,
                )
                continue
            result = fill_handoff_query(result, memory.get_messages())
            error = _handoff_error(
                result,
                agent.definition.name,
                self.agents,
                visited_agents,
                enforce_targets=mode == "three_layer",
            )
            if error:
                logger.warning(
                    "Invalid coworker handoff recovered in-agent",
                    extra={
                        "event": "coworker_handoff_recovered",
                        "agent": agent.definition.name,
                        "target": result.get("agent_name"),
                        "error": error,
                    },
                )
                if internal_edge and executor_handoffs == 0:
                    fallback = self.select_agent(context.surface)
                    fallback_memory = self.memory or SessionMemory(
                        context.conversation_id or "request"
                    )
                    return await fallback.run(messages, context, fallback_memory)
                invalid_recoveries += 1
                if invalid_recoveries > 3:
                    fallback = self.select_agent(context.surface)
                    fallback_memory = self.memory or SessionMemory(
                        context.conversation_id or "request"
                    )
                    return await fallback.run(messages, context, fallback_memory)
                _prime_invalid_handoff_recovery(
                    memory,
                    agent.definition.name,
                    str(result.get("query") or ""),
                )
                result = await self._run_agent(
                    agent,
                    [],
                    context,
                    memory,
                    mode,
                    add_messages=False,
                )
                continue
            handoffs += 1
            if internal_edge:
                internal_handoffs += 1
            else:
                executor_handoffs += 1
            target_name = str(result["agent_name"])
            target = self.agents[target_name]
            routing_chain.append(target_name)
            prompt_versions[target_name] = target.definition.prompt_version
            visited_agents = self._next_visited(visited_agents, target)
            agent = target
            _scope_active_skills(context, target)
            _prime_handoff_target(memory, str(result.get("query") or ""), context)
            result = await self._run_agent(
                agent,
                [],
                context,
                memory,
                mode,
                add_messages=False,
            )
        if mode == "three_layer" and agent.definition.layer in {"super", "domain"}:
            logger.warning(
                "Three-layer router fell back before executor selection",
                extra={"event": "coworker_mas_fallback", "agent": agent.definition.name},
            )
            fallback = self.select_agent(context.surface)
            fallback_memory = self.memory or SessionMemory(context.conversation_id or "request")
            return await fallback.run(messages, context, fallback_memory)
        result["routing_chain"] = routing_chain
        result["prompt_versions"] = prompt_versions
        public_agent = _public_agent_name(agent.definition.name, context.surface)
        if public_agent != agent.definition.name:
            result["internal_agent"] = agent.definition.name
            result["agent"] = public_agent
        navigation_paths = [
            path
            for path in _collect_navigation_paths(result.get("messages", []), context.role)
            if _paths_differ(context.path, path)
        ]
        if navigation_paths:
            result["navigation_paths"] = navigation_paths
        if agent.definition.name in {"contact", "queue"}:
            repaired_draft = await _repair_missing_draft(agent, result, context, memory)
            if repaired_draft is not None:
                result[f"{agent.definition.name}_draft"] = repaired_draft
                result["messages"] = memory.get_messages()
        self._schedule_memory_write(context, agent, memory)
        return result

    async def stream(
        self,
        messages: list[dict[str, Any]],
        context: RunContext,
    ) -> AsyncIterator[str]:
        """Forward agent.stream live so tool progress arrives while tools run."""
        original_messages = list(messages)
        mode = self.mode_for(context)
        self._schedule_shadow(messages, context)
        agent = self.select_entry_agent(context)
        self._ensure_agent_memory(context, agent)
        memory = self.memory or SessionMemory(context.conversation_id or "request")
        pending_messages = messages
        handoffs = 0
        internal_handoffs = 0
        executor_handoffs = 0
        invalid_recoveries = 0
        visited_agents = {agent.definition.name}
        routing_chain = [agent.definition.name]
        prompt_versions = {
            agent.definition.name: agent.definition.prompt_version
        }
        saw_contact_draft = False
        saw_queue_draft = False

        if mode == "three_layer":
            yield sse_routing(agent_name=self.super_agent_name)

        while True:
            handoff_args: dict[str, Any] | None = None
            terminal_done: str | None = None
            pending_reply: list[str] = []
            passthrough_reply = False
            publish_executor = mode != "three_layer" or agent.definition.layer == "executor"
            async for frame in self._stream_agent_events(
                agent,
                pending_messages,
                context,
                memory,
                mode,
            ):
                event_name, data = _parse_sse_frame(frame)
                if event_name == "tool_call" and data.get("tool") == "route_to_agent":
                    args = data.get("args")
                    parsed = args if isinstance(args, dict) else {}
                    target = str(parsed.get("agent_name") or "").strip()
                    if target and target != agent.definition.name:
                        handoff_args = parsed
                        pending_reply.clear()
                elif event_name == "tool_call":
                    passthrough_reply = True
                    if publish_executor:
                        for buffered in pending_reply:
                            yield buffered
                    pending_reply.clear()
                if event_name == "contact_draft":
                    saw_contact_draft = True
                if event_name == "queue_draft":
                    saw_queue_draft = True
                if event_name == "done" and handoff_args is not None:
                    # Intermediate done from a handoff — continue with the target agent.
                    break
                if event_name == "done":
                    if publish_executor:
                        for buffered in pending_reply:
                            yield buffered
                    pending_reply.clear()
                    terminal_done = sse_done(
                        turn_id=str(data.get("turnId") or "") or None,
                        route=_public_agent_name(agent.definition.name, context.surface),
                        routing_chain=routing_chain,
                        prompt_versions=prompt_versions,
                    )
                    continue
                if not publish_executor:
                    continue
                if _is_user_reply_frame(event_name, data):
                    if handoff_args is not None:
                        continue
                    if passthrough_reply:
                        yield frame
                    else:
                        pending_reply.append(frame)
                    continue
                yield frame
            else:
                # Stream finished without a pending handoff.
                if mode == "three_layer" and agent.definition.layer in {"super", "domain"}:
                    logger.warning(
                        "Three-layer stream fell back before executor selection",
                        extra={"event": "coworker_mas_fallback", "agent": agent.definition.name},
                    )
                    mode = "flat"
                    agent = self.select_agent(context.surface)
                    memory = self.memory or SessionMemory(context.conversation_id or "request")
                    pending_messages = original_messages
                    handoffs = 0
                    internal_handoffs = 0
                    executor_handoffs = 0
                    visited_agents = {agent.definition.name}
                    routing_chain = [agent.definition.name]
                    prompt_versions = {
                        agent.definition.name: agent.definition.prompt_version
                    }
                    terminal_done = None
                    continue
                if agent.definition.name == "contact" and not saw_contact_draft:
                    draft = await _repair_missing_draft(
                        agent,
                        {"response_type": "general_response"},
                        context,
                        memory,
                    )
                    if isinstance(draft, dict):
                        yield sse_contact_draft(draft)
                if agent.definition.name == "queue" and not saw_queue_draft:
                    draft = await _repair_missing_draft(
                        agent,
                        {"response_type": "general_response"},
                        context,
                        memory,
                    )
                    if isinstance(draft, dict):
                        yield sse_queue_draft(draft)
                if terminal_done is not None:
                    yield terminal_done
                self._schedule_memory_write(context, agent, memory)
                return

            internal_edge = mode == "three_layer" and agent.definition.layer in {
                "super",
                "domain",
            }
            if (
                internal_edge
                and internal_handoffs >= self._handoff_limit(mode)
            ) or (
                not internal_edge
                and executor_handoffs >= self.max_handoffs
            ):
                if internal_edge and executor_handoffs == 0:
                    mode = "flat"
                    agent = self.select_agent(context.surface)
                    memory = self.memory or SessionMemory(
                        context.conversation_id or "request"
                    )
                    pending_messages = original_messages
                    handoffs = 0
                    internal_handoffs = 0
                    executor_handoffs = 0
                    visited_agents = {agent.definition.name}
                    routing_chain = [agent.definition.name]
                    prompt_versions = {
                        agent.definition.name: agent.definition.prompt_version
                    }
                    continue
                invalid_recoveries += 1
                if invalid_recoveries > 3:
                    fallback = self.select_agent(context.surface)
                    if fallback.definition.name != agent.definition.name:
                        agent = fallback
                        pending_messages = original_messages
                    else:
                        pending_messages = []
                    continue
                _prime_invalid_handoff_recovery(
                    memory,
                    agent.definition.name,
                    _handoff_query(
                        handoff_args or {},
                        memory.get_messages() or original_messages,
                    ),
                )
                pending_messages = []
                handoff_args = None
                continue
            handoff_args = fill_handoff_query(
                handoff_args or {},
                memory.get_messages() or original_messages,
            )
            error = _handoff_error(
                handoff_args,
                agent.definition.name,
                self.agents,
                visited_agents,
                enforce_targets=mode == "three_layer",
            )
            if error:
                logger.warning(
                    "Invalid coworker handoff recovered in-agent",
                    extra={
                        "event": "coworker_handoff_recovered",
                        "agent": agent.definition.name,
                        "target": handoff_args.get("agent_name"),
                        "error": error,
                    },
                )
                if internal_edge and executor_handoffs == 0:
                    mode = "flat"
                    agent = self.select_agent(context.surface)
                    memory = self.memory or SessionMemory(
                        context.conversation_id or "request"
                    )
                    pending_messages = original_messages
                    handoffs = 0
                    internal_handoffs = 0
                    executor_handoffs = 0
                    visited_agents = {agent.definition.name}
                    routing_chain = [agent.definition.name]
                    prompt_versions = {
                        agent.definition.name: agent.definition.prompt_version
                    }
                    continue
                invalid_recoveries += 1
                if invalid_recoveries > 3:
                    fallback = self.select_agent(context.surface)
                    if fallback.definition.name != agent.definition.name:
                        agent = fallback
                        pending_messages = original_messages
                        continue
                _prime_invalid_handoff_recovery(
                    memory,
                    agent.definition.name,
                    str(handoff_args.get("query") or ""),
                )
                pending_messages = []
                continue
            handoffs += 1
            if internal_edge:
                internal_handoffs += 1
            else:
                executor_handoffs += 1
            target_name = str((handoff_args or {})["agent_name"])
            target = self.agents[target_name]
            routing_chain.append(target_name)
            prompt_versions[target_name] = target.definition.prompt_version
            visited_agents = self._next_visited(visited_agents, target)
            _scope_active_skills(context, target)
            path = agent_home_path(target_name, context.role)
            if path and not _already_on_agent_home(target_name, context.path, context.role):
                yield sse_routing(path)
                yield sse_action("navigate", {"path": path})
            agent = target
            _prime_handoff_target(memory, str((handoff_args or {}).get("query") or ""), context)
            pending_messages = []

    async def stream_direct(
        self,
        agent_name: str,
        messages: list[dict[str, Any]],
        context: RunContext,
    ) -> AsyncIterator[str]:
        """Invoke an isolated event-driven executor without L1/L2 routing."""
        if agent_name not in self.agents:
            raise ValueError(f"Direct agent '{agent_name}' is not registered")
        agent = self.agents[agent_name]
        if agent.definition.layer != "executor":
            raise ValueError("Direct invocation is allowed only for executor agents")
        _scope_active_skills(context, agent)
        self._ensure_agent_memory(context, agent)
        memory = self.memory or SessionMemory(context.conversation_id or "request")
        async for event in agent.stream(messages, context, memory):
            yield event
        self._schedule_memory_write(context, agent, memory)
