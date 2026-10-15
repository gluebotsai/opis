import asyncio
import json
from typing import Any

import pytest

from app.agents.coworker.contact import ContactAgent
from app.agents.coworker.conversation_assist import (
    ConversationAssistAgent,
    normalise_assist_state,
)
from app.agents.definitions import (
    AGENT_ASSIST_DOMAIN_DEFINITION,
    CONTACT_CENTER_SUPER_DEFINITION,
    CONVERSATION_ASSIST_DEFINITION,
)
from app.agents.prompt_loader import load_agent_document
from app.config import Settings, get_settings
from app.llm.providers import LLMResponse
from app.mcp.context import bind_trusted_context, build_trusted_context
from app.mcp.registry import get_mcp_registry
from app.mcp.servers.preferences import PreferencesMCPServer
from app.mcp.servers.skill import SkillMCPServer
from app.runtime.agent import Agent, AgentDefinition
from app.runtime.context import RunContext
from app.runtime.memory import SessionMemory
from app.runtime.router import AgentRouter, _handoff_error
from app.schemas.copilot import ToolContext


class StubAgent(Agent):
    def __init__(
        self,
        definition: AgentDefinition,
        responses: list[dict[str, Any]],
    ) -> None:
        super().__init__(definition)
        self.responses = responses
        self.calls = 0

    async def run(
        self,
        messages: list[dict[str, Any]],
        context: RunContext,
        memory: SessionMemory | None = None,
        *,
        add_messages: bool = True,
    ) -> dict[str, Any]:
        del context
        self.calls += 1
        memory = memory or SessionMemory("test")
        if add_messages:
            memory.extend(messages)
        result = dict(self.responses.pop(0))
        result.setdefault("messages", memory.get_messages())
        return result


class FakeLLM:
    def __init__(self, responses: list[LLMResponse]) -> None:
        self.responses = responses
        self.calls = []

    async def complete(self, messages, tools=None):
        self.calls.append((messages, tools))
        return self.responses.pop(0)


class SkillActivationMCP:
    def __init__(self) -> None:
        self.registry = get_mcp_registry()
        self.timeout_seconds = 5

    async def call_tool(self, server_name, tool_name, context, arguments, **_kwargs):
        if server_name == "skill" and tool_name == "update_skill_in_system":
            skill_id = arguments["skill_id"]
            skill = self.registry.get_server("skill").registry.get_skill(skill_id)
            context.active_skills[skill_id] = skill
            return {"status": "updated"}
        if tool_name == "stage_contact_draft":
            return {
                "_contact_draft": {
                    "mode": "create",
                    "fields": {"firstName": "Asha"},
                    "nextField": "primaryEmail",
                    "nextQuestion": "What is the email?",
                }
            }
        return {"ok": True}


def _definition(
    name: str,
    layer: str,
    targets: tuple[str, ...] = (),
) -> AgentDefinition:
    return AgentDefinition(
        name=name,
        system_prompt="",
        layer=layer,
        handoff_targets=targets,
    )


def test_tenant_allowlist_keeps_flat_as_safe_default() -> None:
    defaults = Settings(_env_file=None)
    assert defaults.coworker_mas_mode_for("tenant-1") == "three_layer"

    settings = Settings(
        _env_file=None,
        coworker_mas_mode="three_layer",
        coworker_mas_org_ids="tenant-2",
    )
    assert settings.coworker_mas_mode_for("tenant-1") == "flat"
    assert settings.coworker_mas_mode_for("tenant-2") == "three_layer"

    no_canary = Settings(
        _env_file=None,
        coworker_mas_mode="shadow",
        coworker_mas_org_ids="",
    )
    assert no_canary.coworker_mas_mode_for("tenant-1") == "flat"


