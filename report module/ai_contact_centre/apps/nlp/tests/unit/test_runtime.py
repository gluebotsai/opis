import json
from typing import Any

import pytest

from app.agents.coworker.analytics import AnalyticsAgent
from app.agents.coworker.contact import ContactAgent
from app.llm.providers import LLMResponse
from app.mcp.context import operation_id
from app.mcp.registry import get_mcp_registry
from app.agents.coworker.queue import QueueAgent
from app.runtime.agent import (
    _fallback_reply_for_silent_turn,
    _queue_draft_is_ready,
    _queue_status_still_unstaged,
    _ready_contact_mutation_tool,
    _ready_queue_mutation_tool,
)
from app.runtime.context import RunContext
from app.runtime.memory import SessionMemory
from app.runtime.sse import sse_action, sse_done, sse_error, sse_status


class FakeLLM:
    def __init__(self, responses: list[LLMResponse]) -> None:
        self.responses = responses
        self.calls: list[list[dict[str, Any]]] = []

    async def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
    ) -> LLMResponse:
        self.calls.append(messages)
        return self.responses.pop(0)


class FakeMCP:
    def __init__(self) -> None:
        self.registry = get_mcp_registry()
        self.timeout_seconds = 5
        self.calls: list[tuple[str, str, dict[str, Any]]] = []

    async def call_tool(
        self,
        server_name: str,
        tool_name: str,
        context: Any,
        arguments: dict[str, Any],
        **kwargs: Any,
    ) -> dict[str, Any]:
        self.calls.append((server_name, tool_name, arguments))
        try:
            self.registry.authorize(
                server_name=server_name,
                tool_name=tool_name,
                agent_name=str(kwargs.get("agent_name") or "contact"),
                surface=str(kwargs.get("surface") or "contacts-list"),
                role=str(getattr(context, "role", "admin")),
            )
        except PermissionError as exc:
            return {"error": str(exc)}
        if tool_name == "update_skill_in_system":
            skill_id = arguments["skill_id"]
            context.active_skills[skill_id] = {
                "id": skill_id,
                "name": skill_id,
                "body": "Use authoritative contact tools.",
            }
            return {"status": "updated"}
        if tool_name == "stage_queue_draft":
            return {
                "_queue_draft": {
                    "mode": "create",
                    "fields": {
                        "name": arguments.get("name") or "sales queue",
                        "teamName": arguments.get("teamName") or "Sales Team",
                        "status": arguments.get("status") or "active",
                    },
                    "nextField": arguments.get("nextField") or "businessHours",
                    "nextQuestion": "Which schedule should we use for this queue?",
                    "ready": False,
                }
            }
        if tool_name == "stage_contact_draft":
            return {
                "_contact_draft": {
                    "mode": "create",
                    "fields": {"firstName": "Asha"},
                    "nextField": "primaryEmail",
                    "nextQuestion": "What is the email or phone number?",
                    "skippedFields": [],
                    "ready": False,
                }
            }
        if tool_name == "update_contact":
            return {
                "contact": {
                    "id": arguments.get("contactId") or "contact-1",
                    "firstName": "Sanju",
                    "lastName": arguments.get("lastName") or "Ravi",
                },
                "changes": [key for key in arguments if key != "contactId"],
            }
        if tool_name == "create_queue":
            return {
                "id": "1017",
                "name": arguments.get("name") or "sales queue",
                "status": "inactive",
                "teamName": arguments.get("teamName") or "Sales Team",
            }
        if tool_name == "create_contact":
            return {
                "contact": {
                    "id": "contact-asha",
                    "firstName": arguments.get("firstName") or "Asha",
                    "primaryEmail": arguments.get("primaryEmail"),
                }
            }
        return {"ok": True}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("agent_name", "surface", "role"),
    [
        ("general", "general", "admin"),
        ("contact", "contacts-list", "admin"),
        ("inbox", "inbox", "agent"),
        ("task", "tasks-list", "agent"),
        ("queue", "queues-list", "admin"),
        ("analytics", "performance", "agent"),
        ("monitoring", "monitoring", "admin"),
    ],
)
async def test_every_coworker_can_handoff_from_its_home_surface(
    agent_name: str,
    surface: str,
    role: str,
) -> None:
    from app.agents.coworker import create_coworker_agent

    router = create_coworker_agent(llm=FakeLLM([]))
    agent = router.agents[agent_name]
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role=role,  # type: ignore[arg-type]
        surface=surface,
    )
    await agent._load_tool_catalog(context)
    tool_names = {
        tool["function"]["name"]
        for tool in agent.tools_schema
        if tool.get("function")
    }
    assert "route_to_agent" in tool_names


