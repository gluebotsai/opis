"""Top-level native orchestrator entrypoint."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.orchestrator.contracts import AgentContext, ExecutionEnvelope, ExecutionMode, RunResult
from app.orchestrator.errors import ContractError, DeadlineExceededError, PolicyViolationError
from app.orchestrator.hooks import HookChain
from app.orchestrator.registry import AgentRegistry
from app.orchestrator.tracing import NullTraceSink, TraceSink, trace_span
from app.memory.manager import MemoryManager
from app.skills.registry import DEFAULT_SKILL_REGISTRY, SkillRegistry


class RuntimeControls(BaseModel):
    """Rollout controls; mutation paths are never dual-executed."""

    model_config = ConfigDict(frozen=True)

    default_mode: ExecutionMode = ExecutionMode.LEGACY
    native_allowlist: frozenset[str] = Field(default_factory=frozenset)
    dry_run_allowlist: frozenset[str] = Field(default_factory=frozenset)

    def mode_for(self, agent: str, requested: Optional[ExecutionMode]) -> ExecutionMode:
        mode = requested or self.default_mode
        if mode == ExecutionMode.NATIVE and agent not in self.native_allowlist:
            return ExecutionMode.LEGACY
        if mode == ExecutionMode.DRY_RUN and agent not in self.dry_run_allowlist:
            return ExecutionMode.LEGACY
        return mode


class Orchestrator:
    def __init__(
        self,
        registry: AgentRegistry,
        *,
        hooks: Optional[HookChain] = None,
        trace_sink: Optional[TraceSink] = None,
        skill_registry: Optional[SkillRegistry] = None,
        memory_manager: Optional[MemoryManager] = None,
    ) -> None:
        self.registry = registry
        self.hooks = hooks or HookChain()
        self.trace_sink = trace_sink or NullTraceSink()
        self.skill_registry = skill_registry or DEFAULT_SKILL_REGISTRY
        if memory_manager is None:
            from app.memory.factory import configured_memory_manager

            memory_manager = configured_memory_manager()
        self.memory_manager = memory_manager

    async def run(
        self,
        agent_name: str,
        envelope: ExecutionEnvelope,
        *,
        input: Optional[Dict[str, Any]] = None,
        messages: Optional[list[Dict[str, Any]]] = None,
        memory: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> RunResult:
        if envelope.deadline <= datetime.now(timezone.utc):
            raise DeadlineExceededError("Execution envelope deadline has passed")
        registered = self.registry.get(agent_name)
        if envelope.mode == ExecutionMode.DRY_RUN and registered.spec.mutation_capable:
            raise PolicyViolationError("Mutation-capable agents cannot run in dry-run mode")
        conversation_id = envelope.conversation_id or ""
        manager = self.memory_manager
        if manager and manager.enabled and not conversation_id:
            if manager.failure_mode == "closed":
                raise ContractError("conversationId is required for Redis STM")
            manager = None
        if manager and manager.enabled:
            async with manager.conversation_lock(
                envelope.organization_id, envelope.actor_id, conversation_id
            ):
                return await self._run_once(
                    agent_name,
                    registered,
                    envelope,
                    input=input,
                    messages=messages,
                    memory=memory,
                    metadata=metadata,
                    manager=manager,
                    conversation_id=conversation_id,
                )
        return await self._run_once(
            agent_name,
            registered,
            envelope,
            input=input,
            messages=messages,
            memory=memory,
            metadata=metadata,
            manager=None,
            conversation_id=conversation_id,
        )

    async def _run_once(
        self,
        agent_name: str,
        registered: Any,
        envelope: ExecutionEnvelope,
        *,
        input: Optional[Dict[str, Any]],
        messages: Optional[list[Dict[str, Any]]],
        memory: Optional[Dict[str, Any]],
        metadata: Optional[Dict[str, Any]],
        manager: Optional[MemoryManager],
        conversation_id: str,
    ) -> RunResult:
        run_input = input or {}
        run_metadata = dict(metadata or {})
        requested_skills = run_input.get("selectedSkills") or run_metadata.get("selectedSkills") or []
        if not isinstance(requested_skills, list):
            raise ContractError("selectedSkills must be a list")
        selected = self.skill_registry.select(
            requested_skills,
            agent=registered.spec,
            role=envelope.role,
            business_type=envelope.business_type,
        )
        if selected:
            run_metadata["selectedSkillPackages"] = selected
        memory_record: dict[str, Any] | None = None
        run_memory = dict(memory or {})
        if manager:
            memory_record = await manager.load(
                envelope.organization_id,
                envelope.actor_id,
                conversation_id,
                compatibility_memory=run_memory,
            )
            run_memory = dict(memory_record.get("working") or {})
            run_metadata["stmVersion"] = memory_record.get("version", 0)
        context = AgentContext(
            envelope=envelope,
            input=run_input,
            messages=messages or [],
            memory=run_memory,
            metadata=run_metadata,
        )
        context = await self.hooks.before_run(registered.spec, context)
        remaining = envelope.remaining_seconds()
        with trace_span(
            self.trace_sink,
            "orchestrator.run",
            run_id=envelope.run_id,
            trace_id=envelope.trace_id,
            agent=agent_name,
        ):
            try:
                result = await asyncio.wait_for(
                    registered.runner(context), timeout=remaining
                )
            except asyncio.CancelledError:
                await self.hooks.on_cancel(registered.spec, context)
                raise
        if result.run_id != envelope.run_id or result.trace_id != envelope.trace_id:
            raise ContractError("Agent result correlation IDs do not match envelope")
        if not result.assistant_text and result.ok and registered.spec.execution == "turn":
            raise ContractError("Successful conversational runs require LLM assistantText")
        result = result.model_copy(update={"agent": agent_name})
        result = await self.hooks.after_run(registered.spec, context, result)
        await self.hooks.checkpoint(
            registered.spec,
            context,
            {"status": "complete", "runId": envelope.run_id},
        )
        if manager and memory_record is not None:
            patch = result.session_memory_patch or {}
            if patch:
                memory_record = await manager.apply_patch(
                    envelope.organization_id,
                    envelope.actor_id,
                    conversation_id,
                    current=memory_record,
                    patch=patch,
                    source=agent_name,
                    run_id=envelope.run_id,
                )
            result = result.model_copy(
                update={"session_memory": dict(memory_record.get("working") or {})}
            )
        return result