@pytest.mark.asyncio
async def test_three_layer_route_reaches_executor_with_chain() -> None:
    super_agent = StubAgent(
        _definition("contact_center_super", "super", ("agent_assist_domain",)),
        [
            {
                "response_type": "routing_response",
                "agent_name": "agent_assist_domain",
                "query": "Find this contact",
            }
        ],
    )
    domain = StubAgent(
        _definition("agent_assist_domain", "domain", ("contact",)),
        [
            {
                "response_type": "routing_response",
                "agent_name": "contact",
                "query": "Find this contact",
            }
        ],
    )
    contact = StubAgent(
        _definition("contact", "executor", ("contact_center_super",)),
        [{"response_type": "general_response", "reply": "<p>Found.</p>", "agent": "contact"}],
    )
    router = AgentRouter(
        {
            "contact_center_super": super_agent,
            "agent_assist_domain": domain,
            "contact": contact,
        },
        default_agent_name="contact",
        orchestration_mode="three_layer",
    )

    result = await router.route_and_run(
        [{"role": "user", "content": "Find a contact"}],
        RunContext(tenant_id="tenant-1", surface="contacts-list"),
    )

    assert result["agent"] == "contact"
    assert result["routing_chain"] == [
        "contact_center_super",
        "agent_assist_domain",
        "contact",
    ]
    assert (super_agent.calls, domain.calls, contact.calls) == (1, 1, 1)


@pytest.mark.asyncio
async def test_three_layer_fills_empty_handoff_query_from_user_message() -> None:
    super_agent = StubAgent(
        _definition("contact_center_super", "super", ("workforce_management_domain",)),
        [
            {
                "response_type": "routing_response",
                "agent_name": "workforce_management_domain",
                "query": "",
            }
        ],
    )
    domain = StubAgent(
        _definition("workforce_management_domain", "domain", ("queue",)),
        [
            {
                "response_type": "routing_response",
                "agent_name": "queue",
                "query": "",
            }
        ],
    )
    queue = StubAgent(
        _definition("queue", "executor", ("contact_center_super",)),
        [{"response_type": "general_response", "reply": "<p>Name the queue.</p>", "agent": "queue"}],
    )
    router = AgentRouter(
        {
            "contact_center_super": super_agent,
            "workforce_management_domain": domain,
            "queue": queue,
        },
        default_agent_name="queue",
        orchestration_mode="three_layer",
    )

    result = await router.route_and_run(
        [{"role": "user", "content": "create quque"}],
        RunContext(tenant_id="tenant-1", surface="contacts-list"),
    )

    assert result["agent"] == "queue"
    assert result["reply"] == "<p>Name the queue.</p>"
    assert result["routing_chain"] == [
        "contact_center_super",
        "workforce_management_domain",
        "queue",
    ]


@pytest.mark.asyncio
async def test_shadow_observes_hierarchy_but_flat_route_stays_authoritative() -> None:
    super_agent = StubAgent(
        _definition("contact_center_super", "super", ("agent_assist_domain",)),
        [
            {
                "response_type": "routing_response",
                "agent_name": "agent_assist_domain",
                "query": "Find contact",
            }
        ],
    )
    domain = StubAgent(
        _definition("agent_assist_domain", "domain", ("contact",)),
        [
            {
                "response_type": "routing_response",
                "agent_name": "contact",
                "query": "Find contact",
            }
        ],
    )
    contact = StubAgent(
        _definition("contact", "executor"),
        [{"response_type": "general_response", "reply": "<p>Flat result.</p>", "agent": "contact"}],
    )
    router = AgentRouter(
        {
            "contact_center_super": super_agent,
            "agent_assist_domain": domain,
            "contact": contact,
        },
        default_agent_name="contact",
        orchestration_mode="shadow",
    )

    result = await router.route_and_run(
        [{"role": "user", "content": "Find contact"}],
        RunContext(tenant_id="tenant-1", surface="contacts-list"),
    )
    await asyncio.sleep(0)

    assert result["reply"] == "<p>Flat result.</p>"
    assert contact.calls == 1
    assert super_agent.calls == 1
    assert domain.calls == 1