@pytest.mark.asyncio
async def test_llm_routes_misspelled_cross_page_request_without_keyword_parser() -> None:
    llm = FakeLLM(
        [
            LLMResponse(
                tool_calls=[
                    {
                        "id": "route-queue",
                        "type": "function",
                        "function": {
                            "name": "route_to_agent",
                            "arguments": json.dumps(
                                {"agent_name": "queue", "query": "Create a queue"}
                            ),
                        },
                    }
                ]
            )
        ]
    )
    agent = ContactAgent(llm=llm, mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-list",
    )

    result = await agent.run([{"role": "user", "content": "crate queue"}], context)

    assert result["response_type"] == "routing_response"
    assert result["agent_name"] == "queue"
    assert result["query"] == "Create a queue"


@pytest.mark.asyncio
async def test_self_handoff_continues_agent_loop_instead_of_routing_error() -> None:
    llm = FakeLLM(
        [
            LLMResponse(
                tool_calls=[
                    {
                        "id": "self-route",
                        "type": "function",
                        "function": {
                            "name": "route_to_agent",
                            "arguments": json.dumps(
                                {
                                    "agent_name": "analytics",
                                    "query": "Why is 10:00-11:00 the peak hour?",
                                }
                            ),
                        },
                    }
                ]
            ),
            LLMResponse(
                content="<p>Peak hour is 10:00-11:00 because inbound volume is highest then.</p>"
            ),
        ]
    )
    agent = AnalyticsAgent(llm=llm, mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="dashboard",
    )

    result = await agent.run(
        [{"role": "user", "content": "Why is 10:00-11:00 the peak hour?"}],
        context,
    )

    assert result["response_type"] == "general_response"
    assert "cannot hand off" not in (result.get("reply") or "")
    assert "Peak hour is 10:00-11:00" in result["reply"]
    assert any(
        "already_this_agent" in str(message.get("content") or "")
        for message in result["messages"]
        if message.get("role") == "tool"
    )


@pytest.mark.asyncio
async def test_self_handoff_stream_does_not_emit_routing_error() -> None:
    llm = FakeLLM(
        [
            LLMResponse(
                tool_calls=[
                    {
                        "id": "self-route",
                        "type": "function",
                        "function": {
                            "name": "route_to_agent",
                            "arguments": json.dumps(
                                {
                                    "agent_name": "analytics",
                                    "query": "Why is 10:00-11:00 the peak hour?",
                                }
                            ),
                        },
                    }
                ]
            ),
            LLMResponse(
                content="<p>Peak hour is 10:00-11:00 because inbound volume is highest then.</p>"
            ),
        ]
    )
    agent = AnalyticsAgent(llm=llm, mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="dashboard",
    )
    events: list[str] = []
    async for event in agent.stream(
        [{"role": "user", "content": "Why is 10:00-11:00 the peak hour?"}],
        context,
    ):
        events.append(event)

    joined = "".join(events)
    assert "cannot hand off" not in joined
    assert "Peak hour is 10:00-11:00" in joined


@pytest.mark.asyncio
async def test_agent_uses_mcp_and_rebuilds_skill_prompt() -> None:
    llm = FakeLLM(
        [
            LLMResponse(
                tool_calls=[
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "stage_contact_draft",
                            "arguments": (
                                '{"mode":"create","firstName":"Asha",'
                                '"nextField":"primaryEmail",'
                                '"nextQuestion":"What is the email or phone number?"}'
                            ),
                        },
                    }
                ]
            ),
            LLMResponse(content="<p>What is the email or phone number?</p>"),
        ]
    )
    mcp = FakeMCP()
    agent = ContactAgent(llm=llm, mcp_client=mcp)
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-list",
    )

    result = await agent.run([{"role": "user", "content": "Create Asha"}], context)

    assert result["reply"] == "<p>What is the email or phone number?</p>"
    assert result["contact_draft"]["nextField"] == "primaryEmail"
    assert any(call[1] == "stage_contact_draft" for call in mcp.calls)
    assert "ACTIVE SKILL [contact-create]" in llm.calls[-1][0]["content"]


@pytest.mark.asyncio
async def test_agent_stream_preserves_contact_draft_event() -> None:
    llm = FakeLLM(
        [
            LLMResponse(
                tool_calls=[
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "stage_contact_draft",
                            "arguments": (
                                '{"mode":"create","firstName":"Asha",'
                                '"nextField":"primaryEmail",'
                                '"nextQuestion":"What is the email or phone number?"}'
                            ),
                        },
                    }
                ]
            ),
            LLMResponse(content="<p>Please provide an email or phone number.</p>"),
        ]
    )
    agent = ContactAgent(llm=llm, mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-list",
    )

    events = [
        event
        async for event in agent.stream(
            [{"role": "user", "content": "Create Asha"}],
            context,
        )
    ]

    assert any(event.startswith("event: contact_draft") for event in events)
    assert events[-1].startswith("event: done")


