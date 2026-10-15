"""Focused contract tests for the custom Booxoo ticket flow."""

from datetime import datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

from app.agents.custom_booxoo_bot.agent import (
    automatic_contact_enrichment_payload,
    build_booxoo_trusted_context,
)
from app.agents.custom_booxoo_bot.clients.cdp_store import _with_items
from app.agents.custom_booxoo_bot.clients.email_otp import send_otp_email
from app.agents.custom_booxoo_bot.runner import run_booxoo_turn, uk_time_line
from app.agents.custom_booxoo_bot.clients.sms import normalize_sms_destination
from app.agents.custom_booxoo_bot.memory import Session
from app.agents.custom_booxoo_bot.tools.contact_enrich import contact_enrich
from app.agents.custom_booxoo_bot.clients.ticketing import TicketingClient
from app.agents.custom_booxoo_bot.tools.identity import send_otp, verify_otp
from app.agents.custom_booxoo_bot.tools.orders import lookup_customer_details
from app.agents.custom_booxoo_bot.tools.ticketing import create_support_ticket
from app.schemas.bot import ContactEntities
from app.services.contact_enrich_policy import ContactProfileSnapshot


def _ctx() -> SimpleNamespace:
    return SimpleNamespace(
        session=Session(),
        request=SimpleNamespace(
            organization_id="1012",
            conversation_id="144280",
            session_id="144280",
            visitor_id="visitor-1",
            channel="webchat",
        ),
    )


def test_contact_change_requires_matching_pending_confirmation(monkeypatch) -> None:
    ctx = _ctx()
    ctx.session.contact = {"email": "old@example.com"}
    responses = [
        {
            "result": {
                "outcome": "confirmation_required",
                "canonicalContactId": "CDP-old",
                "appliedFields": [],
                "requiresConfirmation": ["email"],
                "contact": {"primaryEmail": "old@example.com"},
            }
        },
        {
            "result": {
                "outcome": "updated",
                "canonicalContactId": "CDP-old",
                "appliedFields": ["email"],
                "requiresConfirmation": [],
                "contact": {"primaryEmail": "new@example.com"},
            }
        },
    ]

    class Response:
        content = b"{}"

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return responses.pop(0)

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.contact_enrich.httpx.post",
        lambda *args, **kwargs: Response(),
    )

    first = contact_enrich(ctx, email="new@example.com")
    assert first["requiresConfirmation"] == ["email"]
    assert ctx.session.pending_contact_fields == {"email": "new@example.com"}
    assert ctx.session.contact["email"] == "old@example.com"

    mismatch = contact_enrich(
        ctx,
        email="other@example.com",
        confirmedFields=["email"],
    )
    assert mismatch["error"] == "confirmation_mismatch"

    confirmed = contact_enrich(
        ctx,
        email="new@example.com",
        confirmedFields=["email"],
    )
    assert confirmed["appliedFields"] == ["email"]
    assert ctx.session.contact["email"] == "new@example.com"
    assert ctx.session.pending_contact_fields == {}


@pytest.mark.asyncio
async def test_booxoo_uses_default_contact_extraction_policy(monkeypatch) -> None:
    async def fake_extract(*_args, **_kwargs):
        return ContactEntities(first_name="Lee", phone="447700900123")

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.agent.extract_contact_entities_llm",
        fake_extract,
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.agent.get_llm_client",
        lambda: object(),
    )

    payload = await automatic_contact_enrichment_payload(
        message="I'm Lee and my mobile is 447700900123",
        transcript=[],
        channel="webchat",
        profile=ContactProfileSnapshot(contact_id="CDP-1"),
    )

    assert payload == {"phone": "447700900123", "firstName": "Lee"}


@pytest.mark.asyncio
async def test_booxoo_trusted_context_matches_default_bot_context(monkeypatch) -> None:
    async def fake_omni(*_args, **_kwargs):
        return {
            "omni_channel_summary": "Customer previously asked about delivery.",
            "channel_items": [{"channel": "email", "summary": "Order query resolved."}],
        }

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.agent.fetch_contact_omnichannel_memory",
        fake_omni,
    )

    context = await build_booxoo_trusted_context(
        organization_id="1012",
        profile=ContactProfileSnapshot(
            contact_id="CDP-1",
            first_name="Lee",
            primary_email="lee@example.com",
        ),
        tenant_context={
            "rolling_summary": "Customer prefers email.",
            "extracted_facts": ["contact.city=London"],
        },
    )

    assert "AUTHORITATIVE CONTACT PROFILE" in context
    assert "firstName: Lee" in context
    assert "Omni-channel summary: Customer previously asked about delivery." in context
    assert "[email] Order query resolved." in context
    assert "Long-term conversation summary: Customer prefers email." in context
    assert "Known facts: contact.city=London" in context


