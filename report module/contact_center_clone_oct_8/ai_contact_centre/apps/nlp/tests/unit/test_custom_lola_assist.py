from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.agents.custom_lola_assist import actions, assist, context_snapshot, tools
from app.agents.custom_lola_assist.actions import (
    cancel_lola_appointment,
    create_lola_ticket,
)
from app.agents.custom_lola_assist.context_snapshot import load_lola_customer_context
from app.agents.custom_lola_assist.tools import build_lola_assist_tools
from app.api.copilot import _booxoo_workspace_coworker, _lola_workspace_coworker
from app.config import get_settings
from app.runtime.context import RunContext


def _ctx(*, authenticated: bool = False, email: str = "ada@example.com"):
    session = SimpleNamespace(
        authenticated=authenticated,
        customer_found=True,
        contact={"name": "Ada", "email": email, "phone": "919876543210"},
        last_ticket=None,
    )
    request = SimpleNamespace(
        organization_id="1003",
        conversation_id="77",
        channel="webchat",
    )
    return SimpleNamespace(session=session, request=request)


def _tool_names(audience: str) -> set[str]:
    return {
        tool.tool_schema["function"]["name"]
        for tool in build_lola_assist_tools(audience)
    }


def test_customer_reply_contract_requires_direct_agent_voice() -> None:
    contract = f"{assist._prompt()}\n{assist._audience_note('customer')}".lower()

    assert assist.PROMPT_VERSION == "v3"
    assert "exact message the human agent can send" in contract
    assert "never say that you drafted" in contract
    assert "do not preface it" in contract
    assert "mention ai assistance or a knowledge base" in contract


def test_customer_tools_are_non_mutating_and_agent_tools_include_actions() -> None:
    customer = _tool_names("customer")
    agent = _tool_names("agent")

    assert "create_lola_ticket" not in customer
    assert "cancel_lola_appointment" not in customer
    assert "send_worktual_otp" not in customer
    assert "verify_worktual_otp" not in customer
    assert {"create_lola_ticket", "cancel_lola_appointment"} <= agent


def test_unverified_actions_do_not_call_remote_services(monkeypatch) -> None:
    def forbidden(*_args, **_kwargs):
        raise AssertionError("remote service must not be called")

    monkeypatch.setattr(actions.TicketingClient, "create_ticket", forbidden)
    monkeypatch.setattr(actions, "lookup_customer", forbidden)

    ticket = create_lola_ticket(_ctx(), issue="Login is failing")
    cancellation = cancel_lola_appointment(_ctx())

    assert ticket["ok"] is False
    assert ticket["error"] == "customer_not_verified"
    assert cancellation["ok"] is False
    assert cancellation["error"] == "customer_not_verified"


def test_verified_coworker_creates_ticket(monkeypatch) -> None:
    def fake_create(_self, **kwargs):
        assert kwargs["idempotency_key"].startswith("lola-assist:77:")
        assert kwargs["metadata"]["organizationId"] == "1003"
        return 201, {"ticket": {"ticketNumber": "WT-42", "status": "Open"}}

    monkeypatch.setattr(actions.TicketingClient, "create_ticket", fake_create)

    result = create_lola_ticket(_ctx(authenticated=True), issue="Login is failing")

    assert result == {
        "ok": True,
        "created": True,
        "ticketNumber": "WT-42",
        "status": "Open",
    }


def test_duplicate_ticket_is_reported_as_existing(monkeypatch) -> None:
    monkeypatch.setattr(
        actions.TicketingClient,
        "create_ticket",
        lambda *_args, **_kwargs: (409, {"ticketNumber": "WT-42", "status": "Open"}),
    )

    result = create_lola_ticket(_ctx(authenticated=True), issue="Login is failing")

    assert result["ok"] is True
    assert result["created"] is False
    assert result["existing"] is True


