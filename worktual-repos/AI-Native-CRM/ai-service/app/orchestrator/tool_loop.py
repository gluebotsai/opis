"""Bounded LLM-to-MCP loop with result feedback and mutation serialization."""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol, Sequence

from app.orchestrator.contracts import AgentContext, AgentSpec, ToolBudget
from app.orchestrator.errors import (
    BudgetExceededError,
    ContractError,
    DeadlineExceededError,
    ToolCycleError,
)
from app.orchestrator.hooks import HookChain
from app.skills.composer import compose_system_prompt, filter_mcp_tools
from app.skills.models import SkillPackage
from app.skills.registry import effective_tool_names

ChatFn = Callable[..., Awaitable[Optional[Dict[str, Any]]]]


class ToolClient(Protocol):
    async def list_tools(
        self, *, context: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        ...

    async def call_tool(
        self,
        name: str,
        arguments: Optional[Dict[str, Any]] = None,
        *,
        context: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        ...


@dataclass(frozen=True)
class ToolLoopResult:
    content: str
    messages: Sequence[Dict[str, Any]]
    rounds: int
    calls: int
    tool_results: Sequence[Dict[str, Any]]


def _openai_tools(tools: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    converted = []
    for tool in tools:
        name = str(tool.get("name") or "").strip()
        if not name:
            continue
        converted.append(
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": str(tool.get("description") or name)[:500],
                    "parameters": tool.get("inputSchema")
                    or {"type": "object", "properties": {}},
                },
            }
        )
    return converted


def _is_mutation(tool: Dict[str, Any]) -> bool:
    if isinstance(tool.get("mutation"), bool):
        return bool(tool["mutation"])
    annotations = tool.get("annotations")
    if isinstance(annotations, dict) and annotations.get("readOnlyHint") is True:
        return False
    return True


def _call_parts(call: Dict[str, Any], index: int) -> tuple[str, str, Dict[str, Any]]:
    fn = call.get("function") if isinstance(call.get("function"), dict) else {}
    name = str(fn.get("name") or call.get("name") or "").strip()
    call_id = str(call.get("id") or f"call_{index}")
    raw = fn.get("arguments") if fn else call.get("arguments")
    if isinstance(raw, dict):
        arguments = raw
    elif isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            arguments = parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            arguments = {}
    else:
        arguments = {}
    return call_id, name, arguments


class BoundedToolLoop:
    def __init__(
        self,
        *,
        llm: Optional[ChatFn] = None,
        hooks: Optional[HookChain] = None,
    ) -> None:
        if llm is None:
            from app.llm import chat_with_tools

            llm = chat_with_tools
        self.llm = llm
        self.hooks = hooks or HookChain()

    async def run(
        self,
        *,
        spec: AgentSpec,
        context: AgentContext,
        messages: Sequence[Dict[str, Any]],
        client: ToolClient,
        budget: Optional[ToolBudget] = None,
        max_tokens: int = 800,
        temperature: float = 0.2,
        tool_choice: Any = None,
        tool_choice_rounds: int = 0,
    ) -> ToolLoopResult:
        active_budget = budget or context.envelope.tool_budget
        tool_defs = await client.list_tools(context=self._tool_context(context))
        selected = context.metadata.get("selectedSkillPackages") or ()
        packages = tuple(
            package for package in selected if isinstance(package, SkillPackage)
        )
        tool_defs = filter_mcp_tools(
            tool_defs, effective_tool_names(spec, packages)
        )
        by_name = {
            str(tool.get("name")): tool for tool in tool_defs if tool.get("name")
        }
        openai_tools = _openai_tools(tool_defs)
        prepared_messages = list(messages)
        if packages:
            for index, message in enumerate(prepared_messages):
                if message.get("role") == "system":
                    prepared_messages[index] = {
                        **message,
                        "content": compose_system_prompt(
                            str(message.get("content") or ""),
                            packages,
                            context={**context.input, **context.memory, **context.metadata},
                        ),
                    }
                    break
        transcript = list(
            await self.hooks.before_prompt(spec, context, prepared_messages)
        )
        seen: Dict[str, int] = {}
        results: List[Dict[str, Any]] = []
        call_count = 0

        for round_no in range(1, active_budget.max_rounds + 1):
            remaining = context.envelope.remaining_seconds()
            if remaining <= 0:
                raise DeadlineExceededError("Run deadline exceeded before LLM call")
            try:
                llm_kwargs: Dict[str, Any] = {
                    "messages": transcript,
                    "tools": openai_tools,
                    "max_tokens": max_tokens,
                    "timeout_ms": max(1, int(remaining * 1000)),
                    "temperature": temperature,
                }
                if tool_choice is not None and (
                    tool_choice_rounds <= 0 or round_no <= tool_choice_rounds
                ):
                    llm_kwargs["tool_choice"] = tool_choice
                response = await asyncio.wait_for(
                    self.llm(**llm_kwargs),
                    timeout=remaining,
                )
            except asyncio.TimeoutError as exc:
                raise DeadlineExceededError("Run deadline exceeded during LLM call") from exc
            if not response:
                raise DeadlineExceededError("LLM returned no usable response")
            if not isinstance(response, dict):
                raise ContractError("LLM returned a malformed tool-loop response")
            content = str(response.get("content") or "")
            calls = response.get("tool_calls") or []
            if not isinstance(calls, list):
                raise ContractError("LLM returned malformed tool calls")
            if any(not isinstance(call, dict) for call in calls):
                raise ContractError("LLM returned malformed tool calls")
            from app.agent_log import console_coworker

            parsed_calls = [_call_parts(call, i) for i, call in enumerate(calls) if isinstance(call, dict)]
            console_coworker(
                "llm",
                agent=spec.name,
                round=round_no,
                tools=",".join(name for _, name, _ in parsed_calls if name) or None,
                text=content or "(no text)",
            )
            if not calls:
                return ToolLoopResult(
                    content=content,
                    messages=tuple(transcript),
                    rounds=round_no,
                    calls=call_count,
                    tool_results=tuple(results),
                )
            # Tool-calling rounds are not user-facing. Keep only the later
            # no-tool draft as the assistant reply.
            content = ""
            if call_count + len(calls) > active_budget.max_calls:
                raise BudgetExceededError("Tool call budget exhausted")

            normalized = [_call_parts(call, i) for i, call in enumerate(calls)]
            executable: List[tuple[str, str, Dict[str, Any]]] = []
            cycled_name = ""
            for parts in normalized:
                _, name, arguments = parts
                signature = hashlib.sha256(
                    json.dumps([name, arguments], sort_keys=True, default=str).encode()
                ).hexdigest()
                seen[signature] = seen.get(signature, 0) + 1
                if seen[signature] > active_budget.max_repeated_call:
                    cycled_name = name
                    continue
                executable.append(parts)
            if not executable:
                if results:
                    return ToolLoopResult(
                        content=content,
                        messages=tuple(transcript),
                        rounds=round_no,
                        calls=call_count,
                        tool_results=tuple(results),
                    )
                raise ToolCycleError(
                    f"Repeated tool call detected: {cycled_name or 'tool'}"
                )
            normalized = executable

            transcript.append(
                {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": call_id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": json.dumps(arguments, default=str),
                            },
                        }
                        for call_id, name, arguments in normalized
                    ],
                }
            )
            all_reads = all(
                name in by_name and not _is_mutation(by_name[name])
                for _, name, _ in normalized
            )
            if active_budget.parallel_reads and all_reads and len(normalized) > 1:
                batch = await asyncio.gather(
                    *[
                        self._execute(spec, context, client, by_name, *parts)
                        for parts in normalized
                    ]
                )
            else:
                batch = []
                for parts in normalized:
                    batch.append(
                        await self._execute(
                            spec, context, client, by_name, *parts
                        )
                    )
            call_count += len(batch)
            for call_id, name, result in batch:
                results.append({"toolCallId": call_id, "name": name, "result": result})
                transcript.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "name": name,
                        "content": json.dumps(result, default=str),
                    }
                )
            if cycled_name or round_no == active_budget.max_rounds:
                return ToolLoopResult(
                    content=content,
                    messages=tuple(transcript),
                    rounds=round_no,
                    calls=call_count,
                    tool_results=tuple(results),
                )

        raise BudgetExceededError("Tool loop round budget exhausted")

    async def _execute(
        self,
        spec: AgentSpec,
        context: AgentContext,
        client: ToolClient,
        tools: Dict[str, Dict[str, Any]],
        call_id: str,
        name: str,
        arguments: Dict[str, Any],
    ) -> tuple[str, str, Dict[str, Any]]:
        from app.agent_log import console_coworker

        console_coworker("tool_call", agent=spec.name, name=name, text=arguments)
        if name not in tools:
            result = {"ok": False, "error": "unknown_tool"}
            try:
                from app.observability.turn_log import record_tool, turn_active

                if turn_active():
                    record_tool(name, arguments, result, agent=spec.name)
            except Exception:  # noqa: BLE001
                pass
            console_coworker("tool_response", agent=spec.name, name=name, ok=False, text=result)
            return call_id, name, result
        mutation = _is_mutation(tools[name])
        await self.hooks.authorize_tool(
            spec, context, name, arguments, mutation=mutation
        )
        remaining = context.envelope.remaining_seconds()
        if remaining <= 0:
            raise DeadlineExceededError("Run deadline exceeded before tool call")
        raw = await asyncio.wait_for(
            client.call_tool(
                name, arguments, context=self._tool_context(context)
            ),
            timeout=remaining,
        )
        result = raw if isinstance(raw, dict) else {"ok": False, "error": "empty_tool_result"}
        result = await self.hooks.after_tool(spec, context, name, result)
        try:
            from app.observability.turn_log import record_tool, turn_active

            if turn_active():
                record_tool(name, arguments, result, agent=spec.name)
        except Exception:  # noqa: BLE001
            pass
        console_coworker(
            "tool_response",
            agent=spec.name,
            name=name,
            ok=result.get("ok") if isinstance(result, dict) else None,
            text=result,
        )
        return call_id, name, result

    @staticmethod
    def _tool_context(context: AgentContext) -> Dict[str, Any]:
        envelope = context.envelope
        page = context.input.get("context")
        page_ctx = page if isinstance(page, dict) else {}
        # Detail tools are hidden unless the call carries the open record.
        # List already sends entityId; the call must too or MCP returns 403.
        entity_id = str(page_ctx.get("entityId") or "").strip()
        payload: Dict[str, Any] = {
            "runId": envelope.run_id,
            "traceId": envelope.trace_id,
            "organizationId": envelope.organization_id,
            "actingUserId": envelope.actor_id,
            "role": envelope.role,
            "businessType": envelope.business_type,
            "deadline": envelope.deadline.isoformat(),
            "idempotencyKey": envelope.idempotency_key,
            **context.metadata,
        }
        if entity_id:
            payload["entityId"] = entity_id
        return payload