def test_booxoo_applies_automatic_contact_enrichment_before_reply(monkeypatch) -> None:
    seen: dict = {}

    class Router:
        current_agent = SimpleNamespace(name="DiscoveryAgent")

        def refresh_prompts(self, _channel: str) -> None:
            return None

        def execute(self, _message: str, ctx) -> dict:
            seen["enrichment"] = ctx.contact_enrichment_result
            return {"response_type": "general_response", "text": "Done"}

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.runner.build_router",
        lambda session, _llm: setattr(session, "router", Router()),
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.runner.load_customer_profile",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.runner.contact_enrich",
        lambda _ctx, **kwargs: {
            "ok": True,
            "outcome": "updated",
            "appliedFields": list(kwargs),
            "requiresConfirmation": [],
        },
    )

    result = run_booxoo_turn(
        organization_id="1012",
        conversation_id="auto-enrich-test",
        message="I'm Lee",
        channel="webchat",
        tenant_context={"visitor_id": "visitor-auto-enrich"},
        profile=ContactProfileSnapshot(),
        auto_contact_payload={"firstName": "Lee"},
    )

    assert seen["enrichment"]["appliedFields"] == ["firstName"]
    assert result["reply"] == "Done"


def test_send_otp_does_not_wait_for_a_second_verify_flag(monkeypatch) -> None:
    ctx = _ctx()
    ctx.session.customer_found = True
    ctx.session.ticketing_verified = False
    ctx.session.contact = {"email": "saved@example.com"}
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.session_card.save_chat_card",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.identity.send_otp_email",
        lambda *args, **kwargs: {"ok": True, "destination": "saved@example.com", "http_status": 200},
    )

    result = send_otp(ctx, channel="email")

    assert result["sent"] is True
    assert result.get("error") is None


def test_webchat_lookup_marks_the_customer_ready_for_otp(monkeypatch) -> None:
    ctx = _ctx()
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.orders.lookup_customer",
        lambda *_args, **_kwargs: {
            "found": True,
            "cdp_id": "CDP-1",
            "customer": {"name": "Lee", "email": "saved@example.com"},
        },
    )

    result = lookup_customer_details(ctx, email="saved@example.com")

    assert result["found"] is True
    assert ctx.session.ticketing_verified is True


def test_email_lookup_does_not_skip_ticketing_verify(monkeypatch) -> None:
    ctx = _ctx()
    ctx.request.channel = "email"
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.orders.lookup_customer",
        lambda *_args, **_kwargs: {
            "found": True,
            "cdp_id": "CDP-1",
            "customer": {"name": "Lee", "email": "saved@example.com"},
        },
    )

    lookup_customer_details(ctx, email="saved@example.com")

    assert ctx.session.customer_found is True
    assert ctx.session.ticketing_verified is False


def test_chat_support_tools_omit_ticketing_verify() -> None:
    from app.agents.custom_booxoo_bot.tools.registry import build_email_tools, build_tools

    def names(tools) -> set[str]:
        return {tool.tool_schema["function"]["name"] for tool in tools}

    assert "verify_ticketing_customer" not in names(build_tools("support"))
    assert "verify_ticketing_customer" in names(build_email_tools("support"))


def test_send_otp_rejects_an_unsaved_destination(monkeypatch) -> None:
    ctx = _ctx()
    ctx.session.customer_found = True
    ctx.session.ticketing_verified = True
    ctx.session.contact = {"email": "saved@example.com"}
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.identity.send_otp_email",
        lambda *args, **kwargs: {"ok": True},
    )

    result = send_otp(ctx, email="other@example.com", channel="email")

    assert result == {
        "ok": False,
        "sent": False,
        "error": "destination_mismatch",
        "channel": "email",
    }
    assert ctx.session.otp_code is None