@pytest.mark.asyncio
async def test_three_layer_falls_back_to_flat_before_executor() -> None:
    super_agent = StubAgent(
        _definition("contact_center_super", "super", ("agent_assist_domain",)),
        [{"response_type": "general_response", "reply": "ambiguous"}],
    )
    contact = StubAgent(
        _definition("contact", "executor"),
        [{"response_type": "general_response", "reply": "<p>Flat fallback.</p>", "agent": "contact"}],
    )
    router = AgentRouter(
        {"contact_center_super": super_agent, "contact": contact},
        default_agent_name="contact",
        orchestration_mode="three_layer",
    )

    result = await router.route_and_run(
        [{"role": "user", "content": "Find a contact"}],
        RunContext(tenant_id="tenant-1", surface="contacts-list"),
    )

    assert result["reply"] == "<p>Flat fallback.</p>"
    assert contact.calls == 1


@pytest.mark.asyncio
async def test_three_layer_stream_hides_internal_routing_frames() -> None:
    super_agent = Agent(
        _definition("contact_center_super", "super", ("agent_assist_domain",)),
        llm=FakeLLM(
            [
                LLMResponse(
                    tool_calls=[
                        {
                            "id": "super-route",
                            "function": {
                                "name": "route_to_agent",
                                "arguments": json.dumps(
                                    {
                                        "agent_name": "agent_assist_domain",
                                        "query": "Find contact",
                                    }
                                ),
                            },
                        }
                    ]
                )
            ]
        ),
    )
    domain = Agent(
        _definition("agent_assist_domain", "domain", ("contact",)),
        llm=FakeLLM(
            [
                LLMResponse(
                    tool_calls=[
                        {
                            "id": "domain-route",
                            "function": {
                                "name": "route_to_agent",
                                "arguments": json.dumps(
                                    {"agent_name": "contact", "query": "Find contact"}
                                ),
                            },
                        }
                    ]
                )
            ]
        ),
    )
    contact = Agent(
        _definition("contact", "executor", ("contact_center_super",)),
        llm=FakeLLM([LLMResponse(content="<p>Found contact.</p>")]),
    )
    router = AgentRouter(
        {
            "contact_center_super": super_agent,
            "agent_assist_domain": domain,
            "contact": contact,
        },
        default_agent_name="contact",
        orchestration_mode="three_layer",
    )

    events = [
        event
        async for event in router.stream(
            [{"role": "user", "content": "Find contact"}],
            RunContext(
                tenant_id="tenant-1",
                surface="contacts-list",
                path="/admin/contacts",
            ),
        )
    ]

    assert not any("route_to_agent" in event for event in events)
    assert any("Found contact" in event for event in events)
    assert '"route":"contact"' in events[-1]
    assert '"routingChain":["contact_center_super","agent_assist_domain","contact"]' in events[-1]


def test_strict_graph_allows_only_super_domain_executor_edges() -> None:
    agents = {
        "super": Agent(_definition("super", "super", ("domain",))),
        "domain": Agent(_definition("domain", "domain", ("executor",))),
        "executor": Agent(_definition("executor", "executor", ("super", "peer"))),
        "peer": Agent(_definition("peer", "executor", ("super",))),
    }

    assert _handoff_error(
        {"agent_name": "domain", "query": "q"},
        "super",
        agents,
        {"super"},
    ) is None
    assert _handoff_error(
        {"agent_name": "executor", "query": "q"},
        "domain",
        agents,
        {"super", "domain"},
    ) is None
    assert "not allowed" in str(
        _handoff_error(
            {"agent_name": "peer", "query": "q"},
            "executor",
            agents,
            {"super", "domain", "executor"},
        )
    )


def test_conversation_assist_is_direct_and_not_preloaded() -> None:
    document = load_agent_document("conversation_assist", fallback_prompt="")
    assert "conversation" in document.mcp_servers
    assert "organization" in document.mcp_servers
    assert "contact-entity-extraction" in document.allowed_skills
    assert document.required_skills == ()
    assert CONVERSATION_ASSIST_DEFINITION.required_skills == ()
    assert CONVERSATION_ASSIST_DEFINITION.max_tool_rounds == 3
    assert CONVERSATION_ASSIST_DEFINITION.layer == "executor"


