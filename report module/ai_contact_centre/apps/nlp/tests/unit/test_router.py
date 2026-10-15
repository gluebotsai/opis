import json

import pytest

from app.runtime.memory import SessionMemory
from app.runtime.router import (
    _collect_navigation_paths,
    _handoff_error,
    _paths_differ,
    _prime_handoff_target,
    _repair_missing_draft,
    _strip_routing_prose,
    agent_home_path,
)


def test_agent_home_path_by_role() -> None:
    assert agent_home_path("contact", "admin") == "/admin/contacts"
    assert agent_home_path("contact", "agent") == "/agent/contacts"
    assert agent_home_path("analytics", "agent") == "/agent/performance"
    assert agent_home_path("analytics", "admin") == "/admin/dashboard/analytics"
    assert agent_home_path("queue", "admin") == "/admin/workforce/queues"


def test_select_agent_routes_dashboard_to_analytics() -> None:
    from app.agents.coworker import create_coworker_agent
    from app.llm.client import get_llm_client

    router = create_coworker_agent(llm=get_llm_client())
    assert router.select_agent("dashboard").definition.name == "analytics"
    assert router.select_agent("analytics").definition.name == "analytics"
    assert router.select_agent("performance").definition.name == "analytics"
    assert router.select_agent("monitoring").definition.name == "monitoring"
    assert router.select_agent("other").definition.name == "general"


def test_agent_home_path_monitoring() -> None:
    assert agent_home_path("monitoring", "admin") == "/admin/monitoring"


def test_paths_differ() -> None:
    assert _paths_differ("/agent/performance", "/agent/contacts")
    assert not _paths_differ("/agent/contacts", "/agent/contacts/")
    assert not _paths_differ("/agent/contacts", "/agent/contacts")


def test_already_on_analytics_home_covers_reports_and_analytics_tabs() -> None:
    from app.runtime.router import _already_on_agent_home

    assert _already_on_agent_home("analytics", "/admin/dashboard", "admin")
    assert _already_on_agent_home("analytics", "/admin/dashboard/analytics", "admin")
    assert not _already_on_agent_home("analytics", "/admin/contacts", "admin")


def test_prime_handoff_target_does_not_infer_workflow_from_query() -> None:
    memory = SessionMemory("test")
    memory.add_user_message("create a queue")
    _prime_handoff_target(memory, "create a queue")
    assert "stage_queue_draft" not in memory.messages[-1]["content"]


def test_strip_routing_prose_clears_handoff_message() -> None:
    memory = SessionMemory("test")
    memory.add_message(
        {
            "role": "assistant",
            "content": "I've handed this off to the contact specialist.",
            "tool_calls": [
                {
                    "id": "call-route",
                    "function": {"name": "route_to_agent", "arguments": "{}"},
                }
            ],
        }
    )
    _strip_routing_prose(memory)
    assert memory.messages[0]["content"] == ""


def test_prime_handoff_target_adds_direct_takeover_instruction() -> None:
    memory = SessionMemory("test")
    memory.add_user_message("create a contact")
    _prime_handoff_target(memory, "create a contact")
    assert memory.messages[-1]["role"] == "system"
    assert "Begin the workflow immediately" in memory.messages[-1]["content"]
    assert "stage_contact_draft" not in memory.messages[-1]["content"]


@pytest.mark.asyncio
async def test_missing_draft_repair_requires_trusted_active_workflow() -> None:
    from app.runtime.agent import Agent, AgentDefinition
    from app.runtime.context import RunContext

    class ContactStub(Agent):
        def __init__(self) -> None:
            super().__init__(AgentDefinition(name="contact", system_prompt=""))
            self.repairs = 0

        async def repair_missing_workflow_draft(
            self,
            draft_kind,
            context,
            memory,
            response_type,
        ):
            del draft_kind, context, memory, response_type
            self.repairs += 1
            return {"mode": "create"}

    agent = ContactStub()
    context = RunContext(tenant_id="tenant-1", surface="contacts-list")
    memory = SessionMemory("repair-gate")

    assert (
        await _repair_missing_draft(
            agent,
            {"response_type": "general_response"},
            context,
            memory,
        )
        is None
    )
    assert agent.repairs == 0

    context.active_skills["contact-create"] = {"id": "contact-create"}
    assert await _repair_missing_draft(
        agent,
        {"response_type": "general_response"},
        context,
        memory,
    ) == {"mode": "create"}
    assert agent.repairs == 1


@pytest.mark.asyncio
async def test_missing_draft_repair_runs_after_specialist_handoff() -> None:
    from app.runtime.agent import Agent, AgentDefinition
    from app.runtime.context import RunContext

    class QueueStub(Agent):
        def __init__(self) -> None:
            super().__init__(AgentDefinition(name="queue", system_prompt=""))
            self.repairs = 0

        async def repair_missing_workflow_draft(
            self,
            draft_kind,
            context,
            memory,
            response_type,
        ):
            del draft_kind, context, memory, response_type
            self.repairs += 1
            return {"mode": "create", "nextField": "name"}

    agent = QueueStub()
    context = RunContext(tenant_id="tenant-1", surface="contacts-list")
    context.extra["handoff_this_turn"] = True
    memory = SessionMemory("handoff-repair")

    assert await _repair_missing_draft(
        agent,
        {"response_type": "general_response"},
        context,
        memory,
    ) == {"mode": "create", "nextField": "name"}
    assert agent.repairs == 1
    assert "handoff_this_turn" not in context.extra


