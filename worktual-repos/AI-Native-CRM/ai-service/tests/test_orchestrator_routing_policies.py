from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.agents.llm_result import sectioned_system_prompt
from app.orchestrator.contracts import (
    AgentContext,
    AgentKind,
    AgentSpec,
    ExecutionEnvelope,
    Handoff,
    RunResult,
)
from app.orchestrator.errors import (
    ContractError,
    HandoffCycleError,
    HandoffLimitError,
    PolicyViolationError,
    ToolAuthorizationError,
)
from app.orchestrator.handoffs import HandoffTracker
from app.orchestrator.hooks import HookChain
from app.orchestrator.policies import (
    AuditPolicy,
    ConfirmationPolicy,
    IdempotencyPolicy,
    OutputSanitationPolicy,
    PromptRedactionPolicy,
    RoleToolPolicy,
    TenancyPolicy,
)
from app.orchestrator.registry import AgentRegistry, RegisteredAgent
from app.orchestrator.router import LlmRouter, RouteDecision
from app.orchestrator.supervisor import Supervisor


def context(**input_values):
    return AgentContext(
        envelope=ExecutionEnvelope(
            runId="run-route",
            traceId="trace-route",
            organizationId="org-1",
            actorId="user-1",
            role="sales_rep",
            businessType="b2b",
            deadline=datetime.now(timezone.utc) + timedelta(minutes=1),
            idempotencyKey="idem-route",
        ),
        input=input_values,
    )


def spec(name):
    return AgentSpec(
        name=name,
        version="1",
        kind=AgentKind.COWORKER,
        execution="turn",
        allowedTools=["read_contact", "update_contact"],
    )


@pytest.mark.asyncio
async def test_supervisor_routes_every_turn_including_previous_agent():
    routed = {}

    class Router:
        async def route(self, **kwargs):
            routed.update(kwargs)
            return RouteDecision(agent="contact", reason="llm")

    async def runner(ctx):
        return RunResult(
            runId=ctx.envelope.run_id,
            traceId=ctx.envelope.trace_id,
            assistantText="Specialist LLM answer",
        )

    registry = AgentRegistry([RegisteredAgent(spec("contact"), runner)])
    result = await Supervisor(registry, Router()).run(
        context=context(),
        candidates=registry.specs(),
        user_text="update this contact",
        active_agent="contact",
    )
    assert result.assistant_text == "Specialist LLM answer"
    assert routed["user_text"] == "update this contact"


@pytest.mark.asyncio
async def test_llm_router_validates_model_selected_candidate():
    captured = {}

    async def llm(**kwargs):
        captured.update(kwargs)
        return {
            "content": '{"agent":"contact","reason":"The user asked about a contact."}',
            "tool_calls": [],
        }

    decision = await LlmRouter(llm).route(
        context=context(),
        candidates=[spec("contact"), spec("company")],
        user_text="Update this contact",
    )
    assert decision.agent == "contact"
    system = captured["messages"][0]["content"]
    assert system.index("Role:") < system.index("Goal:") < system.index("Guardrails:")


