"""Formal lifecycle hook interfaces and composition."""

from __future__ import annotations

from typing import Any, Dict, Iterable, Protocol, Sequence

from app.orchestrator.contracts import AgentContext, AgentSpec, RunResult


class LifecycleHook(Protocol):
    async def before_run(self, spec: AgentSpec, context: AgentContext) -> AgentContext:
        ...

    async def before_prompt(
        self, spec: AgentSpec, context: AgentContext, messages: Sequence[Dict[str, Any]]
    ) -> Sequence[Dict[str, Any]]:
        ...

    async def authorize_tool(
        self,
        spec: AgentSpec,
        context: AgentContext,
        tool_name: str,
        arguments: Dict[str, Any],
        *,
        mutation: bool,
    ) -> None:
        ...

    async def after_tool(
        self,
        spec: AgentSpec,
        context: AgentContext,
        tool_name: str,
        result: Dict[str, Any],
    ) -> Dict[str, Any]:
        ...

    async def after_run(
        self, spec: AgentSpec, context: AgentContext, result: RunResult
    ) -> RunResult:
        ...

    async def checkpoint(
        self, spec: AgentSpec, context: AgentContext, state: Dict[str, Any]
    ) -> None:
        ...

    async def on_cancel(self, spec: AgentSpec, context: AgentContext) -> None:
        ...

    async def shutdown(self) -> None:
        ...


class NoopLifecycleHook:
    async def before_run(self, spec: AgentSpec, context: AgentContext) -> AgentContext:
        del spec
        return context

    async def before_prompt(
        self, spec: AgentSpec, context: AgentContext, messages: Sequence[Dict[str, Any]]
    ) -> Sequence[Dict[str, Any]]:
        del spec, context
        return messages

    async def authorize_tool(
        self,
        spec: AgentSpec,
        context: AgentContext,
        tool_name: str,
        arguments: Dict[str, Any],
        *,
        mutation: bool,
    ) -> None:
        del spec, context, tool_name, arguments, mutation

    async def after_tool(
        self,
        spec: AgentSpec,
        context: AgentContext,
        tool_name: str,
        result: Dict[str, Any],
    ) -> Dict[str, Any]:
        del spec, context, tool_name
        return result

    async def after_run(
        self, spec: AgentSpec, context: AgentContext, result: RunResult
    ) -> RunResult:
        del spec, context
        return result

    async def checkpoint(
        self, spec: AgentSpec, context: AgentContext, state: Dict[str, Any]
    ) -> None:
        del spec, context, state

    async def on_cancel(self, spec: AgentSpec, context: AgentContext) -> None:
        del spec, context

    async def shutdown(self) -> None:
        return None


class HookChain(NoopLifecycleHook):
    def __init__(self, hooks: Iterable[LifecycleHook] = ()) -> None:
        self.hooks = tuple(hooks)

    async def before_run(self, spec: AgentSpec, context: AgentContext) -> AgentContext:
        current = context
        for hook in self.hooks:
            current = await hook.before_run(spec, current)
        return current

    async def before_prompt(
        self, spec: AgentSpec, context: AgentContext, messages: Sequence[Dict[str, Any]]
    ) -> Sequence[Dict[str, Any]]:
        current = messages
        for hook in self.hooks:
            current = await hook.before_prompt(spec, context, current)
        return current

    async def authorize_tool(
        self,
        spec: AgentSpec,
        context: AgentContext,
        tool_name: str,
        arguments: Dict[str, Any],
        *,
        mutation: bool,
    ) -> None:
        for hook in self.hooks:
            await hook.authorize_tool(
                spec, context, tool_name, arguments, mutation=mutation
            )

    async def after_tool(
        self,
        spec: AgentSpec,
        context: AgentContext,
        tool_name: str,
        result: Dict[str, Any],
    ) -> Dict[str, Any]:
        current = result
        for hook in self.hooks:
            current = await hook.after_tool(spec, context, tool_name, current)
        return current

    async def after_run(
        self, spec: AgentSpec, context: AgentContext, result: RunResult
    ) -> RunResult:
        current = result
        for hook in reversed(self.hooks):
            current = await hook.after_run(spec, context, current)
        return current

    async def checkpoint(
        self, spec: AgentSpec, context: AgentContext, state: Dict[str, Any]
    ) -> None:
        for hook in self.hooks:
            method = getattr(hook, "checkpoint", None)
            if method:
                await method(spec, context, state)

    async def on_cancel(self, spec: AgentSpec, context: AgentContext) -> None:
        for hook in reversed(self.hooks):
            method = getattr(hook, "on_cancel", None)
            if method:
                await method(spec, context)

    async def shutdown(self) -> None:
        for hook in reversed(self.hooks):
            method = getattr(hook, "shutdown", None)
            if method:
                await method()