@pytest.mark.asyncio
async def test_dashboard_causal_request_uses_normal_llm_tool_selection() -> None:
    from app.agents.coworker.analytics import AnalyticsAgent

    llm = FakeLLM([LLMResponse(content="<p>I need to choose the grounded analytics path.</p>")])
    agent = AnalyticsAgent(llm=llm, mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="dashboard",
    )

    events = [
        event
        async for event in agent.stream(
            [{"role": "user", "content": "Why did missed rate increase?"}],
            context,
        )
    ]

    assert len(llm.calls) == 1
    assert any("grounded analytics path" in event for event in events)
    assert not any('"tool":"ask_ontology_layer"' in event for event in events)


@pytest.mark.asyncio
async def test_missing_contact_draft_repair_is_single_constrained_llm_attempt() -> None:
    llm = FakeLLM(
        [
            LLMResponse(
                tool_calls=[
                    {
                        "id": "repair-1",
                        "type": "function",
                        "function": {
                            "name": "stage_contact_draft",
                            "arguments": json.dumps(
                                {
                                    "mode": "create",
                                    "firstName": "Asha",
                                    "nextField": "primaryEmail",
                                    "nextQuestion": "What is the email or phone number?",
                                }
                            ),
                        },
                    }
                ]
            )
        ]
    )
    agent = ContactAgent(llm=llm, mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-list",
    )
    memory = SessionMemory("repair")
    memory.add_message(
        {
            "role": "tool",
            "name": "route_to_agent",
            "content": json.dumps(
                {"status": "handoff", "agent_name": "contact", "query": "begin that workflow"}
            ),
        }
    )

    draft = await agent.repair_missing_workflow_draft(
        "contact",
        context,
        memory,
        "general_response",
    )

    assert draft and draft["nextField"] == "primaryEmail"
    assert len(llm.calls) == 1
    assert llm.calls[0][-1]["role"] == "system"
    assert "missing_workflow_draft" in llm.calls[0][-1]["content"]


def test_fallback_reply_for_silent_turn_after_open_task_workspace() -> None:
    memory = SessionMemory("test")
    memory.add_tool_result(
        "call-1",
        "open_task_workspace",
        json.dumps({"conversationId": "conversation-1", "path": "/agent/workspace?conversationId=conversation-1"}),
    )
    reply = _fallback_reply_for_silent_turn(memory, "task")
    assert "Opening the linked workspace" in reply


def test_fallback_reply_for_silent_turn_surfaces_tool_error() -> None:
    memory = SessionMemory("test")
    memory.add_tool_result(
        "call-1",
        "open_task_workspace",
        json.dumps({"error": "Task has no contact or conversation context"}),
    )
    reply = _fallback_reply_for_silent_turn(memory, "task")
    assert "couldn't open the workspace" in reply


def _event_data(event: str) -> dict[str, Any]:
    data_line = next(line for line in event.splitlines() if line.startswith("data: "))
    return json.loads(data_line.removeprefix("data: "))


@pytest.mark.asyncio
async def test_monitoring_agent_exposes_snapshot_tool_on_monitoring_surface() -> None:
    from app.agents.coworker.monitoring import MonitoringAgent

    agent = MonitoringAgent(llm=FakeLLM([]), mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="monitoring",
        path="/admin/monitoring",
    )
    await agent._load_tool_catalog(context)
    names = [tool["function"]["name"] for tool in agent.tools_schema if tool.get("function")]
    assert "get_monitoring_snapshot" in names
    assert "create_callback_task" in names
    assert "list_contacts" in names
    assert "navigate" in names
    assert "route_to_agent" in names


@pytest.mark.asyncio
async def test_monitoring_confirmation_reuses_preview_arguments() -> None:
    from app.agents.coworker.monitoring import MonitoringAgent

    preview_args = {"agentId": "1001", "agentName": "Test Agent"}
    confirmation_id = operation_id("force_agent_logout", preview_args)
    mcp = FakeMCP()
    agent = MonitoringAgent(llm=FakeLLM([]), mcp_client=mcp)
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="monitoring",
        path="/admin/monitoring",
        confirmed_actions=[confirmation_id],
        extra={
            "pending_confirmation": {
                "id": confirmation_id,
                "tool": "force_agent_logout",
                "args": preview_args,
            },
        },
    )

    await agent._call_tool(
        "force_agent_logout",
        {"agentId": "1001"},
        context,
    )

    assert mcp.calls[-1][2] == preview_args


