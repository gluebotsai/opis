"""Native adapters for the stable ``/ai/v1/agents/:name/run`` surface.

The HTTP routes intentionally keep their existing Pydantic models and call
signatures. Rollout selection happens here, before exactly one implementation
is invoked. The legacy functions remain available for immediate rollback.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import time
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Mapping, Sequence

from app.config import get_settings
from app.orchestrator.contracts import (
    AgentContext,
    AgentKind,
    AgentSpec,
    ExecutionEnvelope,
    ExecutionMode,
)
from app.orchestrator.pipeline import PipelineRunner, PipelineStep, RetryPolicy

AgentFn = Callable[..., Awaitable[dict[str, Any]]]

MEETING_AGENTS = frozenset(
    {
        "analyze-transcript",
        "assist-internal-meeting",
        "assist-meeting",
        "meeting-brief-email",
        "meeting-mom",
        "meeting-miss-escalation",
        "post-meeting-process",
        "sales-coach",
    }
)
COWORKER_AGENTS = frozenset({"chat", "crm-agent"})
MUTATION_AGENTS = frozenset(
    {
        "assign-sales",
        "audit-forecast",
        "auto-reply-email",
        "crm-agent",
        "enrich-lead",
        "expansion-matcher",
        "invoice-escalation",
        "lifecycle-lead",
        "meeting-brief-email",
        "meeting-miss-escalation",
        "nurture-lead",
        "post-meeting-process",
        "score-lead",
        "summarize-lead",
    }
)
CONDITIONAL_PIPELINE_AGENTS = frozenset(
    {
        "auto-reply-email",
        "enrich-lead",
        "lifecycle-lead",
        "nurture-lead",
        "post-meeting-process",
    }
)
TURN_AGENTS = frozenset(
    {
        "assist-internal-meeting",
        "assist-meeting",
        "chat",
        "compose-email",
        "crm-agent",
        "document-template",
        "hello",
        "proposal-content",
    }
)


@dataclass(frozen=True)
class NativeNamedAdapter:
    spec: AgentSpec
    legacy_runner: AgentFn
    pipeline_shape: Sequence[str]


@dataclass
class NativeRunRecord:
    run_id: str
    idempotency_key: str
    status: str
    result: dict[str, Any] | None = None
    attempts: int = 0
    checkpoint: str | None = None
    error: str | None = None
    completed_at: float | None = None


class NativeRunStore:
    """Process-local atomic run identity adapter.

    Durable job tables remain owned by the existing agents/backend. This store
    only prevents duplicate execution inside an ai-service process and exposes
    lifecycle states for a future durable adapter without changing schemas.
    """

    def __init__(self, max_completed: int = 1024, replay_ttl_seconds: float = 300) -> None:
        self.max_completed = max_completed
        self.replay_ttl_seconds = replay_ttl_seconds
        self._records: OrderedDict[str, NativeRunRecord] = OrderedDict()
        self._locks: dict[str, asyncio.Lock] = {}
        self._guard = asyncio.Lock()

    async def lock_for(self, key: str) -> asyncio.Lock:
        async with self._guard:
            return self._locks.setdefault(key, asyncio.Lock())

    def get(self, key: str) -> NativeRunRecord | None:
        record = self._records.get(key)
        if (
            record
            and record.status == "completed"
            and record.completed_at is not None
            and time.monotonic() - record.completed_at > self.replay_ttl_seconds
        ):
            self._records.pop(key, None)
            return None
        return record

    def start(self, run_id: str, key: str) -> NativeRunRecord:
        record = NativeRunRecord(run_id=run_id, idempotency_key=key, status="leased")
        self._records[key] = record
        return record

    def complete(self, record: NativeRunRecord, result: dict[str, Any]) -> None:
        record.status = "completed"
        record.result = dict(result)
        record.completed_at = time.monotonic()
        self._records.move_to_end(record.idempotency_key)
        while len(self._records) > self.max_completed:
            old_key, old = self._records.popitem(last=False)
            if old.status != "completed":
                self._records[old_key] = old
                break
            self._locks.pop(old_key, None)

    def fail(self, record: NativeRunRecord, exc: Exception, *, retryable: bool) -> None:
        record.status = "abandoned" if retryable else "dead_letter"
        record.error = str(exc)


def _csv(value: str) -> frozenset[str]:
    return frozenset(item.strip() for item in value.split(",") if item.strip())


def native_enabled_for(name: str) -> bool:
    settings = get_settings()
    if not settings.named_agents_native_enabled:
        return False
    if name in _csv(settings.named_agents_legacy_allowlist):
        return False
    allowlist = _csv(settings.named_agents_native_allowlist)
    return not allowlist or name in allowlist


def _json_default(value: Any) -> str:
    return value.isoformat() if hasattr(value, "isoformat") else repr(value)


def _identity(name: str, args: tuple[Any, ...], kwargs: Mapping[str, Any]) -> tuple[str, str]:
    payload = json.dumps(
        {"agent": name, "args": args, "kwargs": kwargs},
        default=_json_default,
        sort_keys=True,
        separators=(",", ":"),
    )
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return f"named:{name}:{digest[:24]}", f"{name}:{digest}"


def _organization_id(
    runner: AgentFn,
    args: tuple[Any, ...],
    kwargs: Mapping[str, Any],
) -> str:
    for key in ("organization_id", "organizationId"):
        value = kwargs.get(key)
        if value:
            return str(value)
    try:
        bound = inspect.signature(runner).bind_partial(*args, **kwargs)
        for key in ("organization_id", "organizationId"):
            value = bound.arguments.get(key)
            if value:
                return str(value)
    except (TypeError, ValueError):
        pass
    # Some compatibility functions accept only **kwargs and have no explicit
    # organization field. Their existing persistence layer still enforces
    # tenancy; this placeholder is never used for database access.
    return "legacy-route"


def _deadline_seconds(name: str) -> int:
    settings = get_settings()
    base = max(1, int(settings.named_agents_native_deadline_seconds or 120))
    if str(name).startswith("proposal-"):
        return max(
            base,
            int(getattr(settings, "named_agents_proposal_deadline_seconds", 0) or 240),
        )
    return base


def _is_timeout(exc: BaseException | None) -> bool:
    cause: BaseException | None = exc
    while cause is not None:
        if isinstance(cause, (TimeoutError, asyncio.TimeoutError, asyncio.CancelledError)):
            return True
        cause = cause.__cause__
    return False


def _timeout_payload(name: str) -> dict[str, Any]:
    return {
        "ok": True,
        "status": "failed",
        "source": "heuristic",
        "reason": "llm_timeout",
        "section": {},
        "sections": [],
        "error": f"{name} timed out",
    }


def _spec(name: str) -> AgentSpec:
    if name in MEETING_AGENTS:
        kind = AgentKind.MEETING
    elif name in COWORKER_AGENTS:
        kind = AgentKind.COWORKER
    else:
        kind = AgentKind.PROACTIVE
    return AgentSpec(
        name=name,
        version="1.0",
        kind=kind,
        execution="turn" if name in TURN_AGENTS else "pipeline",
        description=f"Native compatibility adapter for {name}",
        promptBuilder="existing-agent-run",
        mutationCapable=name in MUTATION_AGENTS,
    )


class NativeNamedRegistry:
    def __init__(self, legacy: Mapping[str, AgentFn], *, run_store: NativeRunStore | None = None):
        self._adapters = {
            name: NativeNamedAdapter(
                spec=_spec(name),
                legacy_runner=runner,
                pipeline_shape=(
                    ("load", "decide", "branch", "persist")
                    if name in CONDITIONAL_PIPELINE_AGENTS
                    else ("invoke",)
                ),
            )
            for name, runner in legacy.items()
        }
        self.run_store = run_store or NativeRunStore()

    def get(self, name: str) -> NativeNamedAdapter:
        try:
            return self._adapters[name]
        except KeyError as exc:
            raise KeyError(f"Unknown native named agent: {name}") from exc

    def specs(self) -> tuple[AgentSpec, ...]:
        return tuple(adapter.spec for adapter in self._adapters.values())

    async def run(self, name: str, *args: Any, **kwargs: Any) -> dict[str, Any]:
        adapter = self.get(name)
        run_id, idempotency_key = _identity(name, args, kwargs)
        lock = await self.run_store.lock_for(idempotency_key)
        async with lock:
            existing = self.run_store.get(idempotency_key)
            if existing and existing.status == "completed" and existing.result is not None:
                return dict(existing.result)
            record = self.run_store.start(run_id, idempotency_key)
            deadline = datetime.now(timezone.utc) + timedelta(
                seconds=_deadline_seconds(name)
            )
            context = AgentContext(
                envelope=ExecutionEnvelope(
                    runId=run_id,
                    traceId=run_id,
                    organizationId=_organization_id(
                        adapter.legacy_runner,
                        args,
                        kwargs,
                    ),
                    actorId="named-agent-route",
                    role="system",
                    businessType="unknown",
                    mode=ExecutionMode.NATIVE,
                    deadline=deadline,
                    idempotencyKey=idempotency_key,
                ),
                input={"args": list(args), "kwargs": dict(kwargs)},
                metadata={
                    "pipelineShape": list(adapter.pipeline_shape),
                    "persistenceOwner": "legacy-agent",
                },
            )

            async def invoke(state: dict[str, Any], _context: AgentContext) -> dict[str, Any]:
                record.attempts += 1
                result = await adapter.legacy_runner(*args, **kwargs)
                return {**state, "response": result}

            retryable = lambda exc: isinstance(exc, ConnectionError) or (
                isinstance(exc, TimeoutError)
                and context.envelope.remaining_seconds() > 1
            )
            runner = PipelineRunner(
                [
                    PipelineStep(
                        "invoke",
                        invoke,
                        retry=RetryPolicy(
                            # Mutation retries remain with the existing durable
                            # job owner; the adapter must never duplicate them.
                            max_attempts=(
                                1
                                if adapter.spec.mutation_capable
                                or str(name).startswith("proposal-")
                                else 2
                            ),
                            retryable=retryable,
                        ),
                    )
                ]
            )
            try:
                pipeline_result = await runner.run(context=context)
                response = pipeline_result.state["response"]
                self.run_store.complete(record, response)
                return dict(response)
            except Exception as exc:
                cause: BaseException | None = exc
                classified_retryable = False
                while cause is not None:
                    if isinstance(cause, Exception) and retryable(cause):
                        classified_retryable = True
                        break
                    cause = cause.__cause__
                self.run_store.fail(
                    record,
                    exc,
                    retryable=classified_retryable,
                )
                if str(name).startswith("proposal-") and _is_timeout(exc):
                    return _timeout_payload(name)
                # Preserve the legacy route's exception detail contract rather
                # than exposing the PipelineRunner's wrapper message.
                if isinstance(exc.__cause__, Exception):
                    raise exc.__cause__
                raise


def build_native_named_registry(legacy: Mapping[str, AgentFn]) -> NativeNamedRegistry:
    return NativeNamedRegistry(legacy)
