from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

import app.agents as agents
from app.agents import NATIVE_REGISTRY, REGISTRY
from app.agents.named_native import (
    CONDITIONAL_PIPELINE_AGENTS,
    COWORKER_AGENTS,
    MEETING_AGENTS,
    MUTATION_AGENTS,
    NativeNamedRegistry,
)
from app.api.routes import router
from app.orchestrator.contracts import AgentKind


def _settings(**overrides):
    values = {
        "named_agents_native_enabled": True,
        "named_agents_native_allowlist": "",
        "named_agents_legacy_allowlist": "",
        "named_agents_native_deadline_seconds": 10,
        "named_agents_proposal_deadline_seconds": 240,
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_every_named_route_has_native_spec_and_adapter():
    route_names = {
        route.path.removeprefix("/ai/v1/agents/").removesuffix("/run")
        for route in router.routes
        if route.path.startswith("/ai/v1/agents/") and route.path.endswith("/run")
    }
    assert route_names == set(REGISTRY)
    assert {spec.name for spec in NATIVE_REGISTRY.specs()} == set(REGISTRY)
    for name in REGISTRY:
        adapter = NATIVE_REGISTRY.get(name)
        assert adapter.legacy_runner is REGISTRY[name]
        expected_kind = (
            AgentKind.MEETING
            if name in MEETING_AGENTS
            else AgentKind.COWORKER
            if name in COWORKER_AGENTS
            else AgentKind.PROACTIVE
        )
        assert adapter.spec.kind == expected_kind
        assert adapter.spec.mutation_capable is (name in MUTATION_AGENTS)
        if name in CONDITIONAL_PIPELINE_AGENTS:
            assert "branch" in adapter.pipeline_shape


@pytest.mark.asyncio
async def test_get_agent_selects_one_rollout_path(monkeypatch):
    legacy_calls = 0
    native_calls = 0

    async def legacy(*_args, **_kwargs):
        nonlocal legacy_calls
        legacy_calls += 1
        return {"path": "legacy"}

    async def native(name, *_args, **_kwargs):
        nonlocal native_calls
        native_calls += 1
        return {"path": f"native:{name}"}

    monkeypatch.setitem(agents.REGISTRY, "hello", legacy)
    monkeypatch.setattr(agents.NATIVE_REGISTRY, "run", native)
    monkeypatch.setattr(agents, "native_enabled_for", lambda _name: True)
    assert await agents.get_agent("hello")("hi") == {"path": "native:hello"}
    assert (native_calls, legacy_calls) == (1, 0)

    monkeypatch.setattr(agents, "native_enabled_for", lambda _name: False)
    assert await agents.get_agent("hello")("hi") == {"path": "legacy"}
    assert (native_calls, legacy_calls) == (1, 1)


@pytest.mark.asyncio
async def test_mutation_adapter_is_idempotent_and_never_dual_executes(monkeypatch):
    calls = 0

    async def mutation(contact_id, organization_id=None):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)
        return {
            "contactId": contact_id,
            "status": "ok",
            "source": "ai",
            "organizationId": organization_id,
        }

    monkeypatch.setattr(
        "app.agents.named_native.get_settings",
        lambda: _settings(),
    )
    registry = NativeNamedRegistry({"enrich-lead": mutation})
    first, second = await asyncio.gather(
        registry.run("enrich-lead", "contact-1", "org-1"),
        registry.run("enrich-lead", "contact-1", "org-1"),
    )
    assert first == second
    assert calls == 1
    record = next(iter(registry.run_store._records.values()))
    assert record.status == "completed"
    assert record.attempts == 1


@pytest.mark.asyncio
async def test_native_adapter_preserves_legacy_response_contract(monkeypatch):
    expected = {
        "ok": True,
        "analysis": {"summary": "LLM result"},
        "actions": ["follow_up"],
        "reason": None,
    }

    async def meeting_agent(**_kwargs):
        return dict(expected)

    monkeypatch.setattr(
        "app.agents.named_native.get_settings",
        lambda: _settings(),
    )
    registry = NativeNamedRegistry({"post-meeting-process": meeting_agent})
    result = await registry.run(
        "post-meeting-process",
        transcript="A sufficiently long meeting transcript",
        organization_id="org-1",
    )
    assert result == expected
    assert set(result) == set(expected)


@pytest.mark.asyncio
async def test_native_adapter_preserves_llm_primary_source_labels(monkeypatch):
    async def llm_agent(*_args, **_kwargs):
        return {"status": "ok", "source": "ai", "decision": {"action": "advance"}}

    monkeypatch.setattr(
        "app.agents.named_native.get_settings",
        lambda: _settings(),
    )
    registry = NativeNamedRegistry({"lifecycle-lead": llm_agent})
    result = await registry.run("lifecycle-lead", "contact-1", "org-1")
    assert result["source"] == "ai"
    assert "reason" not in result


@pytest.mark.asyncio
async def test_retry_classification_and_terminal_status(monkeypatch):
    async def permanent_failure(*_args, **_kwargs):
        raise ValueError("invalid input")

    async def transient_failure(*_args, **_kwargs):
        raise TimeoutError("upstream timeout")

    monkeypatch.setattr(
        "app.agents.named_native.get_settings",
        lambda: _settings(),
    )
    permanent = NativeNamedRegistry({"enrich-lead": permanent_failure})
    with pytest.raises(Exception):
        await permanent.run("enrich-lead", "contact-1")
    permanent_record = next(iter(permanent.run_store._records.values()))
    assert permanent_record.status == "dead_letter"
    assert permanent_record.attempts == 1

    transient = NativeNamedRegistry({"chat": transient_failure})
    with pytest.raises(Exception):
        await transient.run("chat", "system", "user")
    transient_record = next(iter(transient.run_store._records.values()))
    assert transient_record.status == "abandoned"
    assert transient_record.attempts == 2


@pytest.mark.asyncio
async def test_proposal_deadline_is_longer_than_default(monkeypatch):
    from app.agents.named_native import _deadline_seconds

    monkeypatch.setattr(
        "app.agents.named_native.get_settings",
        lambda: _settings(),
    )
    assert _deadline_seconds("enrich-lead") == 10
    assert _deadline_seconds("proposal-generate-section") == 240


@pytest.mark.asyncio
async def test_proposal_native_timeout_returns_payload(monkeypatch):
    async def hang(*_args, **_kwargs):
        raise TimeoutError("pipeline deadline")

    monkeypatch.setattr(
        "app.agents.named_native.get_settings",
        lambda: _settings(),
    )
    registry = NativeNamedRegistry({"proposal-generate-section": hang})
    out = await registry.run("proposal-generate-section", {})
    assert out["reason"] == "llm_timeout"
    assert out["source"] == "heuristic"
    assert "section" in out
    record = next(iter(registry.run_store._records.values()))
    assert record.attempts == 1


def test_typescript_named_client_contains_no_agent_brain():
    from pathlib import Path

    client = (
        Path(__file__).parents[2] / "backend/src/service/ai/ai-service-client.ts"
    ).read_text()
    assert "/ai/v1/agents/${agent}/run" in client
    for forbidden in ("generate_ai_text", "StateGraph", "PipelineRunner"):
        assert forbidden not in client
