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
from app.runtime.router import (
    _handoff_error,
    _needs_further_handoff,
    _normalize_reports_handoff,
)


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


@pytest.mark.asyncio
async def test_reports_analytics_agent_stream_invokes_turn() -> None:
    agent = ReportsAnalyticsAgent()
    context = RunContext(
        tenant_id="1003",
        user_id="1016",
        role="admin",
        conversation_id="conv-stream-1",
    )
    memory = SessionMemory("conv-stream-1")
    mock_turn_result = {
        "answer": "<p>Average handle time was 4.2 minutes.</p>",
        "card": "card: kpi r1",
        "trace": {"plan": {"kind": "plan"}},
        "facts": "AHT: 252s",
        "grounded": True,
    }

    with patch(
        "app.agents.reports_analytics_agent.core.turn.run_turn",
        return_value=mock_turn_result,
    ) as mock_run_turn:
        events: list[str] = []
        async for event in agent.stream(
            [{"role": "user", "content": "what is the average handle time of agents"}],
            context,
            memory,
        ):
            events.append(event)

        assert mock_run_turn.called
        joined = "".join(events)
        assert "Average handle time was 4.2 minutes" in joined
        assert "event: done" in joined
        assert "route_to_agent" not in joined


def test_reports_domain_is_terminal_for_three_layer() -> None:
    router = create_coworker_agent()
    reports = router.agents["reports_analytics_agent"]
    super_agent = router.agents["contact_center_super"]
    assist = router.agents["agent_assist_domain"]
    assert _needs_further_handoff(super_agent) is True
    assert _needs_further_handoff(assist) is True
    assert _needs_further_handoff(reports) is False


def test_legacy_analytics_alias_rewrites_when_unregistered() -> None:
    router = create_coworker_agent()
    rewritten = _normalize_reports_handoff(
        {"agent_name": "analytics", "query": "average handle time"},
        router.agents,
    )
    assert rewritten["agent_name"] == "reports_analytics_agent"
    error = _handoff_error(
        rewritten,
        "contact_center_super",
        router.agents,
        visited_agents=set(),
    )
    assert error is None


def test_legacy_analytics_alias_skips_when_stub_registered() -> None:
    router = create_coworker_agent()
    stub = router.agents["reports_analytics_agent"]
    agents = {**router.agents, "analytics": stub}
    unchanged = _normalize_reports_handoff(
        {"agent_name": "analytics", "query": "channel mix"},
        agents,
    )
    assert unchanged["agent_name"] == "analytics"


@pytest.mark.asyncio
async def test_super_to_reports_stream_roundtrip() -> None:
    mock_turn_result = {
        "answer": "<p>Average handle time was 4.2 minutes.</p>",
        "card": "card: none",
        "trace": {"plan": {"kind": "plan"}},
        "facts": "AHT: 252s",
        "grounded": True,
    }
    router = create_coworker_agent()
    router.orchestration_mode = "three_layer"
    context = RunContext(
        tenant_id="1003",
        user_id="1016",
        role="admin",
        conversation_id="conv-stream-2",
        surface="analytics",
    )
    handoff_tool_call = {
        "id": "call_stream",
        "type": "function",
        "function": {
            "name": "route_to_agent",
            "arguments": (
                '{"agent_name": "reports_analytics_agent",'
                ' "query": "what is the average handle time of agents"}'
            ),
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
        events: list[str] = []
        async for event in router.stream(
            [{"role": "user", "content": "what is the average handle time of agents"}],
            context,
        ):
            events.append(event)

    joined = "".join(events)
    assert "Average handle time was 4.2 minutes" in joined
    assert "event: done" in joined


@pytest.mark.asyncio
async def test_super_stream_aliases_legacy_analytics_name() -> None:
    mock_turn_result = {
        "answer": "<p>There were 142 conversations handled last week.</p>",
        "card": "card: none",
        "trace": {"plan": {"kind": "plan"}},
        "facts": "Handled: 142",
        "grounded": True,
    }
    router = create_coworker_agent()
    router.orchestration_mode = "three_layer"
    context = RunContext(
        tenant_id="1003",
        user_id="1016",
        role="admin",
        conversation_id="conv-stream-alias",
    )
    handoff_tool_call = {
        "id": "call_alias",
        "type": "function",
        "function": {
            "name": "route_to_agent",
            "arguments": '{"agent_name": "analytics", "query": "handled last week"}',
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
        events: list[str] = []
        async for event in router.stream(
            [{"role": "user", "content": "handled last week"}],
            context,
        ):
            events.append(event)

    assert "142 conversations" in "".join(events)


def test_surface_rules_handoff_kpis_to_reports_agent() -> None:
    from app.prompts.coworker import build_surface_rules

    dashboard = build_surface_rules("dashboard")
    assert "reports_analytics_agent" in dashboard
    assert "Do not answer those from generate_performance_report" in dashboard
    assert "get_dashboard_analytics_snapshot" in dashboard

    analytics = build_surface_rules("analytics")
    assert "reports_analytics_agent" in analytics
    assert "get_dashboard_analytics_snapshot" in analytics
    assert "get_analytics_hourly_volume" in analytics

    performance = build_surface_rules("performance")
    assert "reports_analytics_agent" in performance
    assert "generate_performance_report" not in performance

    reports = build_surface_rules("reports")
    assert "reports_analytics_agent" in reports
    assert "generate_performance_report" not in reports

    contacts = build_surface_rules("contacts-list")
    assert "route_to_agent to reports_analytics_agent" in contacts
    assert "route_to_agent to analytics" not in contacts


@pytest.mark.asyncio
async def test_adapter_run_turn_error_is_html_not_contract_leak() -> None:
    agent = ReportsAnalyticsAgent()
    context = RunContext(
        tenant_id="1003",
        user_id="1016",
        role="admin",
        conversation_id="conv-err",
    )
    with patch(
        "app.agents.reports_analytics_agent.core.turn.run_turn",
        side_effect=RuntimeError("boom"),
    ):
        result = await agent.run(
            [{"role": "user", "content": "what is average handle time"}],
            context,
        )
    assert result["response_type"] == "general_response"
    assert "kind chat HTML" not in result["reply"]
    assert "could not retrieve" in result["reply"].lower()
