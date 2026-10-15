"""Matrix coverage: every A2A spoke skill dispatches under Hub without breaking UI flows."""

from __future__ import annotations

from typing import Any

import pytest

from app.a2a.catalog import SpokeSkill, list_spoke_skills
from app.a2a.dispatch import dispatch_skill
from app.a2a.errors import InputRequiredError
from app.mcp.context import reset_ctx
from app.mcp.dispatch import dispatch as mcp_dispatch
from app.mcp.server import begin_agent_mcp_context, end_agent_mcp_context


def _async_b2b(_org: str, fallback: str | None = None) -> Any:
    async def _run(_organization_id: str, fallback: str | None = None) -> str:
        del _organization_id, fallback
        return "b2b"

    return _run(_org, fallback)


async def _b2b(_org: str, fallback: str | None = None) -> str:
    del fallback
    return "b2b"


def _minimal_hub_payload(skill: SpokeSkill) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "organizationId": "1000",
        "skillId": skill.id,
        "source": "hub",
    }
    for field in skill.required_fields:
        if field == "contactId":
            payload["cdpId"] = "42"
        elif field == "dealId":
            payload["dealId"] = "deal-1"
        elif field == "invoiceId":
            payload["invoiceId"] = "inv-1"
        elif field == "companyId":
            payload["companyId"] = "co-1"
        elif field == "activityId":
            payload["activityId"] = "act-1"
        elif field == "transcript":
            payload["transcript"] = "Rep: Hello. Prospect: Interested in pricing."
        elif field == "instruction":
            payload["instruction"] = "Draft a short follow-up email."
        elif field == "body":
            payload["body"] = "Customer shared an email address in chat."
        else:
            payload[field] = f"sample-{field}"
    if skill.kind == "coworker":
        payload.setdefault("cdpId", "42")
        payload.setdefault("text", f"Please run {skill.id} for this customer.")
        if skill.id == "activities":
            payload["actionType"] = "notify"
            payload["description"] = "Lead score increased from 41 to 82."
    return payload


def _all_skills() -> list[SpokeSkill]:
    return list(list_spoke_skills())