@pytest.mark.asyncio
async def test_task_agent_exposes_route_to_agent_on_tasks_list() -> None:
    from app.agents.coworker.task import TaskAgent

    agent = TaskAgent(llm=FakeLLM([]), mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="agent",
        surface="tasks-list",
        path="/agent/tasks",
    )
    await agent._load_tool_catalog(context)
    names = [tool["function"]["name"] for tool in agent.tools_schema if tool.get("function")]
    assert "open_task_workspace" in names
    assert "navigate" in names
    assert "route_to_agent" in names


@pytest.mark.asyncio
async def test_task_agent_returns_self_route_for_router_validation() -> None:
    from app.agents.coworker.task import TaskAgent

    llm = FakeLLM(
        [
            LLMResponse(
                content="I'll hand this off.",
                tool_calls=[
                    {
                        "id": "route-1",
                        "type": "function",
                        "function": {
                            "name": "route_to_agent",
                            "arguments": json.dumps(
                                {"agent_name": "task", "query": "open the 2nd task"}
                            ),
                        },
                    }
                ],
            ),
            LLMResponse(content="<p>Opening the second task.</p>"),
        ]
    )
    agent = TaskAgent(llm=llm, mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="agent",
        surface="performance",
        path="/agent/performance",
    )

    result = await agent.run([{"role": "user", "content": "2nd one"}], context)

    assert result["response_type"] == "general_response"
    assert "second task" in result["reply"].lower()
    assert len(llm.calls) == 2


@pytest.mark.asyncio
async def test_contact_skill_bootstrap_works_after_handoff_from_tasks() -> None:
    """Handoffs keep the caller's surface; home-surface tools must still authorize."""
    llm = FakeLLM([LLMResponse(content="<p>There are 12 contacts.</p>")])
    mcp = FakeMCP()
    agent = ContactAgent(llm=llm, mcp_client=mcp)
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="agent",
        surface="tasks-list",
    )

    result = await agent.run(
        [{"role": "user", "content": "how many contacts are there"}],
        context,
    )

    assert result["reply"] == "<p>There are 12 contacts.</p>"
    tool_names = {
        tool["function"]["name"]
        for tool in agent.tools_schema
        if tool.get("function")
    }
    assert "list_contacts" in tool_names
    assert not result["reply"].startswith("I couldn't complete")


@pytest.mark.asyncio
async def test_generate_performance_report_stops_without_max_rounds() -> None:
    from app.agents.coworker.analytics import AnalyticsAgent

    class AnalyticsMCP(FakeMCP):
        async def call_tool(
            self,
            server_name: str,
            tool_name: str,
            context: Any,
            arguments: dict[str, Any],
            **kwargs: Any,
        ) -> dict[str, Any]:
            self.calls.append((server_name, tool_name, arguments))
            try:
                self.registry.authorize(
                    server_name=server_name,
                    tool_name=tool_name,
                    agent_name=str(kwargs.get("agent_name") or "analytics"),
                    surface=str(kwargs.get("surface") or "performance"),
                    role=str(getattr(context, "role", "agent")),
                )
            except PermissionError as exc:
                return {"error": str(exc)}
            if tool_name == "update_skill_in_system":
                skill_id = arguments["skill_id"]
                context.active_skills[skill_id] = {
                    "id": skill_id,
                    "name": skill_id,
                    "body": "Prefer generate_performance_report.",
                }
                return {"status": "updated"}
            if tool_name == "generate_performance_report":
                return {
                    "type": "plot",
                    "title": "Handled",
                    "chartType": "kpi",
                    "data": [{"label": "Handled", "value": "15"}],
                    "grounded": True,
                }
            return {"ok": True}

    llm = FakeLLM(
        [
            LLMResponse(
                content="<p>You have handled 15 conversations today.</p><p>Would you like to see handle time or resolution rate?</p>",
                tool_calls=[
                    {
                        "id": "call-1",
                        "type": "function",
                        "function": {
                            "name": "generate_performance_report",
                            "arguments": (
                                '{"variant":"kpi","skill_id":"performance-analytics",'
                                '"metric_ids":["conversations_handled"],'
                                '"focus":["handled"]}'
                            ),
                        },
                    }
                ],
            ),
        ]
    )
    mcp = AnalyticsMCP()
    agent = AnalyticsAgent(llm=llm, mcp_client=mcp)
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="agent",
        surface="performance",
    )

    result = await agent.run(
        [{"role": "user", "content": "how many chats handled today"}],
        context,
    )

    assert result["response_type"] == "general_response"
    assert result["reply"] != "Maximum tool rounds reached."
    assert sum(1 for call in mcp.calls if call[1] == "generate_performance_report") == 1
    assert len(llm.calls) == 1