def test_verified_coworker_cancels_only_live_appointment(monkeypatch) -> None:
    monkeypatch.setattr(
        actions,
        "lookup_customer",
        lambda organization_id, email, phone: {
            "found": organization_id == "1003" and email == "ada@example.com" and not phone,
            "cdp_id": "cdp-42",
        },
    )
    monkeypatch.setattr(
        actions,
        "_live_appointment",
        lambda contact_id: {
            "id": "appointment-9",
            "startsAt": "2099-10-10T10:00:00Z",
        }
        if contact_id == "cdp-42"
        else None,
    )
    response = SimpleNamespace(status_code=200, content=b"{}", json=lambda: {})
    monkeypatch.setattr(
        actions,
        "cancel_crm_appointment",
        lambda appointment_id: response
        if appointment_id == "appointment-9"
        else (_ for _ in ()).throw(AssertionError("wrong appointment")),
    )

    result = cancel_lola_appointment(_ctx(authenticated=True))

    assert result["ok"] is True
    assert result["appointmentId"] == "appointment-9"


def test_unknown_customer_does_not_call_cancel(monkeypatch) -> None:
    monkeypatch.setattr(
        actions,
        "lookup_customer",
        lambda *_args, **_kwargs: {"found": False},
    )
    monkeypatch.setattr(
        actions,
        "cancel_crm_appointment",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("cancel must not run")
        ),
    )

    result = cancel_lola_appointment(_ctx(authenticated=True))

    assert result["ok"] is False
    assert result["error"] == "customer_not_found"


def test_no_live_appointment_does_not_call_cancel(monkeypatch) -> None:
    monkeypatch.setattr(
        actions,
        "lookup_customer",
        lambda *_args, **_kwargs: {"found": True, "cdp_id": "cdp-42"},
    )
    monkeypatch.setattr(actions, "_live_appointment", lambda _contact_id: None)
    monkeypatch.setattr(
        actions,
        "cancel_crm_appointment",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("cancel must not run")
        ),
    )

    result = cancel_lola_appointment(_ctx(authenticated=True))

    assert result["ok"] is False
    assert result["error"] == "appointment_not_found"


def test_empty_knowledge_is_not_reported_as_grounded(monkeypatch) -> None:
    monkeypatch.setattr(
        tools,
        "get_sales_knowledge",
        lambda *_args, **_kwargs: {
            "status": "success",
            "context": "",
            "message": "No detail was found.",
        },
    )

    result = tools.search_worktual_sales_knowledge(_ctx(), "invent a product")

    assert result["ok"] is False
    assert result["context"] == ""


def test_snapshot_contains_owned_context_and_live_appointment(monkeypatch) -> None:
    monkeypatch.setattr(context_snapshot, "store_configured", lambda: True)
    monkeypatch.setattr(
        context_snapshot,
        "_load_snapshot",
        lambda *_args, **_kwargs: {
            "found": True,
            "cdp_id": "cdp-42",
            "profile": {"name": "Ada", "summary": "Asked about AI Contact Center."},
            "emails": ["ada@example.com"],
            "phones": ["919876543210"],
            "tickets": [
                {
                    "number": "WT-42",
                    "status": "Open",
                    "subject": "Login",
                    "updated": "2026-10-05",
                }
            ],
            "pages": [{"title": "AI CRM", "path": "/crm", "viewed_at": "2026-10-05"}],
            "recommendation": {"recommendation": "Offer a demo"},
            "sentiment": {"label": "negative", "rationale": "Customer was frustrated"},
            "appointment": None,
        },
    )
    monkeypatch.setattr(
        context_snapshot,
        "_load_appointment",
        lambda cdp_id: {
            "id": "appointment-9",
            "status": "scheduled",
            "startsAt": "2099-10-10T10:00:00Z",
            "joinUrl": "https://meet.example/9",
        }
        if cdp_id == "cdp-42"
        else None,
    )

    loaded = load_lola_customer_context(
        "1003",
        cdp_id="cdp-42",
        conversation_id="77",
        context_payload={
            "messages": [{"role": "customer", "body": "I cannot log in"}],
            "crossChannelSummary": [
                {
                    "conversationId": "55",
                    "channel": "email",
                    "summary": "Asked about login",
                    "occurredAt": "2026-10-04",
                }
            ],
        },
    )

    assert loaded.found is True
    assert "WT-42" in loaded.block
    assert "appointment-9" in loaded.block
    assert "https://meet.example/9" in loaded.block
    assert "Customer was frustrated" in loaded.block
    assert "Asked about login" in loaded.block


