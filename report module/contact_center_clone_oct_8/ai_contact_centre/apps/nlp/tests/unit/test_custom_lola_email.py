"""Lola email bot: sender verification, tool scope, and first-reply greeting."""

from app.agents.custom_lola_worktual.email_prompts import (
    EMAIL_AGENT_TOOLS,
    EMAIL_FORBIDDEN_TOOLS,
    EMAIL_RULES,
)
from app.agents.custom_lola_worktual.runner import (
    email_router_key,
    merge_email_sender_profile,
    session_manager,
    setup_email_router,
    setup_router,
)
from app.agents.custom_lola_worktual.session import set_turn_context
from app.agents.custom_lola_worktual.session_card import (
    clear_chat_state,
    get_chat_state,
    lola_session_note,
    mark_email_sender_verified,
)
from app.agents.custom_lola_worktual.tools import CREATE_TICKET, create_ticket


def _reset(conversation_id: str) -> None:
    clear_chat_state(conversation_id)
    session_manager.routers.pop(email_router_key(conversation_id), None)
    session_manager.routers.pop(conversation_id, None)


def _tool_names(agent) -> set[str]:
    return set(agent.tools_mapping)


def test_email_prompts_carry_the_first_reply_greeting() -> None:
    text = EMAIL_RULES.lower()
    assert "first assistant reply" in text
    assert "local time of day" in text
    assert "previous session mood" in text
    assert "cannot be done by email" in text
    assert "offer to raise a ticket" in text
    assert "one request is enough" in text
    assert "do not greet again" in text


def test_email_tool_list_allows_knowledge_tickets_booking_and_handoff() -> None:
    names = {tool for tools in EMAIL_AGENT_TOOLS.values() for tool in tools}
    assert "GET_SALES_KNOWLEDGE" in names
    assert "CREATE_TICKET" in names
    assert "GET_SERVICE_KNOWLEDGE" not in names
    assert "BOOK_APPOINTMENT" in names
    assert "RESCHEDULE_APPOINTMENT" in names
    assert "LIVE_AGENT" in names
    assert names.isdisjoint(EMAIL_FORBIDDEN_TOOLS)


def test_email_router_excludes_cancel_and_otp_and_greets_once() -> None:
    conversation_id = "lola-email-scope"
    _reset(conversation_id)
    mark_email_sender_verified("1003", conversation_id, "ada@example.com", "Ada Lovelace")
    summary = (
        "Latest previous interaction [email]: billing question\n"
        "Previous session mood: frustrated."
    )
    router, _formatted = setup_email_router(
        conversation_id=conversation_id,
        organization_id="1003",
        tenant_context={
            "contact_profile": {
                "firstName": "Ada",
                "lastName": "Lovelace",
                "primaryEmail": "ada@example.com",
            },
            "_lola_long_term_summary": summary,
        },
    )

    sales = _tool_names(router.agents["SalesAgent"])
    booking = _tool_names(router.agents["BookingAgent"])
    service = _tool_names(router.agents["ServiceAgent"])
    assert {"GET_SALES_KNOWLEDGE", "LIVE_AGENT"} <= sales
    assert {"BOOK_APPOINTMENT", "RESCHEDULE_APPOINTMENT", "LIVE_AGENT"} <= booking
    assert {"CREATE_TICKET", "GET_TICKET_STATUS", "LIVE_AGENT"} <= service
    assert "GET_SERVICE_KNOWLEDGE" not in service
    for names in (sales, booking, service):
        assert names.isdisjoint(EMAIL_FORBIDDEN_TOOLS)

    ticket_tool = router.agents["ServiceAgent"].tools_mapping["CREATE_TICKET"]
    assert "already verified" in ticket_tool.tool_schema["function"]["description"]
    assert "after one OTP" in CREATE_TICKET["function"]["description"]

    prompt = router.agents["SalesAgent"].system[0]["content"]
    assert "Latest previous interaction" in prompt
    assert "Previous session mood: frustrated" in prompt
    assert "Greet Ada Lovelace once using the local time of day" in prompt
    assert "cannot be done by email" in prompt

    state = get_chat_state(conversation_id)
    state.assistant_replied = True
    state.recognized_greeting = True
    router, _formatted = setup_email_router(
        conversation_id=conversation_id,
        organization_id="1003",
        tenant_context={
            "contact_profile": {
                "firstName": "Ada",
                "lastName": "Lovelace",
                "primaryEmail": "ada@example.com",
            },
            "_lola_long_term_summary": summary,
        },
    )
    later = router.agents["SalesAgent"].system[0]["content"]
    assert "Do not greet again." in later
    assert "Greet Ada Lovelace once" not in later
    _reset(conversation_id)


