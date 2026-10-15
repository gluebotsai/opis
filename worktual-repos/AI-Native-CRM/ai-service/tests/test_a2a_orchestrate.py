"""Hub spoke supervisor — compose then send without touching coworker paths."""

from __future__ import annotations

from typing import Any

import pytest

from app.a2a.catalog import SpokeSkill, get_spoke_skill
from app.a2a.dispatch import dispatch_skill
from app.a2a.errors import InputRequiredError
from app.a2a.orchestrate import (
    complete_hub_compose_and_send,
    hub_wants_send_after_compose,
    hub_wants_send_email,
    plan_hub_agents,
)


def _compose_skill() -> SpokeSkill:
    skill = get_spoke_skill("compose-email")
    assert skill is not None
    return skill


async def _async_b2b(_org: str, fallback: str | None = None) -> str:
    del fallback
    return "b2b"


def test_hub_wants_send_when_action_type_send_email():
    skill = _compose_skill()
    assert hub_wants_send_after_compose(
        {
            "skillId": "compose-email",
            "actionType": "send_email",
            "instruction": "Follow up on the proposal",
            "cdpId": "42",
        },
        skill,
    )


def test_hub_wants_send_from_instruction_text():
    skill = _compose_skill()
    assert hub_wants_send_after_compose(
        {
            "skillId": "compose-email",
            "instruction": (
                "CRM sends a follow-up email. Log the email activity in CRM after dispatch."
            ),
            "cdpId": "42",
        },
        skill,
    )


def test_hub_draft_only_without_send_action():
    skill = _compose_skill()
    assert not hub_wants_send_after_compose(
        {
            "skillId": "compose-email",
            "instruction": "Draft a short intro email about our products",
            "cdpId": "42",
        },
        skill,
    )


def test_send_outbound_not_on_hub_card():
    assert get_spoke_skill("send-outbound-email") is None


@pytest.mark.asyncio
async def test_complete_hub_compose_and_send_chains(monkeypatch):
    calls: list[str] = []

    async def fake_invoke(name: str, payload: dict[str, Any]) -> dict[str, Any]:
        calls.append(name)
        if name == "compose-email":
            return {
                "ok": True,
                "subject": "Proposal follow-up",
                "body": "Hi,\n\nChecking in.\n\nBest regards,",
                "source": "ai",
            }
        assert name == "send-outbound-email"
        assert payload.get("subject") == "Proposal follow-up"
        assert "Checking in" in str(payload.get("body") or "")
        assert str(payload.get("contact_id") or payload.get("contactId")) == "42"
        return {
            "ok": True,
            "status": "sent",
            "to": "saravanan123@gmail.com",
            "activityId": "act-1",
        }

    monkeypatch.setattr("app.a2a.orchestrate.log_a2a", lambda **_k: None)

    result = await complete_hub_compose_and_send(
        {
            "skillId": "compose-email",
            "actionType": "send_email",
            "cdpId": "42",
            "organizationId": "1000",
            "instruction": "Send follow-up about the proposal",
        },
        invoke_named=fake_invoke,
    )
    assert calls == ["compose-email", "send-outbound-email"]
    assert result["ok"] is True
    assert result["sent"] is True
    assert result["orchestrated"] is True
    assert result["to"] == "saravanan123@gmail.com"
    assert result["steps"] == ["compose-email", "send-outbound-email"]


@pytest.mark.asyncio
async def test_complete_hub_stops_when_compose_fails(monkeypatch):
    calls: list[str] = []

    async def fake_invoke(name: str, _payload: dict[str, Any]) -> dict[str, Any]:
        calls.append(name)
        return {"ok": False, "reason": "instruction_required"}

    monkeypatch.setattr("app.a2a.orchestrate.log_a2a", lambda **_k: None)

    result = await complete_hub_compose_and_send(
        {"skillId": "compose-email", "actionType": "send_email", "cdpId": "42"},
        invoke_named=fake_invoke,
    )
    assert calls == ["compose-email"]
    assert result["ok"] is False
    assert result["sent"] is False