def test_lola_copilot_gate_is_inbox_only(monkeypatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "custom_lola_assist_org_ids", "1003")
    monkeypatch.setattr(settings, "custom_booxoo_bot_org_ids", "1012")

    lola = RunContext(
        tenant_id="1003",
        role="agent",
        surface="inbox",
        path="/agent/workspace",
        conversation_id="77",
    )
    reports = RunContext(
        tenant_id="1003",
        role="agent",
        surface="reports",
        path="/reports",
        conversation_id="77",
    )
    booxoo = RunContext(
        tenant_id="1012",
        role="agent",
        surface="inbox",
        path="/agent/workspace",
        conversation_id="88",
    )

    assert _lola_workspace_coworker(lola) is True
    assert _lola_workspace_coworker(reports) is False
    assert _booxoo_workspace_coworker(booxoo) is True
    assert _booxoo_workspace_coworker(lola) is False


def test_channel_verification_requires_the_loaded_identity() -> None:
    session = SimpleNamespace(
        stored_emails=("ada@example.com",),
        stored_phones=("+91 98765 43210",),
    )

    assert (
        assist._channel_identity_verified(
            session,
            "email",
            {"customer": {"visitorId": "ada@example.com"}},
        )
        is True
    )
    assert (
        assist._channel_identity_verified(
            session,
            "email",
            {"customer": {"visitorId": "other@example.com"}},
        )
        is False
    )
    assert (
        assist._channel_identity_verified(
            session,
            "call",
            {"customer": {"visitorId": "919876543210"}},
        )
        is True
    )
    assert (
        assist._channel_identity_verified(
            session,
            "call",
            {"customer": {"visitorId": "911111111111"}},
        )
        is False
    )


@pytest.mark.asyncio
async def test_audiences_emit_customer_state_and_agent_prose(monkeypatch) -> None:
    async def fake_context(_context):
        return {
            "conversation": {"channel": "email", "visitorId": "ada@example.com"},
            "customer": {
                "visitorId": "ada@example.com",
                "contact": {
                    "id": "cdp-42",
                    "firstName": "Ada",
                    "primaryEmail": "ada@example.com",
                },
            },
            "messages": [],
        }

    monkeypatch.setattr(assist, "_load_context", fake_context)
    monkeypatch.setattr(assist, "_ensure_context_block", lambda *_args: "Customer profile:\n- Name: Ada")
    monkeypatch.setattr(
        assist,
        "_run_turn",
        lambda _session, _request, _query, _block, audience: (
            "The appointment has been cancelled."
            if audience == "agent"
            else '{"replyDraft":"I can help with that.","privateNotes":[],"actionProposal":null}'
        ),
    )
    context = RunContext(
        tenant_id="1003",
        role="agent",
        surface="inbox",
        path="/agent/workspace",
        conversation_id="77",
    )

    customer_events = [
        event
        async for event in assist.stream_lola_assist(
            [{"role": "user", "content": "Draft a reply"}],
            context,
            audience="customer",
        )
    ]
    agent_events = [
        event
        async for event in assist.stream_lola_assist(
            [{"role": "user", "content": "Cancel the appointment"}],
            context,
            audience="agent",
        )
    ]

    assert any("I can help with that." in event for event in customer_events)
    assert any("assist_state" in event for event in customer_events)
    assert any("The appointment has been cancelled." in event for event in agent_events)
    assert not any("assist_state" in event for event in agent_events)

    monkeypatch.setattr(assist, "_run_turn", lambda *_args: "")
    fallback_events = [
        event
        async for event in assist.stream_lola_assist(
            [{"role": "user", "content": "Help me"}],
            context,
            audience="customer",
        )
    ]
    assert any(
        "Could you share the email address or phone number you use with Worktual" in event
        for event in fallback_events
    )
    assert not any("Please ask the customer" in event for event in fallback_events)