def test_chat_router_still_includes_otp_tools() -> None:
    conversation_id = "lola-chat-scope"
    _reset(conversation_id)
    router, _formatted = setup_router(
        conversation_id=conversation_id,
        organization_id="1003",
        tenant_context={"contact_profile": {}},
        channel="webchat",
    )
    service = _tool_names(router.agents["ServiceAgent"])
    assert {"SEND_OTP", "VERIFY_OTP", "CREATE_TICKET", "CALL_BACK"} <= service
    assert "GET_SERVICE_KNOWLEDGE" not in service
    assert "CANCEL_APPOINTMENT" not in _tool_names(router.agents["BookingAgent"])
    _reset(conversation_id)


def test_sender_address_verifies_the_email_session() -> None:
    conversation_id = "lola-email-sender"
    _reset(conversation_id)
    state = mark_email_sender_verified("1003", conversation_id, "ada@example.com", "Ada Lovelace")
    assert state.authenticated is True
    assert state.otp_channel == "email"
    assert state.otp_destination == "ada@example.com"
    assert state.contact["email"] == "ada@example.com"
    assert state.contact["name"] == "Ada Lovelace"
    assert state.otp_code == ""
    note = lola_session_note(conversation_id, "Ada Lovelace")
    assert "verified once by email to ada@example.com" in note
    assert "Do not ask for another code." in note
    _reset(conversation_id)


def test_merge_email_sender_profile_uses_from_header_when_profile_is_empty() -> None:
    merged = merge_email_sender_profile(
        {},
        {"sender_email": "ada@example.com", "sender_name": "Ada Lovelace"},
    )
    assert merged["primaryEmail"] == "ada@example.com"
    assert merged["firstName"] == "Ada"
    assert merged["lastName"] == "Lovelace"

    kept = merge_email_sender_profile(
        {"primaryEmail": "known@example.com", "firstName": "Known"},
        {"sender_email": "ada@example.com", "sender_name": "Ada Lovelace"},
    )
    assert kept["primaryEmail"] == "known@example.com"
    assert kept["firstName"] == "Known"
    assert "lastName" not in kept


def test_verified_sender_creates_ticket_without_otp(monkeypatch) -> None:
    conversation_id = "lola-email-ticket"
    _reset(conversation_id)
    mark_email_sender_verified("1003", conversation_id, "ada@example.com", "Ada Lovelace")
    set_turn_context(
        conversation_id,
        {
            "organization_id": "1003",
            "conversation_id": conversation_id,
            "channel": "email",
        },
    )
    captured: dict = {}

    class FakeTicketingClient:
        def create_ticket(self, **kwargs):
            captured.update(kwargs)
            return 201, {"ticketNumber": "T-100"}

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.clients.ticketing.TicketingClient",
        FakeTicketingClient,
    )
    result = create_ticket("Cannot sign in", session_id=conversation_id)
    assert captured["email"] == "ada@example.com"
    assert captured["channel"] == "email"
    assert result["data"]["ticketNumber"] == "T-100"
    assert "verify" not in result["message"].lower()
    _reset(conversation_id)


def test_unverified_session_does_not_create_a_ticket(monkeypatch) -> None:
    conversation_id = "lola-email-unverified"
    _reset(conversation_id)

    class FakeTicketingClient:
        def create_ticket(self, **kwargs):
            raise AssertionError("ticket client should not be called")

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.clients.ticketing.TicketingClient",
        FakeTicketingClient,
    )
    result = create_ticket("Cannot sign in", session_id=conversation_id)
    assert "verify your contact" in result["message"]
    _reset(conversation_id)
