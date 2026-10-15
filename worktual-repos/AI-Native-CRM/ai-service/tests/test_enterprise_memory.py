from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.memory import FakeMemoryStore, MemoryConflictError, MemoryManager, redact_memory
from app.orchestrator import (
    AgentKind,
    AgentRegistry,
    AgentSpec,
    ExecutionEnvelope,
    Orchestrator,
    RegisteredAgent,
    RunResult,
)


def manager(**overrides) -> MemoryManager:
    return MemoryManager(
        FakeMemoryStore(),
        enabled=True,
        ttl_seconds=300,
        lock_wait_seconds=0.05,
        **overrides,
    )


@pytest.mark.asyncio
async def test_store_failure_mode_is_explicit():
    class BrokenStore(FakeMemoryStore):
        async def get(self, key):
            raise ConnectionError(key)

    graceful = MemoryManager(BrokenStore(), enabled=True, failure_mode="graceful")
    loaded = await graceful.load(
        "org", "user", "conversation", compatibility_memory={"client": "fallback"}
    )
    assert loaded["working"] == {"client": "fallback"}

    closed = MemoryManager(BrokenStore(), enabled=True, failure_mode="closed")
    with pytest.raises(ConnectionError):
        await closed.load("org", "user", "conversation")


@pytest.mark.asyncio
async def test_keys_isolate_org_user_and_conversation_and_cas():
    value = manager()
    first = await value.load("org-a", "user-a", "conversation-a")
    saved = await value.save(
        "org-a", "user-a", "conversation-a",
        expected_version=first["version"], working={"intent": "quote"},
    )
    assert saved["version"] == 1
    assert (await value.load("org-a", "user-a", "conversation-a"))["working"] == {
        "intent": "quote"
    }
    assert (await value.load("org-b", "user-a", "conversation-a"))["working"] == {}
    assert (await value.load("org-a", "user-b", "conversation-a"))["working"] == {}
    assert (await value.load("org-a", "user-a", "conversation-b"))["working"] == {}
    with pytest.raises(MemoryConflictError):
        await value.save(
            "org-a", "user-a", "conversation-a",
            expected_version=0, working={"intent": "stale"},
        )


@pytest.mark.asyncio
async def test_conversation_lock_is_distributed_and_released():
    value = manager()
    entered = asyncio.Event()

    async def holder():
        async with value.conversation_lock("org", "user", "conversation"):
            entered.set()
            await asyncio.sleep(0.1)

    task = asyncio.create_task(holder())
    await entered.wait()
    with pytest.raises(MemoryConflictError):
        async with value.conversation_lock("org", "user", "conversation"):
            pass
    await task
    async with value.conversation_lock("org", "user", "conversation"):
        pass


@pytest.mark.asyncio
async def test_redaction_limits_provenance_and_forget():
    value = manager(max_bytes=1200, max_summary_chars=100)
    saved = await value.save(
        "org", "user", "conversation",
        expected_version=0,
        working={
            "accessToken": "raw-secret",
            "note": "Bearer abcdefghijklmnopqrstuvwxyz",
            **{f"large-{index}": "x" * 500 for index in range(10)},
        },
        summary="summary " * 100,
        provenance=[{"source": f"run-{index}"} for index in range(30)],
    )
    serialized = json.dumps(saved)
    assert "raw-secret" not in serialized
    assert "abcdefghijklmnopqrstuvwxyz" not in serialized
    assert len(serialized.encode()) <= 1200
    assert len(saved["provenance"]) <= 20
    assert await value.forget("org", "user", "conversation") is True
    assert (await value.load("org", "user", "conversation"))["version"] == 0
    assert redact_memory({"password": "visible"})["password"] == "[REDACTED]"


@pytest.mark.asyncio
async def test_orchestrator_redis_authority_preserves_compatibility_patch():
    memory_manager = manager()
    spec = AgentSpec(
        name="memory-agent",
        version="1.0",
        kind=AgentKind.COWORKER,
        execution="turn",
    )

    async def runner(context):
        assert context.memory.get("clientSeed") == "kept"
        return RunResult(
            runId=context.envelope.run_id,
            traceId=context.envelope.trace_id,
            assistantText="LLM result",
            sessionMemoryPatch={"activeAgent": "quotes"},
        )

    runtime = Orchestrator(
        AgentRegistry([RegisteredAgent(spec, runner)]),
        memory_manager=memory_manager,
    )
    envelope = ExecutionEnvelope(
        runId="run-memory",
        traceId="trace-memory",
        organizationId="org",
        actorId="user",
        role="sales_rep",
        businessType="b2b",
        conversationId="conversation",
        deadline=datetime.now(timezone.utc) + timedelta(minutes=1),
        idempotencyKey="idem",
    )
    result = await runtime.run(
        "memory-agent", envelope, memory={"clientSeed": "kept"}
    )
    payload = result.compatibility_dict()
    assert payload["sessionMemoryPatch"] == {"activeAgent": "quotes"}
    assert payload["sessionMemory"] == {
        "clientSeed": "kept",
        "activeAgent": "quotes",
    }
    stored = await memory_manager.load("org", "user", "conversation")
    assert stored["version"] == 1
    assert stored["provenance"][-1]["source"] == "memory-agent"

