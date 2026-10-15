"""Unit tests for reports_analytics_agent integration and routing."""

import pytest
from unittest.mock import patch

from app.agents.coworker import create_coworker_agent
from app.agents.coworker.reports_analytics import ReportsAnalyticsAgent
from app.agents.definitions import (
    CONTACT_CENTER_SUPER_DEFINITION,
    REPORTS_ANALYTICS_AGENT_DEFINITION,
)
from app.runtime.context import RunContext
from app.runtime.memory import SessionMemory
from app.runtime.router import _handoff_error


def test_contact_center_super_handoff_targets_includes_reports_agent() -> None:
    assert "reports_analytics_agent" in CONTACT_CENTER_SUPER_DEFINITION.handoff_targets
    # Ensure legacy performance_intelligence_domain is no longer in active targets
    assert "performance_intelligence_domain" not in CONTACT_CENTER_SUPER_DEFINITION.handoff_targets


def test_reports_analytics_agent_definition_properties() -> None:
    assert REPORTS_ANALYTICS_AGENT_DEFINITION.name == "reports_analytics_agent"
    assert REPORTS_ANALYTICS_AGENT_DEFINITION.layer == "domain"
    assert REPORTS_ANALYTICS_AGENT_DEFINITION.mcp_servers == ()
    assert REPORTS_ANALYTICS_AGENT_DEFINITION.handoff_targets == ()


def test_handoff_error_allows_super_to_reports_domain() -> None:
    router = create_coworker_agent()
    handoff = {"agent_name": "reports_analytics_agent", "query": "handled conversations"}
    error = _handoff_error(
        handoff,
        "contact_center_super",
        router.agents,
        visited_agents=set(),
    )
    assert error is None


def test_coworker_agent_factory_registers_reports_analytics() -> None:
    router = create_coworker_agent()
    assert "reports_analytics_agent" in router.agents
    agent = router.agents["reports_analytics_agent"]
    assert isinstance(agent, ReportsAnalyticsAgent)
    assert agent.definition.name == "reports_analytics_agent"


@pytest.mark.asyncio
async def test_reports_analytics_agent_run_invokes_turn() -> None:
    agent = ReportsAnalyticsAgent()
    context = RunContext(
        tenant_id="1003",
        user_id="1016",
        role="admin",
        conversation_id="conv-test-1",
    )
    memory = SessionMemory("conv-test-1")
    user_message = {"role": "user", "content": "How many conversations were handled last week?"}

    mock_turn_result = {
        "answer": "<p>There were 142 conversations handled last week.</p>",
        "card": "card: kpi r1",
        "trace": {"plan": {"kind": "plan"}},
        "facts": "Handled: 142",
        "grounded": True,
    }

    with patch(
        "app.agents.reports_analytics_agent.core.turn.run_turn",
        return_value=mock_turn_result,
    ) as mock_run_turn:
        result = await agent.run([user_message], context, memory)

        assert mock_run_turn.called
        call_kwargs = mock_run_turn.call_args.kwargs
        assert call_kwargs["question"] == "How many conversations were handled last week?"
        assert call_kwargs["organization_id"] == 1003
        assert call_kwargs["user_id"] == 1016
        assert call_kwargs["role"] == "admin"

        assert result["response_type"] == "general_response"
        assert result["agent"] == "reports_analytics_agent"
        assert "142 conversations" in result["reply"]
        assert result["grounded"] is True
        assert result["card"] == "card: kpi r1"


@pytest.mark.asyncio
async def test_super_to_reports_routing_roundtrip() -> None:
    mock_turn_result = {
        "answer": "<p>Voice queue FCR dropped by 12% due to transfer loops.</p>",
        "card": "card: none",
        "trace": {"plan": {"kind": "plan", "tasks": [{"executor": "sql"}, {"executor": "kg"}]}},
        "facts": "FCR: 72% (-12%)",
        "grounded": True,
    }

    router = create_coworker_agent()
    router.orchestration_mode = "three_layer"
    context = RunContext(
        tenant_id="1003",
        user_id="1016",
        role="admin",
        conversation_id="conv-test-2",
    )

    handoff_tool_call = {
        "id": "call_123",
        "type": "function",
        "function": {
            "name": "route_to_agent",
            "arguments": '{"agent_name": "reports_analytics_agent", "query": "Why did FCR drop in voice queue?"}',
        },
    }

    with patch(
        "app.agents.reports_analytics_agent.core.turn.run_turn",
        return_value=mock_turn_result,
    ), patch.object(
        router.agents["contact_center_super"],
        "_chat",
        return_value={"content": "", "tool_calls": [handoff_tool_call]},
    ):
        result = await router.route_and_run(
            [{"role": "user", "content": "Why did FCR drop in voice queue?"}],
            context,
        )

        assert result["response_type"] == "general_response"
        assert result["agent"] == "reports_analytics_agent"
        assert "Voice queue FCR" in result["reply"]
