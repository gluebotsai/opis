"""Supervisor Hub delegation guards."""

import pytest

from cc_a2a.config import A2ASettings
from cc_a2a.contracts import HubHelpRequest
from cc_a2a.supervisor import SuperAgentExecutor


@pytest.mark.asyncio
async def test_delegate_rejects_hub_source() -> None:
    executor = SuperAgentExecutor(
        A2ASettings(
            HUB_A2A_URL="http://hub.test:8030",
            HUB_A2A_CLIENT_SECRET="secret",
        )
    )
    request = HubHelpRequest(
        organizationId="1000",
        query="Should not bounce",
        commandId="cmd-bounce-001",
        source="hub",
    )
    result = await executor.delegate_to_hub(request)
    assert result.outcome == "rejected"
    assert "must not be delegated" in (result.message or "")


@pytest.mark.asyncio
async def test_delegate_rejects_when_hop_budget_exceeded() -> None:
    executor = SuperAgentExecutor(
        A2ASettings(
            HUB_A2A_URL="http://hub.test:8030",
            A2A_DELEGATION_HOP_BUDGET=1,
        )
    )
    request = HubHelpRequest(
        organizationId="1000",
        query="Too many hops",
        commandId="cmd-hop-001",
        hopCount=1,
    )
    result = await executor.delegate_to_hub(request)
    assert result.outcome == "rejected"
    assert "hop budget" in (result.message or "").lower()


@pytest.mark.asyncio
async def test_delegate_is_idempotent_by_command_id() -> None:
    executor = SuperAgentExecutor(A2ASettings(HUB_A2A_URL=""))
    request = HubHelpRequest(
        organizationId="1000",
        query="No hub configured",
        commandId="cmd-idem-001",
    )
    first = await executor.delegate_to_hub(request)
    second = await executor.delegate_to_hub(request)
    assert first is second or first.model_dump() == second.model_dump()