@pytest.mark.asyncio
async def test_complete_hub_reports_send_failure(monkeypatch):
    calls: list[str] = []

    async def fake_invoke(name: str, _payload: dict[str, Any]) -> dict[str, Any]:
        calls.append(name)
        if name == "compose-email":
            return {
                "ok": True,
                "subject": "Hi",
                "body": "Body text long enough",
                "source": "ai",
            }
        return {"ok": False, "status": "failed", "error": "no_crm_bot_mailbox"}

    monkeypatch.setattr("app.a2a.orchestrate.log_a2a", lambda **_k: None)
    result = await complete_hub_compose_and_send(
        {
            "skillId": "compose-email",
            "actionType": "send_email",
            "cdpId": "42",
            "organizationId": "1000",
        },
        invoke_named=fake_invoke,
    )
    assert calls == ["compose-email", "send-outbound-email"]
    assert result["ok"] is False
    assert result["sent"] is False
    assert result["error"] == "no_crm_bot_mailbox"
    assert result["compose"]["ok"] is True


@pytest.mark.asyncio
async def test_dispatch_send_email_uses_supervisor(monkeypatch):
    calls: list[str] = []

    async def fake_compose(
        instruction: str,
        contact_id: str | None = None,
        organization_id: str | None = None,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        calls.append("compose-email")
        assert contact_id == "42"
        return {
            "ok": True,
            "subject": "Proposal follow-up",
            "body": "Hi,\n\nPlease share a status update.\n\nBest regards,",
            "source": "ai",
        }

    async def fake_send(
        contact_id: str,
        subject: str,
        body: str,
        organization_id: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        calls.append("send-outbound-email")
        assert contact_id == "42"
        assert subject == "Proposal follow-up"
        assert "status update" in body.lower()
        assert organization_id == "1000"
        return {
            "ok": True,
            "status": "sent",
            "to": "saravanan123@gmail.com",
            "activityId": "act-99",
        }

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    monkeypatch.setattr("app.a2a.orchestrate.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    import app.agents as agents

    monkeypatch.setitem(agents.REGISTRY, "compose-email", fake_compose)
    monkeypatch.setitem(agents.REGISTRY, "send-outbound-email", fake_send)
    monkeypatch.setattr(agents, "get_agent", lambda name: agents.REGISTRY[name])

    result = await dispatch_skill(
        {
            "skillId": "compose-email",
            "organizationId": "1000",
            "cdpId": "42",
            "actionType": "send_email",
            "instruction": "Send a follow-up about the pending proposal.",
            "source": "hub",
        },
        actor_id="hub:test",
        named_registry={
            "compose-email": fake_compose,
            "send-outbound-email": fake_send,
        },
    )
    assert calls == ["compose-email", "send-outbound-email"]
    assert result["status"] == "completed"
    assert result["agent"] == "crm-spoke-supervisor"
    assert result["result"]["orchestrated"] is True
    assert result["result"]["sent"] is True
    assert result["result"]["to"] == "saravanan123@gmail.com"


@pytest.mark.asyncio
async def test_dispatch_draft_only_skips_send(monkeypatch):
    calls: list[str] = []

    async def fake_compose(
        instruction: str,
        contact_id: str | None = None,
        organization_id: str | None = None,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        calls.append("compose-email")
        return {
            "ok": True,
            "subject": "Our products - a quick overview",
            "body": "Hi,\n\nOverview.\n\nBest regards,",
            "source": "heuristic",
        }

    async def fake_send(*_a: Any, **_k: Any) -> dict[str, Any]:
        calls.append("send-outbound-email")
        raise AssertionError("send must not run for draft-only")

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.is_ai_configured", lambda: False)
    import app.agents as agents

    monkeypatch.setitem(agents.REGISTRY, "compose-email", fake_compose)
    monkeypatch.setitem(agents.REGISTRY, "send-outbound-email", fake_send)
    monkeypatch.setattr(agents, "get_agent", lambda name: agents.REGISTRY[name])

    result = await dispatch_skill(
        {
            "skillId": "compose-email",
            "organizationId": "1000",
            "cdpId": "42",
            "instruction": "Draft a short intro email about our products",
        },
        actor_id="hub:test",
        named_registry={"compose-email": fake_compose},
    )
    assert calls == ["compose-email"]
    assert result["status"] == "completed"
    assert result["agent"] == "compose-email"
    assert result["result"]["subject"].startswith("Our products")


@pytest.mark.asyncio
async def test_dispatch_send_email_requires_contact(monkeypatch):
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    with pytest.raises(InputRequiredError) as exc:
        await dispatch_skill(
            {
                "skillId": "compose-email",
                "organizationId": "1000",
                "actionType": "send_email",
                "instruction": "Send a follow-up email now",
            },
            actor_id="hub:test",
        )
    assert "contactId" in exc.value.fields


@pytest.mark.asyncio
async def test_supervisor_chains_when_llm_requests_follow_up(monkeypatch):
    calls: list[str] = []

    async def fake_score(
        contact_id: str, organization_id: str | None = None, **_k: Any
    ) -> dict[str, Any]:
        calls.append("score-lead")
        return {"ok": True, "band": "warm", "total": 55}

    async def fake_nurture(
        contact_id: str, organization_id: str | None = None, **_k: Any
    ) -> dict[str, Any]:
        calls.append("nurture-lead")
        assert contact_id == "42"
        return {"ok": True, "decision": "nurture_now", "status": "sent"}

    async def fake_decide(**_kwargs: Any) -> dict[str, Any]:
        if "score-lead" in calls and "nurture-lead" not in calls:
            return {
                "done": False,
                "nextAgent": "nurture-lead",
                "reason": "Hub asked to nurture after scoring",
                "args": {"contact_id": "42"},
            }
        return {"done": True, "reason": "goal complete"}

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.is_ai_configured", lambda: False)
    monkeypatch.setattr("app.a2a.orchestrate.decide_next_agent", fake_decide)
    import app.agents as agents

    monkeypatch.setitem(agents.REGISTRY, "score-lead", fake_score)
    monkeypatch.setitem(agents.REGISTRY, "nurture-lead", fake_nurture)
    monkeypatch.setattr(agents, "get_agent", lambda n: agents.REGISTRY[n])

    result = await dispatch_skill(
        {
            "skillId": "score-lead",
            "organizationId": "1000",
            "cdpId": "42",
            "source": "hub",
            "instruction": "Score this lead and nurture if warm or hot.",
        },
        actor_id="hub:test",
    )
    assert calls == ["score-lead", "nurture-lead"]
    assert result["agent"] == "crm-spoke-supervisor"
    assert result["result"]["orchestrated"] is True
    assert result["result"]["steps"] == ["score-lead", "nurture-lead"]


@pytest.mark.asyncio
async def test_instruction_overrides_wrong_skill_id_for_send(monkeypatch):
    """Send intent in instruction triggers compose→send even when skillId is wrong."""
    calls: list[str] = []

    async def fake_compose(**_k: Any) -> dict[str, Any]:
        calls.append("compose-email")
        return {
            "ok": True,
            "subject": "Follow-up",
            "body": "Hi,\n\nChecking in.\n\nBest regards,",
            "source": "ai",
        }

    async def fake_send(**_k: Any) -> dict[str, Any]:
        calls.append("send-outbound-email")
        return {"ok": True, "status": "sent", "to": "a@b.com", "activityId": "act-1"}

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.log_a2a", lambda **_k: None)
    import app.agents as agents

    monkeypatch.setitem(agents.REGISTRY, "compose-email", fake_compose)
    monkeypatch.setitem(agents.REGISTRY, "send-outbound-email", fake_send)
    monkeypatch.setattr(agents, "get_agent", lambda n: agents.REGISTRY[n])

    result = await dispatch_skill(
        {
            "skillId": "score-lead",
            "organizationId": "1000",
            "cdpId": "42",
            "source": "hub",
            "actionType": "send_email",
            "instruction": "Send a follow-up about the pending proposal.",
        },
        actor_id="hub:test",
    )
    assert calls == ["compose-email", "send-outbound-email"]
    assert result["agent"] == "crm-spoke-supervisor"
    assert result["result"]["sent"] is True


@pytest.mark.asyncio
async def test_planner_picks_agents_from_instruction(monkeypatch):
    async def fake_plan(**_kwargs: Any) -> list[str]:
        return ["score-lead", "nurture-lead"]

    async def fake_decide(**_k: Any) -> dict[str, Any]:
        return {"done": True}

    monkeypatch.setattr("app.a2a.orchestrate.plan_hub_agents", fake_plan)
    monkeypatch.setattr("app.a2a.orchestrate.hub_wants_send_email", lambda _p: False)
    monkeypatch.setattr("app.a2a.orchestrate.is_ai_configured", lambda: True)
    monkeypatch.setattr("app.a2a.orchestrate.decide_next_agent", fake_decide)

    calls: list[str] = []

    async def fake_score(**_k: Any) -> dict[str, Any]:
        calls.append("score-lead")
        return {"ok": True, "band": "warm", "total": 60}

    async def fake_nurture(**_k: Any) -> dict[str, Any]:
        calls.append("nurture-lead")
        return {"ok": True, "decision": "nurture_now"}

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.log_a2a", lambda **_k: None)
    import app.agents as agents

    monkeypatch.setitem(agents.REGISTRY, "score-lead", fake_score)
    monkeypatch.setitem(agents.REGISTRY, "nurture-lead", fake_nurture)
    monkeypatch.setattr(agents, "get_agent", lambda n: agents.REGISTRY[n])

    result = await dispatch_skill(
        {
            "organizationId": "1000",
            "cdpId": "42",
            "source": "hub",
            "instruction": "Score and nurture this lead.",
        },
        actor_id="hub:test",
    )
    assert calls == ["score-lead", "nurture-lead"]
    assert result["agent"] == "crm-spoke-supervisor"
    assert result["skillId"] == "hub-supervised"


def test_hub_wants_send_email_from_instruction_without_compose_skill():
    assert hub_wants_send_email(
        {
            "skillId": "score-lead",
            "actionType": "send_email",
            "instruction": "Send follow-up email",
        }
    )


@pytest.mark.asyncio
async def test_supervisor_stops_when_llm_says_done(monkeypatch):
    calls: list[str] = []

    async def fake_score(
        contact_id: str, organization_id: str | None = None, **_k: Any
    ) -> dict[str, Any]:
        calls.append("score-lead")
        return {"ok": True, "band": "cold", "total": 12}

    async def fake_decide(**_kwargs: Any) -> dict[str, Any]:
        return {"done": True, "reason": "score alone satisfies Hub goal"}

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _async_b2b)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.is_ai_configured", lambda: False)
    monkeypatch.setattr("app.a2a.orchestrate.decide_next_agent", fake_decide)
    import app.agents as agents

    monkeypatch.setitem(agents.REGISTRY, "score-lead", fake_score)
    monkeypatch.setattr(agents, "get_agent", lambda n: agents.REGISTRY[n])

    result = await dispatch_skill(
        {
            "skillId": "score-lead",
            "organizationId": "1000",
            "cdpId": "42",
            "source": "hub",
            "instruction": "Score this contact only.",
        },
        actor_id="hub:test",
    )
    assert calls == ["score-lead"]
    assert result["agent"] == "score-lead"
    assert result["result"].get("orchestrated") is not True
    assert result["result"]["band"] == "cold"