@pytest.mark.asyncio
async def test_llm_router_retries_invalid_json():
    calls = 0

    async def llm(**_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return {"content": "I pick contact because it feels right", "tool_calls": []}
        return {
            "content": '{"agent":"contact-agent","reason":"valid retry"}',
            "tool_calls": [],
        }

    decision = await LlmRouter(llm).route(
        context=context(),
        candidates=[spec("contact-agent"), spec("link-agent")],
        user_text="Update this contact",
    )
    assert decision.agent == "contact-agent"
    assert decision.reason == "valid retry"
    assert calls == 2


@pytest.mark.asyncio
async def test_llm_router_preserves_allowed_continuity_after_invalid_retry():
    async def llm(**_kwargs):
        return {
            "content": '{"agent":"marketing","reason":"not in the candidate list"}',
            "tool_calls": [],
        }

    ctx = context()
    ctx.metadata["activeAgent"] = "company-agent"
    decision = await LlmRouter(llm).route(
        context=ctx,
        candidates=[spec("company-agent"), spec("link-agent")],
        user_text="Rename the company",
    )
    assert decision.agent == "company-agent"
    assert decision.reason == "llm_router_invalid_json_continuity"


@pytest.mark.asyncio
async def test_llm_router_fails_after_invalid_retry_without_continuity():
    async def llm(**_kwargs):
        return {"content": "not json", "tool_calls": []}

    with pytest.raises(ContractError):
        await LlmRouter(llm).route(
            context=context(),
            candidates=[spec("company-agent"), spec("link-agent")],
            user_text="Rename the company",
        )


@pytest.mark.asyncio
async def test_supervisor_routes_then_hands_off_with_context_patch():
    class Router:
        async def route(self, **kwargs):
            return RouteDecision(agent="contact", reason="contact request")

    async def contact_runner(ctx):
        return RunResult(
            runId=ctx.envelope.run_id,
            traceId=ctx.envelope.trace_id,
            assistantText="",
            handoff={
                "fromAgent": "contact",
                "toAgent": "company",
                "reason": "company update requested",
                "contextPatch": {"companyId": "company-1"},
            },
        )

    async def company_runner(ctx):
        assert ctx.metadata["companyId"] == "company-1"
        assert len(ctx.metadata["handoffHistory"]) == 1
        return RunResult(
            runId=ctx.envelope.run_id,
            traceId=ctx.envelope.trace_id,
            assistantText="Company specialist LLM answer",
        )

    registry = AgentRegistry(
        [
            RegisteredAgent(spec("contact"), contact_runner),
            RegisteredAgent(spec("company"), company_runner),
        ]
    )
    result = await Supervisor(registry, Router()).run(
        context=context(), candidates=registry.specs(), user_text="rename their company"
    )
    assert result.assistant_text.startswith("Company specialist")


def test_handoff_limits_and_cycles_are_hard_bounds():
    tracker = HandoffTracker(max_handoffs=1)
    first = Handoff(
        fromAgent="contact", toAgent="company", reason="company request"
    )
    history = tracker.append((), first)
    with pytest.raises(HandoffLimitError):
        tracker.append(
            history,
            Handoff(fromAgent="company", toAgent="sales", reason="deal request"),
        )

    cycle_tracker = HandoffTracker(max_handoffs=3)
    with pytest.raises(HandoffCycleError):
        cycle_tracker.append(
            (first,),
            Handoff(fromAgent="company", toAgent="contact", reason="cycle"),
        )


@pytest.mark.asyncio
async def test_tenancy_role_confirmation_and_sanitation_hooks():
    with pytest.raises(PolicyViolationError):
        await TenancyPolicy().before_run(
            spec("contact"), context(organizationId="other-org")
        )

    role_policy = RoleToolPolicy(
        {"sales_rep": ["read_contact", "update_contact"]},
        mutation_tools=["update_contact"],
    )
    await role_policy.authorize_tool(
        spec("contact"), context(), "read_contact", {}, mutation=False
    )
    with pytest.raises(ToolAuthorizationError):
        await role_policy.authorize_tool(
            spec("contact"), context(), "delete_contact", {}, mutation=True
        )
    with pytest.raises(PolicyViolationError):
        await ConfirmationPolicy(["update_contact"]).authorize_tool(
            spec("contact"), context(), "update_contact", {}, mutation=True
        )

    redacted = await PromptRedactionPolicy().before_prompt(
        spec("contact"),
        context(),
        [{"role": "user", "content": "api_key=top-secret"}],
    )
    assert "top-secret" not in redacted[0]["content"]
    sanitized = await OutputSanitationPolicy().after_run(
        spec("contact"),
        context(),
        RunResult(
            runId="run-route",
            traceId="trace-route",
            assistantText="password=hunter2",
        ),
    )
    assert "hunter2" not in sanitized.assistant_text


@pytest.mark.asyncio
async def test_idempotency_and_audit_are_formal_policy_hooks():
    claims = set()
    events = []

    class Store:
        async def claim(self, scope, key):
            value = (scope, key)
            if value in claims:
                return False
            claims.add(value)
            return True

    class Sink:
        async def record(self, event):
            events.append(event)

    idem = IdempotencyPolicy(Store())
    await idem.authorize_tool(
        spec("contact"),
        context(),
        "update_contact",
        {"contactId": "c1", "title": "CTO"},
        mutation=True,
    )
    with pytest.raises(PolicyViolationError):
        await idem.authorize_tool(
            spec("contact"),
            context(),
            "update_contact",
            {"title": "CTO", "contactId": "c1"},
            mutation=True,
        )

    audit = AuditPolicy(Sink())
    ctx = await audit.before_run(spec("contact"), context())
    await audit.after_tool(
        spec("contact"), ctx, "read_contact", {"ok": True, "sensitive": "omitted"}
    )
    await audit.after_run(
        spec("contact"),
        ctx,
        RunResult(
            runId="run-route",
            traceId="trace-route",
            assistantText="LLM answer",
        ),
    )
    assert [event["event"] for event in events] == [
        "agent_run_started",
        "agent_tool_completed",
        "agent_run_completed",
    ]
    assert all("sensitive" not in event for event in events)


def test_canonical_prompt_section_order_is_preserved():
    prompt = sectioned_system_prompt(
        role="role",
        goal="goal",
        instructions="instructions",
        context="context",
        output="output",
        guardrails="guardrails",
    )
    positions = [
        prompt.index(section)
        for section in (
            "Role:",
            "Goal:",
            "Instructions:",
            "Context:",
            "Output:",
            "Guardrails:",
        )
    ]
    assert positions == sorted(positions)