@pytest.mark.asyncio
async def test_ad_hoc_plot_keeps_sql_rows_and_stops_after_plot() -> None:
    from app.agents.coworker.analytics import AnalyticsAgent

    class PlotMCP(FakeMCP):
        async def call_tool(
            self,
            server_name: str,
            tool_name: str,
            context: Any,
            arguments: dict[str, Any],
            **_kwargs: Any,
        ) -> dict[str, Any]:
            self.calls.append((server_name, tool_name, arguments))
            if tool_name == "update_skill_in_system":
                context.active_skills[arguments["skill_id"]] = {"body": "analytics"}
                return {"status": "updated"}
            if tool_name == "sql_analytics":
                rows = [
                    {"label": "Email", "value": 8},
                    {"label": "Webchat", "value": 4},
                ]
                context.recent_tool_data.extend(rows)
                return {"ok": True, "rows": rows}
            if tool_name == "generate_plot":
                assert context.recent_tool_data
                return {
                    "type": "plot",
                    "title": "Channel-wise chat count",
                    "chartType": "pie",
                    "data": arguments["data"],
                    "grounded": True,
                }
            return {"ok": True}

    llm = FakeLLM(
        [
            LLMResponse(
                tool_calls=[
                    {
                        "id": "sql-1",
                        "type": "function",
                        "function": {
                            "name": "sql_analytics",
                            "arguments": (
                                '{"query_description":"channel counts",'
                                '"sql_query":"SELECT channel AS label, COUNT(*) AS value '
                                'FROM conversations GROUP BY channel"}'
                            ),
                        },
                    }
                ]
            ),
            LLMResponse(
                tool_calls=[
                    {
                        "id": "plot-1",
                        "type": "function",
                        "function": {
                            "name": "generate_plot",
                            "arguments": (
                                '{"title":"Channel-wise chat count","chart_type":"pie",'
                                '"data":[{"label":"Email","value":8},'
                                '{"label":"Webchat","value":4}]}'
                            ),
                        },
                    }
                ]
            ),
            LLMResponse(
                content="<p>Email had 8 chats (67%) and Webchat had 4 chats (33%).</p><p>Would you like to compare with last week?</p>"
            ),
        ]
    )
    mcp = PlotMCP()
    agent = AnalyticsAgent(llm=llm, mcp_client=mcp)
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="agent",
        surface="performance",
    )

    result = await agent.run(
        [{"role": "user", "content": "pie chart for last two days by channel"}],
        context,
    )

    assert result["response_type"] == "general_response"
    assert "Email had 8 chats" in result["reply"]
    assert "Would you like to compare" in result["reply"]
    assert context.recent_tool_data
    assert [call[1] for call in mcp.calls].count("generate_plot") == 1
    assert len(llm.calls) == 3


@pytest.mark.asyncio
async def test_identical_tool_call_is_executed_only_once_per_turn() -> None:
    from app.agents.coworker.analytics import AnalyticsAgent

    class CountingMCP(FakeMCP):
        async def call_tool(
            self,
            server_name: str,
            tool_name: str,
            context: Any,
            arguments: dict[str, Any],
            **_kwargs: Any,
        ) -> dict[str, Any]:
            self.calls.append((server_name, tool_name, arguments))
            if tool_name == "update_skill_in_system":
                context.active_skills[arguments["skill_id"]] = {"body": "analytics"}
                return {"status": "updated"}
            return {"ok": True, "rows": [{"label": "Email", "value": 2}]}

    repeated_call = {
        "type": "function",
        "function": {
            "name": "sql_analytics",
            "arguments": (
                '{"query_description":"channel count",'
                '"sql_query":"SELECT channel AS label, COUNT(*) AS value '
                'FROM conversations GROUP BY channel"}'
            ),
        },
    }
    llm = FakeLLM(
        [
            LLMResponse(tool_calls=[{"id": "sql-1", **repeated_call}]),
            LLMResponse(tool_calls=[{"id": "sql-2", **repeated_call}]),
            LLMResponse(content="<p>Email had 2 chats.</p>"),
        ]
    )
    mcp = CountingMCP()
    agent = AnalyticsAgent(llm=llm, mcp_client=mcp)

    result = await agent.run(
        [{"role": "user", "content": "show channel count"}],
        RunContext(
            tenant_id="tenant-1",
            user_id="user-1",
            role="agent",
            surface="performance",
        ),
    )

    assert result["reply"] == "<p>Email had 2 chats.</p>"
    assert [call[1] for call in mcp.calls].count("sql_analytics") == 1


def test_sse_payloads_match_frontend_contract() -> None:
    assert _event_data(sse_status("thinking", "Working")) == {
        "phase": "thinking",
        "label": "Working",
    }
    assert _event_data(sse_action("refresh", {"resource": "contacts"})) == {
        "type": "refresh",
        "resource": "contacts",
    }
    assert _event_data(sse_error("Failed")) == {
        "code": "runtime_error",
        "message": "Failed",
    }
    assert _event_data(sse_done(route="contact"))["turnId"]
    assert _event_data(sse_done(route="contact"))["route"] == "contact"