def test_email_otp_uses_booxoo_smtp_settings(monkeypatch) -> None:
    seen: dict = {}

    class SMTP:
        def __init__(self, host: str, port: int, timeout: int) -> None:
            seen.update(host=host, port=port, timeout=timeout)

        def __enter__(self):
            return self

        def __exit__(self, *_args) -> None:
            return None

        def login(self, sender: str, password: str) -> None:
            seen.update(sender=sender, password=password)

        def send_message(self, message) -> None:
            seen["to"] = message["To"]

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.clients.email_otp.get_settings",
        lambda: SimpleNamespace(
            custom_booxoo_bot_smtp_sender="booxoo@example.com",
            custom_booxoo_bot_smtp_app_password="app-password",
            custom_booxoo_bot_smtp_host="smtp.gmail.com",
            custom_booxoo_bot_smtp_port=465,
        ),
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.clients.email_otp.smtplib.SMTP_SSL",
        SMTP,
    )

    result = send_otp_email(
        "1012",
        "customer@example.com",
        "123456",
        "Lee",
    )

    assert result["ok"] is True
    assert seen == {
        "host": "smtp.gmail.com",
        "port": 465,
        "timeout": 20,
        "sender": "booxoo@example.com",
        "password": "app-password",
        "to": "customer@example.com",
    }


def test_send_otp_can_select_sms_when_email_is_present(monkeypatch) -> None:
    ctx = _ctx()
    ctx.session.customer_found = True
    ctx.session.ticketing_verified = True
    ctx.session.contact = {
        "name": "Lee Ford",
        "email": "saved@example.com",
        "phone": "447700900123",
    }
    seen: dict[str, str] = {}

    def fake_sms(mobile: str, _code: str, _name: str) -> dict:
        seen["mobile"] = mobile
        return {"ok": True, "destination": mobile, "http_status": 200}

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.session_card.save_chat_card",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.identity.send_otp_sms",
        fake_sms,
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.identity.send_otp_email",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("email used")),
    )

    result = send_otp(ctx, channel="sms")
    repeated = send_otp(ctx, channel="sms")

    assert result["sent"] is True
    assert result["channel"] == "sms"
    assert result["destination"] == "447700900123"
    assert seen["mobile"] == "447700900123"
    assert repeated["sent"] is False
    assert repeated["already_sent"] is True


def test_send_otp_asks_which_stored_phone_before_sending(monkeypatch) -> None:
    ctx = _ctx()
    ctx.session.customer_found = True
    ctx.session.ticketing_verified = True
    ctx.session.contact = {"email": "saved@example.com", "phone": "+91 918778828184"}
    ctx.session.stored_phones = ("+91 918778828184", "+91 919150911820")
    seen: list[str] = []

    def fake_sms(mobile: str, _code: str, _name: str) -> dict:
        seen.append(mobile)
        return {"ok": True, "destination": mobile, "http_status": 200}

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.session_card.save_chat_card",
        lambda *args, **kwargs: None,
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.identity.send_otp_sms",
        fake_sms,
    )

    waiting = send_otp(ctx, channel="sms")

    assert waiting["sent"] is False
    assert waiting["error"] == "sms_destination_required"
    assert waiting["phones"] == ["+91 918778828184", "+91 919150911820"]
    assert seen == []

    chosen = send_otp(ctx, channel="sms", phone="919150911820")
    assert chosen["sent"] is True
    assert chosen["destination"] == "+91 919150911820"
    assert seen == ["+91 919150911820"]


def test_verified_card_keeps_the_open_request() -> None:
    from app.agents.custom_booxoo_bot.session_card import apply_chat_card, chat_session_note

    session = Session()
    session.stored_phones = ("+91 918778828184", "+91 919150911820")
    apply_chat_card(
        session,
        {
            "verified": True,
            "ticketing_verified": True,
            "channel": "sms",
            "destination": "+91 918778828184",
            "customer_lines": ["I requested a refund 3 days ago"],
            "contact": {},
        },
    )
    note = chat_session_note(session, include_history=True)

    assert session.authenticated is True
    assert session.ticketing_verified is True
    assert "Session verification: verified once by sms to +91 918778828184." in note
    assert "Do not ask for another code." in note
    assert "Next step" not in note
    assert "I requested a refund 3 days ago" in note
    assert "Stored phones" not in note


def test_sms_normalization_preserves_international_country_codes() -> None:
    assert normalize_sms_destination("+44 7700 900123") == "447700900123"
    assert normalize_sms_destination("07700 900123") == "447700900123"
    assert normalize_sms_destination("+91 87788 28184") == "918778828184"
    assert normalize_sms_destination("8778828184") is None


def test_http_customer_lookup_records_cdp_id(monkeypatch) -> None:
    ctx = _ctx()
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.orders.lookup_customer",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.orders._client.get_customer_details",
        lambda **_kwargs: (
            200,
            {
                "customer": {
                    "cdpId": "CDP-http-1",
                    "name": "Lee Ford",
                    "email": "saved@example.com",
                }
            },
        ),
    )

    result = lookup_customer_details(ctx, email="saved@example.com")

    assert result["found"] is True
    assert ctx.session.customer_found is True
    assert ctx.session.cdp_id == "CDP-http-1"


