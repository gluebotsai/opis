"""Deterministic safety policy hooks; LLMs never decide authorization."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, Iterable, Mapping, Protocol, Sequence, Set

from app.orchestrator.contracts import AgentContext, AgentSpec, RunResult
from app.orchestrator.errors import PolicyViolationError, ToolAuthorizationError
from app.orchestrator.hooks import NoopLifecycleHook

_SECRET_RE = re.compile(
    r"(?i)(authorization|api[-_ ]?key|password|secret)\s*[:=]\s*([^\s,;]+)"
)


class TenancyPolicy(NoopLifecycleHook):
    async def before_run(self, spec: AgentSpec, context: AgentContext) -> AgentContext:
        del spec
        payload_org = context.input.get("organizationId") or context.input.get(
            "organization_id"
        )
        if payload_org and str(payload_org) != context.envelope.organization_id:
            raise PolicyViolationError("Payload organization does not match envelope")
        return context


class RoleToolPolicy(NoopLifecycleHook):
    def __init__(
        self,
        allowed_by_role: Mapping[str, Iterable[str]],
        *,
        mutation_tools: Iterable[str] = (),
    ) -> None:
        self.allowed_by_role = {
            role: frozenset(tools) for role, tools in allowed_by_role.items()
        }
        self.mutation_tools: Set[str] = set(mutation_tools)

    async def authorize_tool(
        self,
        spec: AgentSpec,
        context: AgentContext,
        tool_name: str,
        arguments: Dict[str, Any],
        *,
        mutation: bool,
    ) -> None:
        del arguments
        role_allowed = self.allowed_by_role.get(context.envelope.role, frozenset())
        if tool_name not in role_allowed or (
            spec.allowed_tools and tool_name not in spec.allowed_tools
        ):
            raise ToolAuthorizationError(f"Tool not allowed: {tool_name}")
        if mutation and tool_name not in self.mutation_tools:
            raise ToolAuthorizationError(
                f"Tool is not registered as an authorized mutation: {tool_name}"
            )


class ConfirmationPolicy(NoopLifecycleHook):
    def __init__(self, confirmation_tools: Iterable[str]) -> None:
        self.confirmation_tools = frozenset(confirmation_tools)

    async def authorize_tool(
        self,
        spec: AgentSpec,
        context: AgentContext,
        tool_name: str,
        arguments: Dict[str, Any],
        *,
        mutation: bool,
    ) -> None:
        del spec, mutation
        if tool_name in self.confirmation_tools and arguments.get("confirmed") is not True:
            raise PolicyViolationError(f"Confirmation required for {tool_name}")
        if tool_name in self.confirmation_tools and not context.envelope.idempotency_key:
            raise PolicyViolationError("Confirmed mutation requires idempotency key")


class IdempotencyStore(Protocol):
    async def claim(self, scope: str, key: str) -> bool:
        """Atomically claim a key, returning false when it already exists."""
        ...


class IdempotencyPolicy(NoopLifecycleHook):
    """Reject duplicate mutation receipts scoped to tenant, actor and tool."""

    def __init__(self, store: IdempotencyStore) -> None:
        self.store = store

    async def authorize_tool(
        self,
        spec: AgentSpec,
        context: AgentContext,
        tool_name: str,
        arguments: Dict[str, Any],
        *,
        mutation: bool,
    ) -> None:
        del spec
        if not mutation:
            return
        digest = hashlib.sha256(
            json.dumps(arguments, sort_keys=True, default=str).encode()
        ).hexdigest()
        envelope = context.envelope
        scope = f"{envelope.organization_id}:{envelope.actor_id}:{tool_name}"
        key = f"{envelope.idempotency_key}:{digest}"
        if not await self.store.claim(scope, key):
            raise PolicyViolationError(f"Duplicate mutation blocked: {tool_name}")


class AuditSink(Protocol):
    async def record(self, event: Dict[str, Any]) -> None:
        ...


class AuditPolicy(NoopLifecycleHook):
    """Emit metadata-only run/tool audit records without prompt or result bodies."""

    def __init__(self, sink: AuditSink) -> None:
        self.sink = sink

    async def before_run(self, spec: AgentSpec, context: AgentContext) -> AgentContext:
        envelope = context.envelope
        await self.sink.record(
            {
                "event": "agent_run_started",
                "runId": envelope.run_id,
                "traceId": envelope.trace_id,
                "organizationId": envelope.organization_id,
                "actorId": envelope.actor_id,
                "agent": spec.name,
                "agentVersion": spec.version,
            }
        )
        return context

    async def after_tool(
        self,
        spec: AgentSpec,
        context: AgentContext,
        tool_name: str,
        result: Dict[str, Any],
    ) -> Dict[str, Any]:
        await self.sink.record(
            {
                "event": "agent_tool_completed",
                "runId": context.envelope.run_id,
                "traceId": context.envelope.trace_id,
                "organizationId": context.envelope.organization_id,
                "agent": spec.name,
                "tool": tool_name,
                "ok": bool(result.get("ok", True)),
            }
        )
        return result

    async def after_run(
        self, spec: AgentSpec, context: AgentContext, result: RunResult
    ) -> RunResult:
        await self.sink.record(
            {
                "event": "agent_run_completed",
                "runId": context.envelope.run_id,
                "traceId": context.envelope.trace_id,
                "organizationId": context.envelope.organization_id,
                "agent": spec.name,
                "ok": result.ok,
                "source": result.source,
            }
        )
        return result


class PromptRedactionPolicy(NoopLifecycleHook):
    async def before_prompt(
        self,
        spec: AgentSpec,
        context: AgentContext,
        messages: Sequence[Dict[str, Any]],
    ) -> Sequence[Dict[str, Any]]:
        del spec, context
        cleaned = []
        for message in messages:
            item = dict(message)
            content = item.get("content")
            if isinstance(content, str):
                item["content"] = _SECRET_RE.sub(r"\1: [REDACTED]", content)
            cleaned.append(item)
        return cleaned


class OutputSanitationPolicy(NoopLifecycleHook):
    async def after_run(
        self, spec: AgentSpec, context: AgentContext, result: RunResult
    ) -> RunResult:
        del spec, context
        cleaned = _SECRET_RE.sub(r"\1: [REDACTED]", result.assistant_text)
        return result.model_copy(update={"assistant_text": cleaned})