@pytest.mark.asyncio
async def test_update_confirmation_question_does_not_nudge_mutation() -> None:
    llm = FakeLLM(
        [
            LLMResponse(content="<p>Would you like me to apply these changes?</p>"),
            LLMResponse(content=""),
        ]
    )
    mcp = FakeMCP()
    agent = ContactAgent(llm=llm, mcp_client=mcp)
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-detail",
        extra={
            "contact_draft": {
                "mode": "update",
                "contactId": "sanju-1",
                "fields": {"lastName": "Ravi"},
                "ready": True,
            }
        },
    )

    result = await agent.run(
        [{"role": "user", "content": "Set last name to Ravi"}],
        context,
    )

    assert result["reply"] == "<p>Would you like me to apply these changes?</p>"
    assert len(llm.calls) == 2
    assert not any(call[1] == "update_contact" for call in mcp.calls)


@pytest.mark.asyncio
async def test_yes_without_tool_call_does_not_regex_auto_save() -> None:
    llm = FakeLLM(
        [
            LLMResponse(content="<p>I've successfully updated the profile.</p>"),
            LLMResponse(content=""),
        ]
    )
    mcp = FakeMCP()
    agent = ContactAgent(llm=llm, mcp_client=mcp)
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-detail",
        contact_id="sanju-1",
        extra={
            "contact_draft": {
                "mode": "update",
                "contactId": "sanju-1",
                "fields": {"region": "Kerala", "language": "Tamil"},
                "nextField": None,
                "ready": True,
            }
        },
    )

    result = await agent.run(
        [{"role": "user", "content": "Yes, apply these changes."}],
        context,
    )

    assert result["reply"] == "<p>I've successfully updated the profile.</p>"
    assert len(llm.calls) == 2
    assert not any(call[1] == "update_contact" for call in mcp.calls)


@pytest.mark.asyncio
async def test_llm_repair_persists_ready_draft_after_claimed_save_without_tool() -> None:
    llm = FakeLLM(
        [
            LLMResponse(content="<p>I've successfully updated the profile.</p>"),
            LLMResponse(
                tool_calls=[
                    {
                        "id": "repair-update",
                        "type": "function",
                        "function": {
                            "name": "update_contact",
                            "arguments": json.dumps({"contactId": "sanju-1"}),
                        },
                    }
                ]
            ),
            LLMResponse(content="<p>Region is now Kerala and language is Tamil.</p>"),
        ]
    )
    mcp = FakeMCP()
    agent = ContactAgent(llm=llm, mcp_client=mcp)
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-detail",
        contact_id="sanju-1",
        extra={
            "contact_draft": {
                "mode": "update",
                "contactId": "sanju-1",
                "fields": {"region": "Kerala", "language": "Tamil"},
                "nextField": None,
                "ready": True,
            }
        },
    )

    result = await agent.run(
        [{"role": "user", "content": "Yes, apply these changes."}],
        context,
    )

    assert result["reply"] == "<p>Region is now Kerala and language is Tamil.</p>"
    assert any(call[1] == "update_contact" for call in mcp.calls)
    assert "unpersisted update draft" in llm.calls[1][-1]["content"]


@pytest.mark.asyncio
async def test_llm_repair_does_not_mutate_when_update_preview_is_not_ready() -> None:
    llm = FakeLLM(
        [LLMResponse(content="<p>I've successfully updated the city to Chennai.</p>")]
    )
    mcp = FakeMCP()
    agent = ContactAgent(llm=llm, mcp_client=mcp)
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-detail",
        contact_id="sanju-1",
        extra={
            "contact_draft": {
                "mode": "update",
                "contactId": "sanju-1",
                "fields": {},
                "nextField": "city",
                "ready": False,
            }
        },
    )

    result = await agent.run(
        [{"role": "user", "content": "Yes"}],
        context,
    )

    assert result["reply"] == "<p>I've successfully updated the city to Chennai.</p>"
    assert len(llm.calls) == 1
    assert not any(call[1] == "update_contact" for call in mcp.calls)


def test_queue_status_still_unstaged_when_turn_started_on_status() -> None:
    context = RunContext(
        tenant_id="tenant-1",
        extra={
            "queue_draft_at_turn_start": {
                "mode": "create",
                "fields": {"name": "sales queue", "teamName": "Sales Team"},
                "nextField": "status",
            },
            "queue_draft": {
                "mode": "create",
                "fields": {"name": "sales queue", "teamName": "Sales Team"},
                "nextField": "businessHours",
            },
        },
    )
    assert _queue_status_still_unstaged(context) is True


