"""In-memory durable task store behaviour."""

import pytest

from cc_a2a.store import InMemoryTaskStore, TaskStoreError, canonical_request_hash


@pytest.mark.asyncio
async def test_idempotent_replay_and_hash_conflict() -> None:
    store = InMemoryTaskStore()
    envelope = {
        "commandId": "cmd-store-001",
        "skillId": "cc.organization.read",
        "contractVersion": "1.0",
        "organizationId": "42",
        "arguments": {},
    }
    request_hash = canonical_request_hash(envelope)
    first = await store.create_or_get(
        organization_id="42",
        caller_subject="hub:test",
        command_id="cmd-store-001",
        skill_id="cc.organization.read",
        request_hash=request_hash,
        request_envelope=envelope,
    )
    second = await store.create_or_get(
        organization_id="42",
        caller_subject="hub:test",
        command_id="cmd-store-001",
        skill_id="cc.organization.read",
        request_hash=request_hash,
        request_envelope=envelope,
    )
    assert first["id"] == second["id"]
    assert second["idempotentReplay"] is True

    with pytest.raises(TaskStoreError) as exc:
        await store.create_or_get(
            organization_id="42",
            caller_subject="hub:test",
            command_id="cmd-store-001",
            skill_id="cc.organization.read",
            request_hash="different-hash-value-000000000000",
            request_envelope={**envelope, "arguments": {"x": 1}},
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_cancel_task() -> None:
    store = InMemoryTaskStore()
    task = await store.create_or_get(
        organization_id="42",
        caller_subject="hub:test",
        command_id="cmd-store-002",
        skill_id="cc.organization.read",
        request_hash="hash-002",
        request_envelope={},
    )
    canceled = await store.cancel_task("42", task["id"], reason="test")
    assert canceled["state"] == "CANCELED"
