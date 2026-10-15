"""Native linear/conditional pipeline runner with retry and checkpoint hooks."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Mapping, Optional, Protocol, Sequence

from app.orchestrator.contracts import AgentContext
from app.orchestrator.errors import DeadlineExceededError, PipelineError
from app.orchestrator.tracing import NullTraceSink, TraceSink, trace_span

PipelineState = Dict[str, Any]
StepHandler = Callable[[PipelineState, AgentContext], Awaitable[PipelineState]]
BranchSelector = Callable[[PipelineState], Optional[str]]


class CheckpointStore(Protocol):
    async def load(self, run_id: str) -> Optional[Dict[str, Any]]:
        ...

    async def save(
        self, run_id: str, step_name: str, state: PipelineState
    ) -> None:
        ...


class PipelineHook(Protocol):
    async def before_step(
        self, step: "PipelineStep", state: PipelineState, context: AgentContext
    ) -> None:
        ...

    async def after_step(
        self, step: "PipelineStep", state: PipelineState, context: AgentContext
    ) -> None:
        ...

    async def on_retry(
        self,
        step: "PipelineStep",
        attempt: int,
        error: Exception,
        context: AgentContext,
    ) -> None:
        ...


class LeaseHook(Protocol):
    async def acquire(self, run_id: str, step_name: str) -> None:
        ...

    async def heartbeat(self, run_id: str, step_name: str) -> None:
        ...

    async def release(self, run_id: str, step_name: str) -> None:
        ...


class NoopPipelineHook:
    async def before_step(
        self, step: "PipelineStep", state: PipelineState, context: AgentContext
    ) -> None:
        del step, state, context

    async def after_step(
        self, step: "PipelineStep", state: PipelineState, context: AgentContext
    ) -> None:
        del step, state, context

    async def on_retry(
        self,
        step: "PipelineStep",
        attempt: int,
        error: Exception,
        context: AgentContext,
    ) -> None:
        del step, attempt, error, context


class NoopLeaseHook:
    async def acquire(self, run_id: str, step_name: str) -> None:
        del run_id, step_name

    async def heartbeat(self, run_id: str, step_name: str) -> None:
        del run_id, step_name

    async def release(self, run_id: str, step_name: str) -> None:
        del run_id, step_name


@dataclass(frozen=True)
class RetryPolicy:
    max_attempts: int = 1
    delay_seconds: float = 0.0
    retryable: Callable[[Exception], bool] = lambda _exc: True


@dataclass(frozen=True)
class PipelineStep:
    name: str
    handler: StepHandler
    next_step: Optional[str] = None
    branch: Optional[BranchSelector] = None
    retry: RetryPolicy = field(default_factory=RetryPolicy)
    compensation: Optional[str] = None
    checkpoint: bool = True


@dataclass(frozen=True)
class PipelineResult:
    state: PipelineState
    completed_steps: Sequence[str]
    compensation_metadata: Mapping[str, str]


class InMemoryCheckpointStore:
    def __init__(self) -> None:
        self.items: Dict[str, Dict[str, Any]] = {}

    async def load(self, run_id: str) -> Optional[Dict[str, Any]]:
        item = self.items.get(run_id)
        return dict(item) if item else None

    async def save(
        self, run_id: str, step_name: str, state: PipelineState
    ) -> None:
        self.items[run_id] = {
            "nextStep": step_name,
            "state": dict(state),
        }


class PipelineRunner:
    def __init__(
        self,
        steps: Sequence[PipelineStep],
        *,
        checkpoint_store: Optional[CheckpointStore] = None,
        hooks: Sequence[PipelineHook] = (),
        lease_hook: Optional[LeaseHook] = None,
        trace_sink: Optional[TraceSink] = None,
        heartbeat_interval_seconds: float = 10.0,
    ) -> None:
        self.steps = {step.name: step for step in steps}
        if len(self.steps) != len(steps):
            raise ValueError("Pipeline step names must be unique")
        self.checkpoint_store = checkpoint_store
        self.hooks = tuple(hooks) or (NoopPipelineHook(),)
        self.lease_hook = lease_hook or NoopLeaseHook()
        self.trace_sink = trace_sink or NullTraceSink()
        self.heartbeat_interval_seconds = max(0.01, heartbeat_interval_seconds)

    async def run(
        self,
        *,
        context: AgentContext,
        initial_state: Optional[PipelineState] = None,
        start_at: Optional[str] = None,
        resume: bool = False,
    ) -> PipelineResult:
        state = dict(initial_state or {})
        current = start_at or (next(iter(self.steps)) if self.steps else None)
        if resume and self.checkpoint_store:
            saved = await self.checkpoint_store.load(context.envelope.run_id)
            if saved:
                state.update(saved.get("state") or {})
                current = str(saved.get("nextStep") or current or "") or None
        completed = []
        compensation: Dict[str, str] = {}
        visited = 0
        while current:
            visited += 1
            if visited > max(1, len(self.steps) * 4):
                raise PipelineError("Pipeline branch cycle detected")
            step = self.steps.get(current)
            if step is None:
                raise PipelineError(f"Unknown pipeline step: {current}")
            if context.envelope.remaining_seconds() <= 0:
                raise DeadlineExceededError("Pipeline deadline exceeded")
            await self.lease_hook.acquire(context.envelope.run_id, step.name)
            heartbeat_stop = asyncio.Event()
            heartbeat_task = asyncio.create_task(
                self._heartbeat_lease(
                    context.envelope.run_id,
                    step.name,
                    heartbeat_stop,
                )
            )
            try:
                with trace_span(
                    self.trace_sink,
                    "pipeline.step",
                    run_id=context.envelope.run_id,
                    step=step.name,
                ):
                    for hook in self.hooks:
                        await hook.before_step(step, state, context)
                    state = await self._run_step(step, state, context)
                    await self.lease_hook.heartbeat(
                        context.envelope.run_id, step.name
                    )
                    for hook in self.hooks:
                        await hook.after_step(step, state, context)
            finally:
                heartbeat_stop.set()
                await heartbeat_task
                await self.lease_hook.release(context.envelope.run_id, step.name)
            completed.append(step.name)
            if step.compensation:
                compensation[step.name] = step.compensation
            next_step = step.branch(state) if step.branch else step.next_step
            if step.checkpoint and self.checkpoint_store and next_step:
                await self.checkpoint_store.save(
                    context.envelope.run_id, next_step, state
                )
            current = next_step
        return PipelineResult(
            state=state,
            completed_steps=tuple(completed),
            compensation_metadata=compensation,
        )

    async def _run_step(
        self, step: PipelineStep, state: PipelineState, context: AgentContext
    ) -> PipelineState:
        attempts = max(1, step.retry.max_attempts)
        for attempt in range(1, attempts + 1):
            try:
                remaining = context.envelope.remaining_seconds()
                if remaining <= 0:
                    raise DeadlineExceededError("Pipeline deadline exceeded")
                return await asyncio.wait_for(
                    step.handler(dict(state), context), timeout=remaining
                )
            except Exception as exc:
                if attempt >= attempts or not step.retry.retryable(exc):
                    raise PipelineError(
                        f"Step {step.name} failed after {attempt} attempt(s)",
                        detail={"step": step.name, "attempts": attempt},
                    ) from exc
                for hook in self.hooks:
                    await hook.on_retry(step, attempt, exc, context)
                if step.retry.delay_seconds:
                    await asyncio.sleep(step.retry.delay_seconds)
        raise PipelineError(f"Step {step.name} did not complete")

    async def _heartbeat_lease(
        self,
        run_id: str,
        step_name: str,
        stop: asyncio.Event,
    ) -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(
                    stop.wait(),
                    timeout=self.heartbeat_interval_seconds,
                )
            except asyncio.TimeoutError:
                await self.lease_hook.heartbeat(run_id, step_name)
