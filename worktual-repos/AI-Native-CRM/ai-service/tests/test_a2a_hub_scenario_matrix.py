"""Hub instruction scenario matrix — card skills + edge cases (agents mocked).

Hub only sends skills published on the agent card. These tests cover dispatch
routing, required-field gates, business-type blocks, and compose→send supervision
without calling live LLM/mail or mutating CRM UI flows.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.a2a.catalog import (
    EXCLUDE_COWORKER_SKILLS,
    EXCLUDE_NAMED_AGENTS,
    SpokeSkill,
    get_spoke_skill,
    hub_required_argument_keys,
    list_spoke_skills,
)
from app.a2a.dispatch import dispatch_skill
from app.a2a.errors import InputRequiredError, SpokeRejectError
from app.a2a.orchestrate import hub_wants_send_after_compose
from app.a2a.payload import normalize_payload


async def _b2b(_org: str, fallback: str | None = None) -> str:
    del fallback
    return "b2b"


async def _b2c(_org: str, fallback: str | None = None) -> str:
    del fallback
    return "b2c"


def _skills() -> list[SpokeSkill]:
    return list(list_spoke_skills())


def _patch_named_ok(monkeypatch: pytest.MonkeyPatch, *, label: str = "ok") -> list[str]:
    calls: list[str] = []

    async def fake_agent(**kwargs: Any) -> dict[str, Any]:
        calls.append(str(kwargs.get("instruction") or kwargs.get("contact_id") or label))
        return {"ok": True, "assistantText": f"mocked-{label}", "source": "mock"}

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2b)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.is_ai_configured", lambda: False)
    monkeypatch.setattr("app.a2a.dispatch.issue_hub_mcp_token", lambda **k: "mcp-token")

    async def fake_tool(name: str, arguments: dict[str, Any] | None = None, **kwargs: Any):
        calls.append(f"tool:{name}")
        return {
            "ok": True,
            "assistantText": "done",
            "data": {"id": "x1"},
        }

    monkeypatch.setattr("app.mcp.server.begin_agent_mcp_context", lambda **k: None)
    monkeypatch.setattr("app.mcp.server.end_agent_mcp_context", lambda: {})
    monkeypatch.setattr("app.mcp.server.call_coworker_tool", fake_tool)

    import app.agents as agents

    for name in list(agents.REGISTRY):
        monkeypatch.setitem(agents.REGISTRY, name, fake_agent)
    monkeypatch.setattr(agents, "get_agent", lambda name: agents.REGISTRY[name])
    return calls


# ── Card surface ────────────────────────────────────────────────────────────


def test_card_excludes_internal_and_read_skills():
    ids = {s.id for s in _skills()}
    for banned in (
        *EXCLUDE_NAMED_AGENTS,
        *EXCLUDE_COWORKER_SKILLS,
        "hello",
        "chat",
        "reports",
        "send-outbound-email",
    ):
        assert banned not in ids


def test_card_publishes_core_hub_skills():
    ids = {s.id for s in _skills()}
    for required in (
        "contact-crud",
        "company-crud",
        "deals",
        "activities",
        "score-lead",
        "enrich-lead",
        "nurture-lead",
        "compose-email",
        "auto-reply-email",
        "invoices",
    ):
        assert required in ids


@pytest.mark.parametrize("skill", _skills(), ids=lambda s: s.id)
def test_each_card_skill_has_stable_metadata(skill: SpokeSkill):
    assert skill.id
    assert skill.name
    assert skill.description
    assert skill.kind in {"coworker", "proactive", "meeting"}
    assert skill.agent_name
    assert skill.eligible_business_types
    assert "inspect" not in skill.description.lower()
    assert "named agent" not in skill.description.lower()
    assert skill.examples
    assert not skill.examples[0].lower().startswith("run ")
    keys = hub_required_argument_keys(skill)
    assert keys[0] == "organizationId"
    if skill.id != "company-crud" and skill.kind == "coworker":
        assert "cdpId" in keys
        assert "instruction" in keys


# ── Global edge cases ───────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_missing_organization_rejected():
    with pytest.raises(SpokeRejectError) as exc:
        await dispatch_skill(
            {"skillId": "score-lead", "cdpId": "42", "source": "hub"},
            actor_id="hub:test",
        )
    assert exc.value.code == "missing_org"


@pytest.mark.asyncio
async def test_unknown_skill_rejected(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2b)
    with pytest.raises(SpokeRejectError) as exc:
        await dispatch_skill(
            {"organizationId": "1000", "skillId": "not-on-card", "source": "hub"},
            actor_id="hub:test",
        )
    assert exc.value.code == "unknown_skill"


@pytest.mark.asyncio
async def test_internal_send_outbound_not_on_card(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2b)
    assert get_spoke_skill("send-outbound-email") is None
    with pytest.raises(SpokeRejectError) as exc:
        await dispatch_skill(
            {
                "organizationId": "1000",
                "skillId": "send-outbound-email",
                "cdpId": "42",
                "subject": "Hi",
                "body": "Body",
                "source": "hub",
            },
            actor_id="hub:test",
        )
    assert exc.value.code == "unknown_skill"


@pytest.mark.asyncio
async def test_missing_skill_id_rejected():
    with pytest.raises((SpokeRejectError, InputRequiredError)):
        await dispatch_skill(
            {"organizationId": "1000", "cdpId": "42", "source": "hub"},
            actor_id="hub:test",
        )


# ── Required fields (every skill that declares them) ────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "skill",
    [s for s in _skills() if s.required_fields],
    ids=lambda s: s.id,
)
async def test_each_required_field_missing_raises(
    skill: SpokeSkill,
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2b)
    for missing in skill.required_fields:
        payload: dict[str, Any] = {
            "organizationId": "1000",
            "skillId": skill.id,
            "source": "hub",
        }
        # Fill all required except the one under test
        for field in skill.required_fields:
            if field == missing:
                continue
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
                payload["transcript"] = "Hello transcript"
            elif field == "instruction":
                payload["instruction"] = "Draft an email"
            elif field == "body":
                payload["body"] = "privacy sample body"
            else:
                payload[field] = f"val-{field}"
        with pytest.raises(InputRequiredError) as exc:
            await dispatch_skill(payload, actor_id="hub:test")
        assert missing in exc.value.fields


# ── Business-type gates ─────────────────────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "skill_id",
    ["invoices", "quotes", "proposals", "deals", "invoice-escalation", "proposal-content"],
)
async def test_b2c_blocks_finance_and_b2b_sales_skills(
    skill_id: str,
    monkeypatch: pytest.MonkeyPatch,
):
    skill = get_spoke_skill(skill_id)
    if skill is None:
        pytest.skip(f"{skill_id} not on card")
    if "b2c" in skill.eligible_business_types:
        pytest.skip(f"{skill_id} allows b2c")
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2c)
    with pytest.raises(SpokeRejectError) as exc:
        await dispatch_skill(
            {
                "organizationId": "1000",
                "skillId": skill_id,
                "source": "hub",
                "cdpId": "42",
                "text": f"run {skill_id}",
                "dealId": "d1",
                "invoiceId": "i1",
            },
            actor_id="hub:test",
        )
    assert exc.value.code in {"b2c_finance", "skill_not_allowed", "b2c_blocked"}


@pytest.mark.asyncio
async def test_b2c_allows_contact_score(monkeypatch: pytest.MonkeyPatch):
    calls = _patch_named_ok(monkeypatch, label="score")
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2c)
    result = await dispatch_skill(
        {
            "organizationId": "1000",
            "skillId": "score-lead",
            "cdpId": "42",
            "source": "hub",
        },
        actor_id="hub:test",
    )
    assert result["status"] == "completed"
    assert result["agent"] == "score-lead"
    assert calls


# ── Payload / instruction shapes Hub actually sends ─────────────────────────


def test_nested_hub_instruction_flattens_action_and_cdp():
    payload = normalize_payload(
        {
            "organizationId": "1000",
            "skillId": "compose-email",
            "source": "hub",
            "cdpId": "42",
            "instruction": {
                "actionType": "send_email",
                "description": "CRM sends a follow-up email after dispatch.",
                "channel": "email",
            },
        }
    )
    assert payload.get("actionType") == "send_email"
    assert isinstance(payload.get("instruction"), str)
    assert "follow-up" in payload["instruction"].lower()
    skill = get_spoke_skill("compose-email")
    assert skill is not None
    assert hub_wants_send_after_compose(payload, skill)


def test_cdp_id_aliases_to_contact_id():
    payload = normalize_payload(
        {"organizationId": "1000", "skillId": "score-lead", "cdpId": "99"}
    )
    assert payload.get("contactId") == "99" or payload.get("contact_id") == "99"


# ── Compose email scenarios (card skill) ────────────────────────────────────


@pytest.mark.asyncio
async def test_compose_draft_only_does_not_send(monkeypatch: pytest.MonkeyPatch):
    calls: list[str] = []

    async def compose(**kwargs: Any) -> dict[str, Any]:
        calls.append("compose-email")
        return {
            "ok": True,
            "subject": "Draft only",
            "body": "Hello draft",
            "source": "ai",
        }

    async def send(**kwargs: Any) -> dict[str, Any]:
        calls.append("send-outbound-email")
        raise AssertionError("must not send")

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2b)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.is_ai_configured", lambda: False)
    import app.agents as agents

    monkeypatch.setitem(agents.REGISTRY, "compose-email", compose)
    monkeypatch.setitem(agents.REGISTRY, "send-outbound-email", send)
    monkeypatch.setattr(agents, "get_agent", lambda n: agents.REGISTRY[n])

    result = await dispatch_skill(
        {
            "organizationId": "1000",
            "skillId": "compose-email",
            "cdpId": "42",
            "source": "hub",
            "instruction": "Draft a short intro email about our products",
        },
        actor_id="hub:test",
    )
    assert calls == ["compose-email"]
    assert result["agent"] == "compose-email"
    assert result["result"]["subject"] == "Draft only"


@pytest.mark.asyncio
async def test_compose_send_email_supervises(monkeypatch: pytest.MonkeyPatch):
    calls: list[str] = []

    async def compose(**kwargs: Any) -> dict[str, Any]:
        calls.append("compose-email")
        return {
            "ok": True,
            "subject": "Proposal follow-up",
            "body": "Please share a status update.",
            "source": "ai",
        }

    async def send(
        contact_id: str,
        subject: str,
        body: str,
        organization_id: str | None = None,
        reason: str | None = None,
    ) -> dict[str, Any]:
        calls.append("send-outbound-email")
        assert contact_id == "42"
        return {
            "ok": True,
            "status": "sent",
            "to": "a@b.com",
            "activityId": "act-1",
        }

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2b)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.log_a2a", lambda **_k: None)
    import app.agents as agents

    monkeypatch.setitem(agents.REGISTRY, "compose-email", compose)
    monkeypatch.setitem(agents.REGISTRY, "send-outbound-email", send)
    monkeypatch.setattr(agents, "get_agent", lambda n: agents.REGISTRY[n])

    result = await dispatch_skill(
        {
            "organizationId": "1000",
            "skillId": "compose-email",
            "cdpId": "42",
            "source": "hub",
            "actionType": "send_email",
            "instruction": "Send a follow-up on the pending proposal.",
        },
        actor_id="hub:test",
    )
    assert calls == ["compose-email", "send-outbound-email"]
    assert result["agent"] == "crm-spoke-supervisor"
    assert result["result"]["sent"] is True


@pytest.mark.asyncio
async def test_compose_send_without_contact_input_required(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2b)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    with pytest.raises(InputRequiredError) as exc:
        await dispatch_skill(
            {
                "organizationId": "1000",
                "skillId": "compose-email",
                "source": "hub",
                "actionType": "send_email",
                "instruction": "Send follow-up email now",
            },
            actor_id="hub:test",
        )
    assert "contactId" in exc.value.fields


@pytest.mark.asyncio
async def test_compose_send_stops_if_compose_empty(monkeypatch: pytest.MonkeyPatch):
    calls: list[str] = []

    async def compose(**kwargs: Any) -> dict[str, Any]:
        calls.append("compose-email")
        return {"ok": True, "subject": "", "body": "", "source": "ai"}

    async def send(**kwargs: Any) -> dict[str, Any]:
        calls.append("send-outbound-email")
        return {"ok": True, "status": "sent"}

    monkeypatch.setattr("app.a2a.dispatch.resolve_business_type", _b2b)
    monkeypatch.setattr("app.a2a.dispatch.log_a2a", lambda **_k: None)
    monkeypatch.setattr("app.a2a.orchestrate.log_a2a", lambda **_k: None)
    import app.agents as agents

    monkeypatch.setitem(agents.REGISTRY, "compose-email", compose)
    monkeypatch.setitem(agents.REGISTRY, "send-outbound-email", send)
    monkeypatch.setattr(agents, "get_agent", lambda n: agents.REGISTRY[n])

    result = await dispatch_skill(
        {
            "organizationId": "1000",
            "skillId": "compose-email",
            "cdpId": "42",
            "actionType": "send_email",
            "instruction": "Send email",
            "source": "hub",
        },
        actor_id="hub:test",
    )
    assert calls == ["compose-email"]
    assert result["status"] == "failed"
    assert result["result"]["sent"] is False


# ── Coworker skills (card) ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_activities_notify_direct_create(monkeypatch: pytest.MonkeyPatch):
    calls = _patch_named_ok(monkeypatch)
    result = await dispatch_skill(
        {
            "organizationId": "1000",
            "skillId": "activities",
            "source": "hub",
            "cdpId": "42",
            "actionType": "notify",
            "description": "Lead score increased from 41 to 82.",
            "instruction": "Lead score increased from 41 to 82.",
        },
        actor_id="hub:test",
    )
    assert result["status"] == "completed"
    assert any(c.startswith("tool:propose_create_activity") for c in calls)


@pytest.mark.asyncio
async def test_activities_open_task(monkeypatch: pytest.MonkeyPatch):
    calls = _patch_named_ok(monkeypatch)
    result = await dispatch_skill(
        {
            "organizationId": "1000",
            "skillId": "activities",
            "source": "hub",
            "cdpId": "42",
            "actionType": "open_task",
            "description": "Follow up on stale opportunity.",
        },
        actor_id="hub:test",
    )
    assert result["status"] == "completed"
    assert any(c.startswith("tool:") for c in calls)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "skill_id,text",
    [
        ("contact-crud", "Update this contact phone number"),
        ("company-crud", "Update company industry"),
        ("deals", "Create a deal for this contact"),
        ("meetings", "Schedule a follow-up meeting"),
    ],
)
async def test_coworker_skills_dispatch(
    skill_id: str,
    text: str,
    monkeypatch: pytest.MonkeyPatch,
):
    _patch_named_ok(monkeypatch)
    result = await dispatch_skill(
        {
            "organizationId": "1000",
            "skillId": skill_id,
            "source": "hub",
            "cdpId": "42",
            "text": text,
        },
        actor_id="hub:test",
    )
    assert result["status"] == "completed"
    assert result["skillId"] == skill_id
    assert result["agent"] == "crm-agent"


# ── Named proactive / meeting skills (card) ─────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "skill_id,extra",
    [
        ("score-lead", {"cdpId": "42"}),
        ("enrich-lead", {"cdpId": "42"}),
        ("summarize-lead", {"cdpId": "42"}),
        ("nurture-lead", {"cdpId": "42"}),
        ("lifecycle-lead", {"cdpId": "42"}),
        ("assign-sales", {"cdpId": "42"}),
        ("welcome-lead", {"cdpId": "42"}),
        ("owner-change-notify", {"cdpId": "42"}),
        ("audit-forecast", {"dealId": "deal-1"}),
        ("compliance-privacy", {"body": "Please delete my data"}),
        ("invoice-escalation", {"invoiceId": "inv-1"}),
        ("expansion-matcher", {"companyId": "co-1"}),
        ("auto-reply-email", {"activityId": "act-1"}),
        ("meeting-brief-email", {"activityId": "act-1"}),
        (
            "analyze-transcript",
            {"transcript": "Rep: Hi. Buyer: We need pricing."},
        ),
        ("meeting-mom", {"transcript": "Discussed timeline and next steps."}),
        ("sales-coach", {"transcript": "Rep pushed too hard on discount."}),
        (
            "post-meeting-process",
            {"transcript": "Agreed to send a proposal this week."},
        ),
        ("meeting-miss-escalation", {}),
        ("proposal-content", {"dealId": "deal-1"}),
        ("document-clone-personalize", {}),
    ],
)
async def test_named_card_skills_complete(
    skill_id: str,
    extra: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
):
    if get_spoke_skill(skill_id) is None:
        pytest.skip(f"{skill_id} not published")
    _patch_named_ok(monkeypatch, label=skill_id)
    result = await dispatch_skill(
        {
            "organizationId": "1000",
            "skillId": skill_id,
            "source": "hub",
            **extra,
        },
        actor_id="hub:test",
    )
    assert result["status"] == "completed"
    assert result["skillId"] == skill_id


@pytest.mark.asyncio
async def test_score_lead_wrong_id_shape_still_dispatches(monkeypatch: pytest.MonkeyPatch):
    """Hub may send UUID-like cdpId; spoke still routes (agent may fail later)."""
    _patch_named_ok(monkeypatch)
    result = await dispatch_skill(
        {
            "organizationId": "1000",
            "skillId": "score-lead",
            "cdpId": "01e01e89-0000-0000-0000-000000000042",
            "source": "hub",
        },
        actor_id="hub:test",
    )
    assert result["status"] == "completed"
    assert result["agent"] == "score-lead"