@pytest.mark.asyncio
@pytest.mark.parametrize("skill", _all_skills(), ids=lambda s: s.id)
async def test_hub_dispatch_every_spoke_skill(
    skill: SpokeSkill,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Each Hub-facing skill completes with required fields (agents mocked)."""
    calls: list[str] = []

    async def fake_agent(**kwargs: Any) -> dict[str, Any]:
        calls.append("agent")
        return {"ok": True, "assistantText": f"mocked {skill.id}", "skill": skill.id}

    async def fake_tool(
        name: str,
        arguments: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> dict[str, Any]:
        calls.append(f"tool:{name}")
        return {
            "ok": True,
            "assistantText": "Logged note on the contact.",
            "data": {"activityId": "act-hub-1", "type": "note"},
        }

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2b)
    monkeypatch.setattr("app.a2a.dispatch.issue_hub_mcp_token", lambda **k: "mcp-token")
    monkeypatch.setattr("app.mcp.server.begin_agent_mcp_context", lambda **k: None)
    monkeypatch.setattr("app.mcp.server.end_agent_mcp_context", lambda: {})
    monkeypatch.setattr("app.mcp.server.call_coworker_tool", fake_tool)
    # Single-skill matrix: do not LLM-chain follow-ups
    monkeypatch.setattr("app.a2a.orchestrate.is_ai_configured", lambda: False)

    import app.agents as agents

    fake_registry = {s.id: fake_agent for s in _all_skills() if s.agent_name != "crm-agent"}
    fake_registry["crm-agent"] = fake_agent
    # Named skills use REGISTRY[agent_name]; coworker uses get_agent("crm-agent").
    for name in list(agents.REGISTRY):
        monkeypatch.setitem(agents.REGISTRY, name, fake_agent)
    monkeypatch.setattr(agents, "get_agent", lambda name: fake_agent)

    result = await dispatch_skill(
        _minimal_hub_payload(skill),
        actor_id="hub:test",
        named_registry={**fake_registry, skill.agent_name: fake_agent},
    )
    assert result["status"] == "completed"
    assert result["skillId"] == skill.id
    assert result["agent"] == skill.agent_name
    assert result.get("result") is not None
    # Direct Hub activity write OR agent turn — something must have run.
    if skill.id == "activities":
        assert any(c.startswith("tool:") for c in calls)
    else:
        assert "agent" in calls or any(c.startswith("tool:") for c in calls)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "skill",
    [s for s in _all_skills() if s.required_fields],
    ids=lambda s: s.id,
)
async def test_hub_missing_required_field_asks_input(
    skill: SpokeSkill,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2b)
    with pytest.raises(InputRequiredError) as exc:
        await dispatch_skill(
            {
                "organizationId": "1000",
                "skillId": skill.id,
                "source": "hub",
                # intentionally omit required fields
            },
            actor_id="hub:test",
        )
    for field in skill.required_fields:
        assert field in exc.value.fields


@pytest.mark.asyncio
async def test_ui_propose_create_activity_still_form_owned() -> None:
    """Non-Hub coworker path must keep form-owned create (Vite owns the write)."""
    begin_agent_mcp_context(
        acting_user_id="1006",
        organization_id="1000",
        role="admin",
        agent_name="crm-agent",
        execution_mode="native",
        business_type="b2b",
        module="activities",
        surface="create",
        execution_token="ui-token",
        draft={
            "contactId": "42",
            "type": "note",
            "subject": "UI draft note",
            "body": "UI draft note",
        },
    )
    try:
        result = await mcp_dispatch(
            "propose_create_activity",
            {"confirmed": True, "auto": True, "label": "Log activity"},
        )
        assert result["ok"] is True
        assert result["kind"] == "form_owned"
        assert result["proposal"]["name"] == "propose_create_activity"
    finally:
        end_agent_mcp_context()
        reset_ctx()


@pytest.mark.asyncio
async def test_hub_propose_create_activity_executes_not_form_owned(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Hub actor must execute create_activity instead of returning form_owned."""

    async def fake_forward(command: str, arguments: dict[str, Any]) -> dict[str, Any]:
        assert command == "create_activity"
        assert arguments["contactId"] == "42"
        return {"activityId": "act-9", "type": "note", "contactId": "42"}

    monkeypatch.setattr(
        "app.mcp.dispatch.forward_business_command",
        fake_forward,
    )
    begin_agent_mcp_context(
        acting_user_id="hub:worktual-hub-crm",
        organization_id="1000",
        role="admin",
        agent_name="crm-agent",
        execution_mode="native",
        business_type="b2b",
        module="activities",
        surface="create",
        execution_token="hub-token",
        draft={
            "contactId": "42",
            "type": "note",
            "subject": "Hub notify",
            "body": "Hub notify",
        },
    )
    try:
        result = await mcp_dispatch(
            "propose_create_activity",
            {"confirmed": True, "auto": True},
        )
        assert result["ok"] is True
        assert result["kind"] == "executed"
        assert result["data"]["activityId"] == "act-9"
    finally:
        end_agent_mcp_context()
        reset_ctx()


def test_spoke_card_skill_count_stable() -> None:
    skills = list_spoke_skills()
    assert 20 <= len(skills) <= 32
    ids = {s.id for s in skills}
    # Core Hub surface must remain published.
    for required in (
        "score-lead",
        "activities",
        "contact-crud",
        "deals",
        "invoices",
        "compose-email",
    ):
        assert required in ids
    # Read/analytics and Hub-unfulfillable skills stay excluded.
    assert "reports" not in ids
    assert "hello" not in ids
    assert "crm-agent" not in ids
    assert "hygiene" not in ids
    assert "assist-meeting" not in ids
    assert "daily-briefing" not in ids
    assert "prospect-search" not in ids
    assert "document-template" not in ids
