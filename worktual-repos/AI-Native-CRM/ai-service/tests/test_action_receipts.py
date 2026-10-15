from __future__ import annotations

import pytest

from app.orchestrator.action_receipts import (
    ActionReceipts,
    InMemoryActionReceiptStore,
    canonical_arguments,
    receipt_key,
)


def test_canonical_arguments_ignore_ui_confirmation_noise():
    first = canonical_arguments(
        {"dealId": "d1", "stage": "propose", "confirmed": True, "label": "Move"}
    )
    second = canonical_arguments(
        {"stage": "propose", "dealId": "d1", "auto": True}
    )
    assert first == second


def test_receipt_key_is_tenant_actor_and_tool_isolated():
    args = {"dealId": "d1", "stage": "propose"}
    base = receipt_key("org-1", "user-1", "propose_stage_change", args)
    assert base != receipt_key("org-2", "user-1", "propose_stage_change", args)
    assert base != receipt_key("org-1", "user-2", "propose_stage_change", args)
    assert base != receipt_key("org-1", "user-1", "other_tool", args)


@pytest.mark.asyncio
async def test_confirmed_action_replay_is_claimed_once():
    receipts = ActionReceipts(InMemoryActionReceiptStore())
    values = dict(
        organization_id="org-1",
        actor_id="user-1",
        tool_name="propose_stage_change",
        arguments={"dealId": "d1", "stage": "propose", "confirmed": True},
    )
    first = await receipts.claim(**values)
    replay = await receipts.claim(
        **{
            **values,
            "arguments": {"stage": "propose", "dealId": "d1", "auto": True},
        }
    )
    assert first.replay is False
    assert replay.replay is True
    assert first.receipt_id == replay.receipt_id


@pytest.mark.asyncio
async def test_failed_action_can_release_receipt_for_safe_retry():
    receipts = ActionReceipts(InMemoryActionReceiptStore())
    values = dict(
        organization_id="org-1",
        actor_id="user-1",
        tool_name="propose_stage_change",
        arguments={"dealId": "d1", "stage": "negotiate"},
    )
    first = await receipts.claim(**values)
    await receipts.release(first)
    retry = await receipts.claim(**values)
    assert retry.replay is False