def test_queue_status_not_unstaged_after_status_is_merged() -> None:
    context = RunContext(
        tenant_id="tenant-1",
        extra={
            "queue_draft_at_turn_start": {
                "mode": "create",
                "fields": {"name": "sales queue"},
                "nextField": "status",
            },
            "queue_draft": {
                "mode": "create",
                "fields": {"name": "sales queue", "status": "active"},
                "nextField": "businessHours",
            },
        },
    )
    assert _queue_status_still_unstaged(context) is False


@pytest.mark.asyncio
async def test_llm_repair_stages_status_when_model_skips_tool() -> None:
    llm = FakeLLM(
        [
            LLMResponse(content="<p>Which business hours schedule should we apply?</p>"),
            LLMResponse(
                tool_calls=[
                    {
                        "id": "repair-status",
                        "type": "function",
                        "function": {
                            "name": "stage_queue_draft",
                            "arguments": json.dumps(
                                {
                                    "mode": "create",
                                    "name": "sales queue",
                                    "teamName": "Sales Team",
                                    "status": "active",
                                    "nextField": "businessHours",
                                }
                            ),
                        },
                    }
                ]
            ),
            LLMResponse(content="<p>Which business hours schedule should we apply?</p>"),
        ]
    )
    mcp = FakeMCP()
    agent = QueueAgent(llm=llm, mcp_client=mcp)
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="queue-create",
        extra={
            "queue_draft": {
                "mode": "create",
                "fields": {"name": "sales queue", "teamName": "Sales Team"},
                "nextField": "status",
            },
            "queue_draft_at_turn_start": {
                "mode": "create",
                "fields": {"name": "sales queue", "teamName": "Sales Team"},
                "nextField": "status",
            },
        },
    )

    result = await agent.run(
        [{"role": "user", "content": "active"}],
        context,
    )

    assert any(call[1] == "stage_queue_draft" for call in mcp.calls)
    assert result["queue_draft"]["fields"]["status"] == "active"
    assert "unstaged_queue_status" in llm.calls[1][-1]["content"]


def _ready_create_draft() -> dict:
    return {
        "mode": "create",
        "nextField": "review",
        "ready": True,
        "fields": {
            "name": "sales queue",
            "teamName": "sales team",
            "status": "inactive",
            "staffingComplete": True,
        },
    }


def test_ready_queue_draft_is_not_ready_after_persist() -> None:
    draft = _ready_create_draft()
    assert _queue_draft_is_ready(draft) is True
    draft["persistedQueueId"] = "1017"
    assert _queue_draft_is_ready(draft) is False
    context = RunContext(
        tenant_id="tenant-1",
        extra={"queue_draft": draft},
    )
    assert _ready_queue_mutation_tool(context) is None


@pytest.mark.asyncio
async def test_queue_create_loads_one_skill_and_hides_other_mutations() -> None:
    agent = QueueAgent(llm=FakeLLM([]), mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="queues-list",
        extra={"queue_draft": _ready_create_draft()},
    )
    await agent._load_tool_catalog(context)
    prompt = agent._system_prompt(context)
    tool_names = {
        tool["function"]["name"]
        for tool in agent.tools_schema
        if tool.get("function")
    }

    assert "ACTIVE SKILL [queue-create]" in prompt
    assert "ACTIVE SKILL [queue-update]" not in prompt
    assert "ACTIVE SKILL [queue-delete]" not in prompt
    assert "ALLOWED PROCEDURAL SKILLS" not in prompt
    assert "create_queue" in tool_names
    assert "delete_queue" not in tool_names
    assert "update_queue" not in tool_names


@pytest.mark.asyncio
async def test_queue_create_repair_skips_when_already_persisted() -> None:
    llm = FakeLLM(
        [LLMResponse(content="<p>The <strong>sales queue</strong> is already created.</p>")]
    )
    mcp = FakeMCP()
    agent = QueueAgent(llm=llm, mcp_client=mcp)
    draft = {**_ready_create_draft(), "persistedQueueId": "1017"}
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="queues-list",
        extra={"queue_draft": draft, "queue_draft_at_turn_start": draft},
    )

    result = await agent.run(
        [{"role": "user", "content": "ok done"}],
        context,
    )

    assert not any(call[1] == "create_queue" for call in mcp.calls)
    assert len(llm.calls) == 1
    assert "already persisted" in agent._system_prompt(context)
    assert result["reply"]