def test_l1_l2_have_no_business_mcp_servers() -> None:
    assert CONTACT_CENTER_SUPER_DEFINITION.layer == "super"
    assert CONTACT_CENTER_SUPER_DEFINITION.mcp_servers == ()
    assert AGENT_ASSIST_DOMAIN_DEFINITION.layer == "domain"
    assert AGENT_ASSIST_DOMAIN_DEFINITION.mcp_servers == ()


def test_agent_markdown_loader_reads_governed_boundaries() -> None:
    document = load_agent_document("contact", fallback_prompt="")
    assert document.path is not None
    assert "contact" in document.mcp_servers
    assert "contact-create" in document.allowed_skills
    assert "contact-identity-resolution" in document.allowed_skills
    assert "contact-identity-resolution" not in document.required_skills


@pytest.mark.asyncio
async def test_skill_server_enforces_active_agent_allowlist() -> None:
    context = ToolContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        allowed_skills={"contact-create"},
    )
    trusted = build_trusted_context(
        "skill",
        context,
        agent_name="contact",
        surface="contacts-list",
    )
    server = SkillMCPServer()
    with bind_trusted_context(trusted):
        allowed = await server.get_skill("contact-create")
        denied = await server.get_skill("performance-analytics")
        denied_activation = await server.update_skill_in_system(
            "performance-analytics"
        )

    assert allowed["id"] == "contact-create"
    assert "not available" in denied["error"]
    assert "not available" in denied_activation["error"]


@pytest.mark.asyncio
async def test_dynamic_skill_tools_are_visible_only_when_enabled(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "dynamic_procedural_skills_enabled", True)
    agent = ContactAgent()
    await agent._load_tool_catalog(
        RunContext(
            tenant_id="tenant-1",
            user_id="user-1",
            role="admin",
            surface="contacts-list",
        )
    )
    tool_names = {
        tool["function"]["name"]
        for tool in agent.tools_schema
        if tool.get("function")
    }

    assert {
        "list_skills",
        "get_skill",
        "update_skill_in_system",
        "remove_skill_from_system",
        "list_active_skills",
    } <= tool_names


def test_active_skill_prompt_is_allowlisted_and_bounded(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "active_skill_prompt_max_chars", 100)
    agent = ContactAgent()
    context = RunContext(
        tenant_id="tenant-1",
        active_skills={
            "contact-create": {"name": "Create", "body": "x" * 1000},
            "performance-analytics": {"name": "Forbidden", "body": "secret"},
        },
    )

    prompt = agent._system_prompt(context)

    assert "ACTIVE SKILL [contact-create]" in prompt
    assert "performance-analytics" not in prompt
    assert "x" * 200 not in prompt


@pytest.mark.asyncio
async def test_llm_activated_contact_skill_is_injected_on_next_round(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "dynamic_procedural_skills_enabled", True)
    llm = FakeLLM(
        [
            LLMResponse(
                tool_calls=[
                    {
                        "id": "activate",
                        "function": {
                            "name": "update_skill_in_system",
                            "arguments": '{"skill_id":"contact-create","mode":"append"}',
                        },
                    }
                ]
            ),
            LLMResponse(
                tool_calls=[
                    {
                        "id": "stage",
                        "function": {
                            "name": "stage_contact_draft",
                            "arguments": (
                                '{"mode":"create","firstName":"Asha",'
                                '"nextField":"primaryEmail","nextQuestion":"What is the email?"}'
                            ),
                        },
                    }
                ]
            ),
            LLMResponse(content="<p>What is the email?</p>"),
        ]
    )
    agent = ContactAgent(llm=llm, mcp_client=SkillActivationMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-list",
    )

    result = await agent.run(
        [{"role": "user", "content": "Create Asha"}],
        context,
    )

    assert result["reply"] == "<p>What is the email?</p>"
    assert "ACTIVE SKILL [contact-create]" in llm.calls[-1][0][0]["content"]
    denied = await agent._call_tool("get_metrics", {}, context)
    assert "not available" in denied["error"]


