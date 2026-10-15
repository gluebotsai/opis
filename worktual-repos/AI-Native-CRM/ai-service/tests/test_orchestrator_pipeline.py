from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from app.orchestrator.contracts import AgentContext, ExecutionEnvelope
from app.orchestrator.pipeline import (
    InMemoryCheckpointStore,
    PipelineRunner,
    PipelineStep,
    RetryPolicy,
)


def context(run_id="pipeline-1"):
    return AgentContext(
        envelope=ExecutionEnvelope(
            runId=run_id,
            traceId=f"trace-{run_id}",
            organizationId="org-1",
            actorId="worker-1",
            role="admin",
            businessType="b2b",
            deadline=datetime.now(timezone.utc) + timedelta(minutes=1),
            idempotencyKey=f"idem-{run_id}",
        )
    )


@pytest.mark.asyncio
async def test_pipeline_conditional_branch_and_checkpoint():
    checkpoints = InMemoryCheckpointStore()

    async def classify(state, _context):
        return {**state, "qualified": True}

    async def assign(state, _context):
        return {**state, "assigned": True}

    async def nurture(state, _context):
        return {**state, "nurtured": True}

    runner = PipelineRunner(
        [
            PipelineStep(
                "classify",
                classify,
                branch=lambda state: "assign" if state["qualified"] else "nurture",
            ),
            PipelineStep("assign", assign, compensation="unassign"),
            PipelineStep("nurture", nurture),
        ],
        checkpoint_store=checkpoints,
    )
    result = await runner.run(context=context())
    assert result.completed_steps == ("classify", "assign")
    assert result.state["assigned"] is True
    assert result.compensation_metadata == {"assign": "unassign"}
    saved = await checkpoints.load("pipeline-1")
    assert saved["nextStep"] == "assign"


@pytest.mark.asyncio
async def test_pipeline_retries_and_emits_retry_hook():
    attempts = 0
    retries = []

    class Hook:
        async def before_step(self, step, state, context):
            pass

        async def after_step(self, step, state, context):
            pass

        async def on_retry(self, step, attempt, error, context):
            retries.append((step.name, attempt, str(error)))

    async def flaky(state, _context):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise TimeoutError("temporary")
        return {**state, "done": True}

    runner = PipelineRunner(
        [
            PipelineStep(
                "flaky",
                flaky,
                retry=RetryPolicy(
                    max_attempts=2,
                    retryable=lambda exc: isinstance(exc, TimeoutError),
                ),
            )
        ],
        hooks=[Hook()],
    )
    result = await runner.run(context=context())
    assert result.state["done"] is True
    assert attempts == 2
    assert retries == [("flaky", 1, "temporary")]


@pytest.mark.asyncio
async def test_pipeline_resumes_from_checkpoint():
    store = InMemoryCheckpointStore()
    await store.save("resume-1", "second", {"first": True})

    async def first(state, _context):
        raise AssertionError("completed step must not rerun")

    async def second(state, _context):
        return {**state, "second": True}

    runner = PipelineRunner(
        [
            PipelineStep("first", first, next_step="second"),
            PipelineStep("second", second),
        ],
        checkpoint_store=store,
    )
    result = await runner.run(context=context("resume-1"), resume=True)
    assert result.completed_steps == ("second",)
    assert result.state == {"first": True, "second": True}


@pytest.mark.asyncio
async def test_pipeline_lease_hooks_wrap_each_step():
    events = []

    class Lease:
        async def acquire(self, run_id, step_name):
            events.append(("acquire", step_name))

        async def heartbeat(self, run_id, step_name):
            events.append(("heartbeat", step_name))

        async def release(self, run_id, step_name):
            events.append(("release", step_name))

    async def step(state, _context):
        return state

    await PipelineRunner(
        [PipelineStep("one", step)], lease_hook=Lease()
    ).run(context=context())
    assert events == [
        ("acquire", "one"),
        ("heartbeat", "one"),
        ("release", "one"),
    ]


@pytest.mark.asyncio
async def test_pipeline_heartbeats_during_long_step():
    heartbeats = 0

    class Lease:
        async def acquire(self, run_id, step_name):
            pass

        async def heartbeat(self, run_id, step_name):
            nonlocal heartbeats
            heartbeats += 1

        async def release(self, run_id, step_name):
            pass

    async def slow(state, _context):
        await asyncio.sleep(0.035)
        return state

    await PipelineRunner(
        [PipelineStep("slow", slow)],
        lease_hook=Lease(),
        heartbeat_interval_seconds=0.01,
    ).run(context=context("heartbeat-1"))
    # At least two in-flight heartbeats plus the completion heartbeat.
    assert heartbeats >= 3