def test_ticket_creation_accepts_sms_verified_contact(monkeypatch) -> None:
    ctx = _ctx()
    ctx.session.authenticated = True
    ctx.session.ticketing_verified = True
    ctx.session.selected_order_id = "BXUK-1"
    ctx.session.selected_product_id = "SKU-1"
    ctx.session.contact = {"name": "Lee Ford", "phone": "447700900123"}
    seen: dict = {}

    def fake_create_ticket(**kwargs):
        seen.update(kwargs)
        return 201, {"ticketNumber": "1628", "status": "Open"}

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.ticketing._client.create_ticket",
        fake_create_ticket,
    )

    result = create_support_ticket(ctx, issue="Return requested")

    assert result["ok"] is True
    assert result["ticketNumber"] == "1628"
    assert seen["email"] == ""
    assert seen["mobile"] == "447700900123"


def test_ticket_creation_omits_order_for_a_non_order_issue(monkeypatch) -> None:
    ctx = _ctx()
    ctx.session.authenticated = True
    ctx.session.ticketing_verified = True
    ctx.session.contact = {"name": "Lee Ford", "email": "saved@example.com"}
    seen: dict = {}

    def fake_create_ticket(**kwargs):
        seen.update(kwargs)
        return 201, {"ticketNumber": "1630", "status": "Open"}

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.ticketing._client.create_ticket",
        fake_create_ticket,
    )

    result = create_support_ticket(ctx, issue="Password reset")

    assert result["ok"] is True
    assert seen["references"] is None
    assert "orderId" not in seen["metadata"]
    assert "productId" not in seen["metadata"]


def test_order_items_fall_back_when_sku_is_missing(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.clients.cdp_store._all",
        lambda *_args, **_kwargs: [
            (43747, 99, None, "shopify-product-1", None),
            (43747, 100, None, None, None),
        ],
    )

    orders = _with_items(
        1012,
        [(43747, "BXUK-20260905-1750400B", "pending", None)],
    )

    assert orders[0]["items"] == [
        {"product_id": "shopify-product-1", "name": "shopify-product-1"},
        {"product_id": "100", "name": "100"},
    ]


def test_uk_time_line_uses_london_clock() -> None:
    moment = datetime(2026, 10, 3, 14, 42, tzinfo=ZoneInfo("UTC"))
    assert uk_time_line(moment) == "UK time: Saturday 3 October 2026, 15:42 Europe/London"


def test_card_restores_facts_without_a_locked_next_step() -> None:
    from app.agents.custom_booxoo_bot.session_card import apply_chat_card, chat_session_note

    session = Session()
    apply_chat_card(
        session,
        {
            "verified": True,
            "ticketing_verified": True,
            "channel": "email",
            "destination": "saved@example.com",
            "active_agent": "SupportAgent",
            "selected_order_id": "BXUK-1",
            "selected_product_id": "SKU-1",
            "last_ticket": {"ticketNumber": "#1628", "status": "Open"},
            "assistant_replied": True,
            "customer_lines": ["where is my refund", "the jacket is damaged"],
        },
    )
    note = chat_session_note(session, include_history=True)

    assert session.active_agent == "SupportAgent"
    assert session.selected_order_id == "BXUK-1"
    assert session.selected_product_id == "SKU-1"
    assert session.last_ticket["ticketNumber"] == "#1628"
    assert session.assistant_replied is True
    assert "Selected order: BXUK-1." in note
    assert "Last ticket: #1628, status Open." in note
    assert "Do not greet again." in note
    assert "the jacket is damaged" in note
    assert "Next step" not in note


def test_verified_session_hides_otp_tools_for_a_new_request() -> None:
    from app.agents.custom_booxoo_bot.multi_agent import Agent
    from app.agents.custom_booxoo_bot.tools.registry import build_tools

    class FakeLLM:
        def run(self, messages, tools):
            return {"content": "What is wrong with the jacket?", "tool_calls": None}

    ctx = _ctx()
    ctx.session.authenticated = True
    agent = Agent(
        name="SupportAgent",
        system="support",
        tools=build_tools("support"),
        llm=FakeLLM(),
        handoff_instruction="support",
    )

    agent.run("where is my refund", ctx)
    agent.run("the jacket is damaged", ctx)

    assert "send_otp" not in agent.tools_mapping
    assert "verify_otp" not in agent.tools_mapping
    assert ctx.session.assistant_replied is True


