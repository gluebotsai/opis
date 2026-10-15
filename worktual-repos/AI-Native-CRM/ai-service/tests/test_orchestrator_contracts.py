from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.agents import REGISTRY
from app.api.routes import CrmAgentRequest, router as api_router
from app.orchestrator.contracts import (
    AgentContext,
    AgentKind,
    AgentSpec,
    ExecutionEnvelope,
    ExecutionMode,
    RunResult,
)
from app.orchestrator.errors import AgentNotFoundError, ContractError
from app.orchestrator.orchestrator import Orchestrator, RuntimeControls
from app.orchestrator.registry import AgentRegistry, RegisteredAgent


def envelope(**overrides):
    data = {
        "runId": "run-1",
        "traceId": "trace-1",
        "organizationId": "org-1",
        "actorId": "user-1",
        "role": "sales_rep",
        "businessType": "b2b",
        "mode": "native",
        "deadline": datetime.now(timezone.utc) + timedelta(minutes=1),
        "idempotencyKey": "idem-1",
    }
    data.update(overrides)
    return ExecutionEnvelope.model_validate(data)


def spec(name="test-agent", **overrides):
    data = {
        "name": name,
        "version": "1.0",
        "kind": AgentKind.COWORKER,
        "execution": "turn",
    }
    data.update(overrides)
    return AgentSpec.model_validate(data)


def test_execution_envelope_is_versioned_and_serializes_aliases():
    value = envelope()
    dumped = value.model_dump(by_alias=True, mode="json")
    assert dumped["contractVersion"] == "1.0"
    assert dumped["organizationId"] == "org-1"
    assert dumped["toolBudget"]["maxRounds"] == 6
    assert value.remaining_seconds() > 0


def test_execution_envelope_rejects_naive_deadline_and_extra_identity():
    with pytest.raises(ValidationError):
        envelope(deadline=datetime.now())
    with pytest.raises(ValidationError):
        envelope(untrustedTenant="other")


def test_run_result_preserves_coworker_compatibility_fields():
    result = RunResult(
        runId="run-1",
        traceId="trace-1",
        assistantText="LLM response",
        patch={"name": "Acme"},
        toolProposals=[{"name": "navigate"}],
        sessionMemory={"activeAgent": "company"},
        uiRefresh={"modules": ["company"]},
    )
    payload = result.compatibility_dict()
    assert payload["assistantText"] == "LLM response"
    assert payload["patch"] == {"name": "Acme"}
    assert payload["toolProposals"][0]["name"] == "navigate"
    assert payload["sessionMemory"]["activeAgent"] == "company"
    assert payload["uiRefresh"]["modules"] == ["company"]


def test_registry_is_explicit_and_rejects_duplicates():
    async def runner(context: AgentContext) -> RunResult:
        return RunResult(
            runId=context.envelope.run_id,
            traceId=context.envelope.trace_id,
            assistantText="from llm",
        )

    item = RegisteredAgent(spec(), runner)
    registry = AgentRegistry([item])
    assert registry.get("test-agent") is item
    with pytest.raises(ContractError):
        AgentRegistry([item, item])
    with pytest.raises(AgentNotFoundError):
        registry.get("missing")


def test_runtime_controls_default_to_legacy_and_require_allowlists():
    controls = RuntimeControls(
        native_allowlist=frozenset({"native-agent"}),
        dry_run_allowlist=frozenset({"read-only-agent"}),
    )
    assert controls.mode_for("other", None).value == "legacy"
    assert controls.mode_for("native-agent", ExecutionMode.NATIVE).value == "native"
    assert (
        controls.mode_for("mutating-agent", ExecutionMode.DRY_RUN).value == "legacy"
    )


@pytest.mark.asyncio
async def test_orchestrator_correlates_result_without_global_active_agent():
    seen = []

    async def runner(context: AgentContext) -> RunResult:
        seen.append(context.envelope.run_id)
        return RunResult(
            runId=context.envelope.run_id,
            traceId=context.envelope.trace_id,
            assistantText="LLM-owned output",
            source="ai",
        )

    runtime = Orchestrator(AgentRegistry([RegisteredAgent(spec(), runner)]))
    first, second = await __import__("asyncio").gather(
        runtime.run("test-agent", envelope(runId="run-a")),
        runtime.run("test-agent", envelope(runId="run-b")),
    )
    assert {first.run_id, second.run_id} == {"run-a", "run-b"}
    assert set(seen) == {"run-a", "run-b"}


def test_frozen_agent_fixture_matches_registered_public_names():
    fixture = json.loads(
        (
            Path(__file__).parent / "fixtures" / "agent_contract_v1.json"
        ).read_text()
    )
    assert fixture["agentRun"]["pathTemplate"] == "/ai/v1/agents/:name/run"
    assert set(fixture["agentRun"]["names"]) == set(REGISTRY)
    mounted = {
        route.path.removeprefix("/ai/v1/agents/").removesuffix("/run")
        for route in api_router.routes
        if route.path.startswith("/ai/v1/agents/") and route.path.endswith("/run")
    }
    assert mounted == set(fixture["agentRun"]["names"])
    request = CrmAgentRequest.model_validate(
        fixture["agentRun"]["representativeRequest"]
    )
    assert request.organizationId == "org-1"
    assert request.businessType == "b2b"
    success = fixture["coworker"]["success"]
    parsed = RunResult(
        runId="fixture-run",
        traceId="fixture-trace",
        **{key: value for key, value in success.items() if key != "ok"},
    )
    assert parsed.compatibility_dict()["assistantText"]