def test_handoff_validation_rejects_self_loops_cycles_and_invalid_payloads() -> None:
    from app.runtime.agent import Agent, AgentDefinition

    contact = Agent(AgentDefinition(name="contact", system_prompt=""))
    task = Agent(AgentDefinition(name="task", system_prompt=""))
    agents = {"contact": contact, "task": task}

    assert "itself" in str(
        _handoff_error(
            {"agent_name": "contact", "query": "continue"},
            "contact",
            agents,
            {"contact"},
        )
    )
    assert "cycle" in str(
        _handoff_error(
            {"agent_name": "task", "query": "continue"},
            "contact",
            agents,
            {"contact", "task"},
        )
    )
    assert "non-empty query" in str(
        _handoff_error({"agent_name": "task", "query": ""}, "contact", agents, {"contact"})
    )


@pytest.mark.asyncio
async def test_invalid_handoff_recovers_in_agent_loop_without_error_text() -> None:
    from app.runtime.agent import Agent, AgentDefinition
    from app.runtime.context import RunContext
    from app.runtime.router import AgentRouter
    from app.runtime.sse import sse_done, sse_text_delta, sse_thinking, sse_tool_call, sse_writing

    class AnalyticsStub(Agent):
        def __init__(self, definition: AgentDefinition) -> None:
            super().__init__(definition)
            self.rounds = 0

        async def stream(self, messages, context, memory=None):
            memory = memory or SessionMemory("test")
            memory.extend(messages)
            self.rounds += 1
            if self.rounds == 1:
                route_args = {"agent_name": "missing-specialist", "query": "Why peak hour?"}
                yield sse_thinking(context.surface)
                yield sse_tool_call("route_to_agent", route_args)
                yield sse_done(route="analytics")
                return
            reply = "<p>Peak hour is 10:00-11:00 because inbound volume is highest then.</p>"
            yield sse_thinking(context.surface)
            yield sse_writing()
            yield sse_text_delta(reply)
            yield sse_done(route="analytics")

    analytics = AnalyticsStub(
        AgentDefinition(name="analytics", system_prompt="", allowed_surfaces=("dashboard",))
    )
    router = AgentRouter(
        {"analytics": analytics},
        default_agent_name="analytics",
        orchestration_mode="flat",
    )
    context = RunContext(
        tenant_id="org-1",
        surface="dashboard",
        path="/admin/dashboard",
        role="admin",
        user_id="user-1",
    )
    events: list[str] = []
    async for event in router.stream(
        [{"role": "user", "content": "Why is 10:00-11:00 the peak hour?"}],
        context,
    ):
        events.append(event)

    joined = "".join(events)
    assert "cannot hand off" not in joined
    assert "not available" not in joined
    assert "Peak hour is 10:00-11:00" in joined
    assert analytics.rounds >= 2


def test_fill_handoff_query_uses_latest_user_message() -> None:
    from app.runtime.handoff import fill_handoff_query

    filled = fill_handoff_query(
        {"agent_name": "queue", "query": ""},
        [{"role": "user", "content": "create quque"}],
    )
    assert filled["query"] == "create quque"
    kept = fill_handoff_query(
        {"agent_name": "queue", "query": "Create a queue"},
        [{"role": "user", "content": "create quque"}],
    )
    assert kept["query"] == "Create a queue"


def test_collect_navigation_paths_from_route_to_agent() -> None:
    messages = [
        {
            "role": "tool",
            "name": "route_to_agent",
            "content": json.dumps(
                {"status": "handoff", "agent_name": "contact", "query": "create contact"}
            ),
        }
    ]
    assert _collect_navigation_paths(messages, "agent") == ["/agent/contacts"]


def test_collect_navigation_paths_from_navigate_tool() -> None:
    messages = [
        {
            "role": "tool",
            "name": "navigate",
            "content": json.dumps({"path": "/admin/contacts"}),
        }
    ]
    assert _collect_navigation_paths(messages, "admin") == ["/admin/contacts"]