@pytest.mark.asyncio
async def test_create_queue_marks_draft_persisted_so_repair_cannot_loop() -> None:
    llm = FakeLLM(
        [
            LLMResponse(
                tool_calls=[
                    {
                        "id": "create-1",
                        "type": "function",
                        "function": {
                            "name": "create_queue",
                            "arguments": json.dumps(
                                {"name": "sales queue", "teamName": "sales team"}
                            ),
                        },
                    }
                ]
            ),
            LLMResponse(
                content="<p>The <strong>sales queue</strong> has been created (<strong>ID 1017</strong>).</p>"
            ),
        ]
    )
    mcp = FakeMCP()
    agent = QueueAgent(llm=llm, mcp_client=mcp)
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="queues-list",
        extra={
            "queue_draft": _ready_create_draft(),
            "queue_draft_at_turn_start": _ready_create_draft(),
        },
    )

    result = await agent.run(
        [{"role": "user", "content": "create"}],
        context,
    )

    assert any(call[1] == "create_queue" for call in mcp.calls)
    assert result["queue_draft"]["persistedQueueId"] == "1017"
    assert _ready_queue_mutation_tool(context) is None
    assert "create_queue" not in {
        tool["function"]["name"]
        for tool in agent.tools_schema
        if tool.get("function")
    }


@pytest.mark.asyncio
async def test_contact_create_loads_one_skill_and_hides_update() -> None:
    agent = ContactAgent(llm=FakeLLM([]), mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-list",
        extra={
            "contact_draft": {
                "mode": "create",
                "fields": {"firstName": "Asha"},
                "nextField": "primaryEmail",
                "ready": False,
            }
        },
    )
    await agent._load_tool_catalog(context)
    prompt = agent._system_prompt(context)
    tool_names = {
        tool["function"]["name"]
        for tool in agent.tools_schema
        if tool.get("function")
    }

    assert "ACTIVE SKILL [contact-create]" in prompt
    assert "ACTIVE SKILL [contact-update]" not in prompt
    assert "ALLOWED PROCEDURAL SKILLS" not in prompt
    assert "stage_contact_draft" in tool_names
    assert "create_contact" not in tool_names
    assert "update_contact" not in tool_names


@pytest.mark.asyncio
async def test_contact_save_marks_draft_persisted() -> None:
    llm = FakeLLM(
        [
            LLMResponse(
                tool_calls=[
                    {
                        "id": "create-1",
                        "type": "function",
                        "function": {
                            "name": "create_contact",
                            "arguments": json.dumps(
                                {"firstName": "Asha", "primaryEmail": "asha@example.com"}
                            ),
                        },
                    }
                ]
            ),
            LLMResponse(content="<p>Asha is saved.</p>"),
        ]
    )
    mcp = FakeMCP()
    agent = ContactAgent(llm=llm, mcp_client=mcp)
    ready = {
        "mode": "create",
        "fields": {"firstName": "Asha", "primaryEmail": "asha@example.com"},
        "nextField": None,
        "ready": True,
    }
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-list",
        extra={"contact_draft": ready, "contact_draft_at_turn_start": ready},
    )

    result = await agent.run(
        [{"role": "user", "content": "yes create"}],
        context,
    )

    assert any(call[1] == "create_contact" for call in mcp.calls)
    assert result["contact_draft"]["persistedContactId"]
    assert _ready_contact_mutation_tool(context) is None


@pytest.mark.asyncio
async def test_analytics_loads_performance_skill_and_hides_unrelated_tools() -> None:
    agent = AnalyticsAgent(llm=FakeLLM([]), mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="dashboard",
    )
    await agent._load_tool_catalog(context)
    prompt = agent._system_prompt(context)
    tool_names = {
        tool["function"]["name"]
        for tool in agent.tools_schema
        if tool.get("function")
    }

    assert "ACTIVE SKILL [performance-analytics]" in prompt
    assert "ALLOWED PROCEDURAL SKILLS" not in prompt
    assert "ask_semantic_layer" in tool_names
    assert "generate_performance_report" in tool_names
    assert "ask_ontology_layer" in tool_names
    assert "route_to_agent" in tool_names
    assert "list_queues" not in tool_names
    assert "create_contact" not in tool_names
    assert "route_to_agent" in prompt
    assert "contact-directory" in prompt.lower() or "contact directory" in prompt.lower()
    assert "get_dashboard_analytics_snapshot" in tool_names


@pytest.mark.asyncio
async def test_analytics_loads_dashboard_skill_on_analytics_surface() -> None:
    agent = AnalyticsAgent(llm=FakeLLM([]), mcp_client=FakeMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="analytics",
        path="/admin/dashboard/analytics",
    )
    await agent._load_tool_catalog(context)
    prompt = agent._system_prompt(context)
    tool_names = {
        tool["function"]["name"]
        for tool in agent.tools_schema
        if tool.get("function")
    }

    assert "ACTIVE SKILL [dashboard-analytics]" in prompt
    assert "get_dashboard_analytics_snapshot" in tool_names
    assert "get_analytics_hourly_volume" in tool_names
    assert "generate_performance_report" in tool_names
    assert "create_contact" not in tool_names