@pytest.mark.asyncio
async def test_hard_preferences_are_verified_deterministically(monkeypatch) -> None:
    class PreferenceBackend:
        async def get(self, **_kwargs):
            return {"hard": {"blocked_actions": ["create_contact"]}}

    context = ToolContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
    )
    trusted = build_trusted_context(
        "preferences",
        context,
        agent_name="contact",
        surface="contacts-list",
    )
    server = PreferencesMCPServer()
    monkeypatch.setattr(server, "_backend", lambda: PreferenceBackend())
    with bind_trusted_context(trusted):
        result = await server.verify_hard_preferences("create_contact")

    assert result["allowed"] is False
    assert "blocked" in result["reason"]


@pytest.mark.asyncio
async def test_governed_mutation_requires_same_action_preference_verification(
    monkeypatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "agent_memory_v2_enabled", True)
    agent = ContactAgent(mcp_client=SkillActivationMCP())
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        role="admin",
        surface="contacts-list",
    )

    unverified = await agent._call_tool(
        "create_contact",
        {"firstName": "Asha", "primaryEmail": "asha@example.com"},
        context,
    )
    context.extra["hard_preference_verification"] = {
        "action_type": "create_contact",
        "result": {"allowed": True},
    }
    verified = await agent._call_tool(
        "create_contact",
        {"firstName": "Asha", "primaryEmail": "asha@example.com"},
        context,
    )

    assert "verify_hard_preferences" in unverified["error"]
    assert verified["ok"] is True


def test_structured_assist_output_keeps_private_content_separate() -> None:
    context = RunContext(
        tenant_id="tenant-1",
        extra={"assist_revision": 4, "source_message_id": "message-9"},
    )
    state = normalise_assist_state(
        json.dumps(
            {
                "replyDraft": "I can help with that.",
                "privateNotes": [{"kind": "fact", "text": "Customer prefers mornings."}],
                "actionProposal": {
                    "actionType": "book_appointment",
                    "summary": "Book a morning appointment.",
                    "collectedInputs": {"day": "Friday"},
                    "missingInputs": ["time"],
                    "confirmationText": "Continue?",
                },
            }
        ),
        context,
    )

    assert state["replyDraft"] == "I can help with that."
    assert state["privateNotes"][0]["text"] == "Customer prefers mornings."
    assert state["actionProposal"]["status"] == "proposed"
    assert state["revision"] == 4
    assert state["sourceMessageId"] == "message-9"


@pytest.mark.asyncio
async def test_passive_assist_is_a_direct_executor_path() -> None:
    assist = ConversationAssistAgent(
        llm=FakeLLM(
            [
                LLMResponse(
                    content=json.dumps(
                        {
                            "replyDraft": "Thanks, I have those details.",
                            "privateNotes": [],
                            "actionProposal": None,
                            "revision": 2,
                            "sourceMessageId": "message-2",
                        }
                    )
                )
            ]
        )
    )
    super_agent = StubAgent(
        _definition("contact_center_super", "super"),
        [{"response_type": "general_response", "reply": "must not run"}],
    )
    router = AgentRouter(
        {
            "conversation_assist": assist,
            "contact_center_super": super_agent,
        },
        default_agent_name="conversation_assist",
        orchestration_mode="three_layer",
    )
    context = RunContext(
        tenant_id="tenant-1",
        user_id="user-1",
        surface="inbox",
        conversation_id="conversation-1",
        extra={"assist_revision": 2, "source_message_id": "message-2"},
    )

    events = [
        event
        async for event in router.stream_direct(
            "conversation_assist",
            [{"role": "user", "content": "I can come Friday"}],
            context,
        )
    ]

    assert any(event.startswith("event: assist_state") for event in events)
    assert any("Thanks, I have those details." in event for event in events)
    assert super_agent.calls == 0