@pytest.mark.asyncio
async def test_router_stream_emits_navigate_action_on_handoff() -> None:
    from app.runtime.agent import Agent, AgentDefinition
    from app.runtime.context import RunContext
    from app.runtime.router import AgentRouter
    from app.runtime.sse import sse_done, sse_text_delta, sse_thinking, sse_tool_call, sse_writing

    class AnalyticsStub(Agent):
        async def stream(self, messages, context, memory=None):
            memory = memory or SessionMemory("test")
            memory.extend(messages)
            route_args = {"agent_name": "contact", "query": "create contact"}
            memory.add_message(
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call-route",
                            "function": {
                                "name": "route_to_agent",
                                "arguments": json.dumps(route_args),
                            },
                        }
                    ],
                }
            )
            memory.add_tool_result(
                "call-route",
                "route_to_agent",
                json.dumps({"status": "handoff", **route_args}),
            )
            yield sse_thinking(context.surface)
            yield sse_tool_call("route_to_agent", route_args)
            yield sse_done(route="analytics")

    class ContactStub(Agent):
        async def stream(self, messages, context, memory=None):
            memory = memory or SessionMemory("test")
            memory.extend(messages)
            reply = "<p>Let's create a contact. What is their first name?</p>"
            memory.add_message({"role": "assistant", "content": reply})
            yield sse_thinking(context.surface)
            yield sse_writing()
            yield sse_text_delta(reply)
            yield sse_done(route="contact")

    analytics = AnalyticsStub(
        AgentDefinition(name="analytics", system_prompt="", allowed_surfaces=("performance",))
    )
    contact = ContactStub(
        AgentDefinition(name="contact", system_prompt="", allowed_surfaces=("contacts-list",))
    )
    router = AgentRouter(
        {"analytics": analytics, "contact": contact},
        default_agent_name="analytics",
        orchestration_mode="flat",
    )

    context = RunContext(
        tenant_id="org-1",
        surface="performance",
        path="/agent/performance",
        role="agent",
        user_id="user-1",
    )
    events: list[str] = []
    async for event in router.stream([{"role": "user", "content": "create a contact"}], context):
        events.append(event)

    action_events = [
        line
        for event in events
        for line in event.split("\n")
        if line.startswith("data:")
        and '"type":"navigate"' in line
        and "/agent/contacts" in line
    ]
    assert action_events, f"Expected navigate action in events: {events}"


@pytest.mark.asyncio
async def test_router_stream_drops_handoff_prose_and_navigates() -> None:
    from app.runtime.agent import Agent, AgentDefinition
    from app.runtime.context import RunContext
    from app.runtime.router import AgentRouter
    from app.runtime.sse import sse_done, sse_text_delta, sse_thinking, sse_tool_call, sse_writing

    class ContactStub(Agent):
        async def stream(self, messages, context, memory=None):
            memory = memory or SessionMemory("test")
            memory.extend(messages)
            route_args = {"agent_name": "analytics", "query": "Show yesterday's channel mix"}
            memory.add_message(
                {
                    "role": "assistant",
                    "content": "I've passed this to the analytics team.",
                    "tool_calls": [
                        {
                            "id": "call-route",
                            "function": {
                                "name": "route_to_agent",
                                "arguments": json.dumps(route_args),
                            },
                        }
                    ],
                }
            )
            memory.add_tool_result(
                "call-route",
                "route_to_agent",
                json.dumps({"status": "handoff", **route_args}),
            )
            yield sse_thinking(context.surface)
            yield sse_writing()
            yield sse_text_delta("I've passed this to the analytics team.")
            yield sse_tool_call("route_to_agent", route_args)
            yield sse_done(route="contact")

    class AnalyticsStub(Agent):
        async def stream(self, messages, context, memory=None):
            memory = memory or SessionMemory("test")
            memory.extend(messages)
            reply = "<p>Webchat 48%, Email 31%, WhatsApp 21%.</p>"
            memory.add_message({"role": "assistant", "content": reply})
            yield sse_thinking(context.surface)
            yield sse_writing()
            yield sse_text_delta(reply)
            yield sse_done(route="analytics")

    contact = ContactStub(
        AgentDefinition(name="contact", system_prompt="", allowed_surfaces=("contacts-list",))
    )
    analytics = AnalyticsStub(
        AgentDefinition(name="analytics", system_prompt="", allowed_surfaces=("dashboard",))
    )
    router = AgentRouter(
        {"contact": contact, "analytics": analytics},
        default_agent_name="contact",
        orchestration_mode="flat",
    )
    context = RunContext(
        tenant_id="org-1",
        surface="contacts-list",
        path="/admin/contacts",
        role="admin",
        user_id="user-1",
    )
    events: list[str] = []
    async for event in router.stream(
        [{"role": "user", "content": "Show yesterday's channel mix"}],
        context,
    ):
        events.append(event)

    joined = "".join(events)
    assert "I've passed this to the analytics team" not in joined
    assert "Webchat 48%" in joined
    assert any(
        '"type":"navigate"' in line and "/admin/dashboard/analytics" in line
        for event in events
        for line in event.split("\n")
        if line.startswith("data:")
    )


def test_registry_identifies_task_home_surfaces() -> None:
    from app.mcp.registry import get_mcp_registry

    registry = get_mcp_registry()
    assert registry.is_agent_home_surface("task", "tasks-list")
    assert registry.is_agent_home_surface("task", "tasks-detail")
    assert not registry.is_agent_home_surface("task", "performance")