def test_summary_keeps_the_last_ten_customer_turns() -> None:
    from app.agents.custom_booxoo_bot.multi_agent import trim_session_history

    class FakeLLM:
        def run(self, messages, tools):
            older = messages[-1]["content"]
            assert "tool" not in older
            assert "user: turn-0" in older
            assert "user: turn-10" not in older
            return {"content": "Earlier chat about a refund."}

    messages = []
    for index in range(12):
        messages.append({"role": "user", "content": f"turn-{index}"})
        messages.append(
            {
                "role": "assistant",
                "tool_calls": [{"function": {"name": "get_ticket_status", "arguments": "{}"}}],
            }
        )
        messages.append({"role": "tool", "name": "get_ticket_status", "content": '{"ok": true}'})
        messages.append({"role": "assistant", "content": f"reply-{index}"})

    trimmed = trim_session_history(messages, FakeLLM())

    assert trimmed is not None
    assert trimmed[0]["content"] == "Earlier chat about a refund."
    kept_users = [item["content"] for item in trimmed if item.get("role") == "user"]
    assert kept_users == [f"turn-{index}" for index in range(2, 12)]
    assert len([item for item in trimmed if item.get("role") == "tool"]) == 10


def test_one_otp_medium_unlocks_ticket_creation(monkeypatch) -> None:
    ctx = _ctx()
    ctx.session.customer_found = True
    ctx.session.ticketing_verified = False
    ctx.session.otp_code = "724947"
    ctx.session.otp_channel = "email"
    ctx.session.contact = {"name": "Lee Ford", "email": "saved@example.com", "phone": "447700900123"}
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.session_card.save_chat_card",
        lambda *args, **kwargs: None,
    )

    verified = verify_otp(ctx, code="724947")

    assert verified["ok"] is True
    assert ctx.session.ticketing_verified is True
    seen: dict = {}

    def fake_create_ticket(**kwargs):
        seen.update(kwargs)
        return 201, {"ticketNumber": "1701", "status": "Open", "channel": "Webchat"}

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.tools.ticketing._client.create_ticket",
        fake_create_ticket,
    )
    ctx.session.ticketing_verified = False

    result = create_support_ticket(ctx, issue="Payment failed but the amount was deducted")

    assert result["ok"] is True
    assert result["ticketNumber"] == "1701"
    assert seen["channel"] == "webchat"
    assert seen["email"] == "saved@example.com"
    assert seen["idempotency_key"].startswith("144280:")


def test_email_ticket_still_requires_the_ticketing_check() -> None:
    ctx = _ctx()
    ctx.request.channel = "email"
    ctx.session.authenticated = True
    ctx.session.ticketing_verified = False
    ctx.session.contact = {"name": "Lee Ford", "email": "saved@example.com"}

    result = create_support_ticket(ctx, issue="Password reset")

    assert result["ok"] is False
    assert result["error"] == "customer_not_verified"


def test_create_ticket_posts_the_intake_api(monkeypatch) -> None:
    seen: dict = {}

    class Response:
        status_code = 201
        content = b"{}"

        def json(self) -> dict:
            return {"ticketNumber": "1702", "channel": "Webchat"}

    def fake_post(url, headers, json, timeout):
        seen["url"] = url
        seen["body"] = json
        seen["authorization"] = headers.get("Authorization", "")
        return Response()

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.clients.ticketing.get_settings",
        lambda: SimpleNamespace(
            custom_booxoo_bot_ticketing_base_url="https://rebuild-ticketing.worktual.com",
            custom_booxoo_bot_ticketing_api_key="test-key",
        ),
    )
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.clients.ticketing.httpx.post",
        fake_post,
    )

    status, payload = TicketingClient().create_ticket(
        name="Riya Sharma",
        issue="Order arrived damaged",
        email="riya@clienta.com",
        mobile="+919876543210",
        channel="webchat",
        external_ref="chat_session_9f2a1c",
        idempotency_key="chat_session_9f2a1c:issue",
        subject="Wrong item received",
        references=[{"type": "order", "id": "ORD-8821"}],
        metadata={"source": "ccaas_bot"},
    )

    assert status == 201
    assert payload["ticketNumber"] == "1702"
    assert seen["url"] == "https://rebuild-ticketing.worktual.com/api/intake/tickets"
    assert seen["authorization"] == "Bearer test-key"
    assert seen["body"]["channel_type"] == "webchat"
    assert seen["body"]["issue"] == "Order arrived damaged"
    assert seen["body"]["email"] == "riya@clienta.com"
    assert seen["body"]["mobile"] == "+919876543210"
    assert seen["body"]["idempotencyKey"] == "chat_session_9f2a1c:issue"
    assert "priority" not in seen["body"]
    assert "Authorization" not in seen["body"]
