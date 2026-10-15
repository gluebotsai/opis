"""Tests for custom_lola_worktual ticket verification and handoff tools."""

import json
from unittest.mock import AsyncMock

import pytest

from app.agents.custom_lola_worktual.agent import CustomLolaWorktualAgent
from app.agents.custom_lola_worktual.memory import Memory
from app.agents.custom_lola_worktual.multi_agent import Agent
from app.agents.custom_lola_worktual.prompts import SALES_SYSTEM_PROMPT, SERVICE_SYSTEM_PROMPT
from app.agents.custom_lola_worktual.session import (
    get_turn_context,
    get_verified_contact,
    set_turn_context,
)
from app.agents.custom_lola_worktual.tools import (
    BOOK_APPOINTMENT,
    CRM_APPOINTMENTS_BASE_URL,
    CONTACT_ENRICH,
    CUSTOM_LOLA_CRM_ORGANIZATION_ID,
    Tool,
    _crm_appointment_headers,
    book_appointment,
    check_appointment_availability,
    contact_enrich,
    create_ticket,
    get_sales_knowledge,
    live_agent,
    verify_contact_for_ticket,
)
from app.agents.support_handoff import HandoffFields, extract_handoff_from_messages
from app.schemas.bot import ContactEntities
from app.services.contact_enrich_policy import ContactProfileSnapshot


def test_crm_appointment_headers_use_custom_lola_org() -> None:
    headers = _crm_appointment_headers()
    assert headers["x-organization-id"] == CUSTOM_LOLA_CRM_ORGANIZATION_ID == "1003"
    assert "Authorization" not in headers


class _CrmResponse:
    def __init__(self, status_code: int, payload: dict | None = None) -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.text = json.dumps(self._payload)
        self.content = self.text.encode()

    def json(self) -> dict:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(self.status_code)


def test_availability_uses_rebuild_crm_host(monkeypatch) -> None:
    seen: dict[str, str] = {}

    def fake_get(url, headers, params, timeout):
        seen["url"] = url
        seen["org"] = headers["x-organization-id"]
        seen["contact"] = params["contactId"]
        return _CrmResponse(200, {"available": True})

    monkeypatch.setattr("app.agents.custom_lola_worktual.tools.requests.get", fake_get)
    result = check_appointment_availability("cdp-9", "2026-10-06T10:00:00.000Z")
    assert CRM_APPOINTMENTS_BASE_URL.rstrip("/") == "https://rebuild-crm.worktual.com"
    assert seen["url"].startswith("https://rebuild-crm.worktual.com/api/appointments/availability")
    assert seen["org"] == "1003"
    assert seen["contact"] == "cdp-9"
    assert result["available"] is True


def _book_kwargs() -> dict:
    return {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "mobile_number": "+919876543210",
        "email": "ada@worktual.in",
        "preferred_datetime": "06-10-2026 4:00 PM",
        "summary": "demo",
        "plan_name": "CCaaS",
    }


def test_book_uses_cdp_id_and_does_not_create_when_one_is_live(monkeypatch) -> None:
    created: list[str] = []

    def lookup(organization_id, email, phone):
        assert organization_id == "1003"
        assert email == "ada@worktual.in"
        return {"found": True, "cdp_id": "cdp-9"}

    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.clients.cdp_store.lookup_customer",
        lookup,
    )
    def old_sync(*_args, **_kwargs):
        raise AssertionError("old contact sync")

    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.tools.sync_contact_and_get_id",
        old_sync,
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.tools.get_crm_appointment_by_contact",
        lambda contact_id: _CrmResponse(
            200,
            {
                "appointment": {
                    "id": "apt-1",
                    "startsAt": "2026-10-06T10:00:00.000Z",
                    "joinUrl": "https://meet.google.com/abc",
                    "status": "scheduled",
                }
            },
        )
        if contact_id == "cdp-9"
        else _CrmResponse(404),
    )

    def create(contact_id, title, starts_at, **_kwargs):
        created.append(contact_id)
        return _CrmResponse(201, {"appointment": {"id": "apt-2", "joinUrl": "https://meet.google.com/new"}})

    monkeypatch.setattr("app.agents.custom_lola_worktual.tools.create_crm_appointment", create)
    result = book_appointment(**_book_kwargs())
    assert created == []
    assert result["data"]["contact_id"] == "cdp-9"
    assert "https://meet.google.com/abc" in result["message"]
    assert "upcoming demo" in result["message"].lower()
    assert "different person" in result["message"].lower()
    assert "live agent" in result["message"].lower()


def test_book_409_does_not_create_a_second_booking(monkeypatch) -> None:
    created: list[str] = []
    monkeypatch.setattr(
        "app.agents.custom_booxoo_bot.clients.cdp_store.lookup_customer",
        lambda *_args, **_kwargs: {"found": True, "cdp_id": "cdp-9"},
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.tools.get_crm_appointment_by_contact",
        lambda _contact_id: _CrmResponse(404),
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.tools.check_appointment_availability",
        lambda *_args, **_kwargs: {"available": True},
    )

    def create(contact_id, title, starts_at, **_kwargs):
        created.append(contact_id)
        return _CrmResponse(409, {"code": "appointment_exists"})

    monkeypatch.setattr("app.agents.custom_lola_worktual.tools.create_crm_appointment", create)
    result = book_appointment(**_book_kwargs())
    assert created == ["cdp-9"]
    assert result["data"]["code"] == "appointment_exists"
    assert "upcoming demo" in result["message"].lower()
    assert "live agent" in result["message"].lower()


def test_verify_contact_for_ticket_uses_customer_store(monkeypatch) -> None:
    set_turn_context(
        "conv-1",
        {
            "organization_id": "1003",
            "contact_profile": {
                "contactId": "cdp-1",
                "primaryEmail": "user@example.com",
                "firstName": "Ada",
            },
        },
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.identity.lookup_customer",
        lambda *_args, **_kwargs: {
            "found": True,
            "cdp_id": "cdp-1",
            "customer": {"name": "Ada", "email": "user@example.com", "phone": ""},
        },
    )
    result = verify_contact_for_ticket(session_id="conv-1")
    assert result["data"]["customer_found"] is True
    assert result["data"]["verified"] is False
    assert get_verified_contact("conv-1")["email"] == "user@example.com"


def test_create_ticket_requires_verified_contact() -> None:
    result = create_ticket("Printer issue", session_id="conv-missing")
    assert "verify your contact" in result["message"].lower()


def test_live_agent_returns_handoff_payload() -> None:
    result = live_agent()
    assert result["handoff_recommended"] is True
    recommended, _ = extract_handoff_from_messages(
        [
            {
                "role": "tool",
                "name": "LIVE_AGENT",
                "content": json.dumps(result),
            }
        ]
    )
    assert recommended is True


class _ContactEnrichResponse:
    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {
            "result": {
                "outcome": "enriched",
                "canonicalContactId": "CDP-webchat-org1003-visitor-1",
                "appliedFields": ["city"],
                "skippedFields": [],
                "requiresConfirmation": [],
                "contact": {
                    "id": "CDP-webchat-org1003-visitor-1",
                    "firstName": "Ada",
                    "primaryEmail": "ada@example.com",
                    "city": "London",
                },
            }
        }


def test_contact_enrich_returns_structured_result_and_refreshes_profile(
    monkeypatch,
) -> None:
    captured: dict = {}

    def fake_post(url, *, headers, json, timeout):
        captured.update(
            url=url,
            headers=headers,
            json=json,
            timeout=timeout,
        )
        return _ContactEnrichResponse()

    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.tools.requests.post",
        fake_post,
    )
    set_turn_context(
        "conv-enrich",
        {
            "organization_id": "1003",
            "conversation_id": "conv-enrich",
            "contact_profile": {},
        },
    )

    result = contact_enrich(city="London", session_id="conv-enrich")

    assert result["ok"] is True
    assert result["appliedFields"] == ["city"]
    assert result["requiresConfirmation"] == []
    assert captured["json"] == {
        "contactEntities": {"city": "London"},
        "confirmedFields": [],
    }
    assert get_turn_context("conv-enrich")["contact_profile"]["city"] == "London"
    assert get_verified_contact("conv-enrich")["email"] == "ada@example.com"


class _ToolAwareLLM:
    def __init__(self) -> None:
        self.calls = 0
        self.second_messages: list[dict] = []

    def run(self, messages, tools):
        self.calls += 1
        if self.calls == 1:
            return {
                "content": None,
                "reasoning": None,
                "tool_calls": [
                    {
                        "id": "call-enrich",
                        "type": "function",
                        "function": {
                            "name": "contact_enrich",
                            "arguments": json.dumps({"city": "London"}),
                        },
                    }
                ],
            }
        self.second_messages = messages
        return {
            "content": "Thanks — I've updated your city.",
            "reasoning": None,
            "tool_calls": None,
        }


def test_custom_lola_lets_llm_compose_reply_from_enrichment_result() -> None:
    llm = _ToolAwareLLM()

    def enrich_stub(**_kwargs):
        return {
            "ok": True,
            "outcome": "enriched",
            "appliedFields": ["city"],
            "skippedFields": [],
            "requiresConfirmation": [],
        }

    agent = Agent(
        name="SalesAgent",
        system="Use tool results to answer.",
        tools=[Tool(CONTACT_ENRICH, enrich_stub)],
        llm=llm,
    )
    result = agent.run(
        "I live in London",
        Memory(),
        coid="",
        chat_history_id="",
        chat_duration_history_id="",
        session_id="conv-dynamic",
        purchase_status="",
        payment_id="",
        cookie_id="conv-dynamic",
        ip_address="",
        domainId="1003",
        formatted_time="",
        longterm_cache={},
    )

    assert result["response"] == "Thanks — I've updated your city."
    tool_messages = [
        item for item in llm.second_messages if item.get("role") == "tool"
    ]
    assert tool_messages
    assert '"appliedFields": ["city"]' in tool_messages[0]["content"]


class _FakeMCPClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []

    async def call_tool(
        self,
        server_name,
        tool_name,
        _context,
        arguments,
        **_kwargs,
    ):
        self.calls.append((server_name, tool_name, arguments))
        return {
            "result": {
                "outcome": "enriched",
                "canonicalContactId": "CDP-webchat-org1003-visitor-1",
                "appliedFields": ["email"],
                "skippedFields": [],
                "requiresConfirmation": [],
                "contact": {
                    "id": "CDP-webchat-org1003-visitor-1",
                    "firstName": "Ada",
                    "primaryEmail": "ada@example.com",
                },
            }
        }


@pytest.mark.asyncio
async def test_custom_lola_enriches_before_booking_and_gemma_composes_reply(
    monkeypatch,
) -> None:
    fake_mcp = _FakeMCPClient()
    seen_profile: dict = {}

    def fake_run_worktual_turn(**kwargs):
        seen_profile.update(kwargs["tenant_context"]["contact_profile"])
        return {
            "reply": "<p>Please choose a date.</p>",
            "messages": [],
            "handoff_recommended": False,
        }

    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.agent.extract_contact_entities_llm",
        AsyncMock(return_value=ContactEntities(email="ada@example.com")),
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.agent.ensure_session_long_term_summary",
        AsyncMock(return_value="No information provided"),
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.agent.get_mcp_client",
        lambda: fake_mcp,
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.agent.run_worktual_turn",
        fake_run_worktual_turn,
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.agent.resolve_handoff_fields",
        AsyncMock(return_value=HandoffFields()),
    )
    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.agent.compose_contact_enrichment_reply",
        lambda **_kwargs: "Thanks, I saved your email. Please choose a date.",
    )

    response = await CustomLolaWorktualAgent().run_turn(
        organization_id="1003",
        conversation_id="conv-prebook",
        message="My email is ada@example.com",
        tenant_context={"contact_profile": {}},
    )

    assert fake_mcp.calls == [
        ("contact", "contact_enrich", {"email": "ada@example.com"})
    ]
    assert seen_profile["primaryEmail"] == "ada@example.com"
    assert response.reply == "Thanks, I saved your email. Please choose a date."


def test_booking_does_not_require_company_or_industry() -> None:
    parameters = BOOK_APPOINTMENT["function"]["parameters"]
    required = parameters["required"]
    assert "company_name" not in required
    assert "industry" not in required
    assert "company_name" not in parameters["properties"]
    assert "industry" not in parameters["properties"]


@pytest.mark.asyncio
async def test_custom_lola_retries_conflict_only_after_customer_confirmation(
    monkeypatch,
) -> None:
    calls: list[dict] = []

    class ConflictMCP:
        async def call_tool(
            self,
            _server_name,
            _tool_name,
            _context,
            arguments,
            **_kwargs,
        ):
            calls.append(arguments)
            requires = [] if arguments.get("confirmedFields") else ["email"]
            return {
                "result": {
                    "outcome": "enriched" if not requires else "confirmation_required",
                    "canonicalContactId": "contact-1",
                    "appliedFields": ["email"] if not requires else [],
                    "skippedFields": [],
                    "requiresConfirmation": requires,
                    "contact": {
                        "id": "contact-1",
                        "primaryEmail": (
                            "new@example.com"
                            if not requires
                            else "old@example.com"
                        ),
                    },
                }
            }

    monkeypatch.setattr(
        "app.agents.custom_lola_worktual.agent.get_mcp_client",
        lambda: ConflictMCP(),
    )
    agent = CustomLolaWorktualAgent()
    profile = ContactProfileSnapshot(
        contact_id="contact-1",
        primary_email="old@example.com",
    )

    first_result, profile = await agent._enrich_contact(
        organization_id="1003",
        conversation_id="conv-conflict",
        channel="webchat",
        message="My email is new@example.com",
        entities=ContactEntities(email="new@example.com"),
        profile=profile,
        tenant_context={"contact_profile": {}},
    )
    assert first_result["result"]["requiresConfirmation"] == ["email"]
    assert calls[0] == {"email": "new@example.com"}

    second_result, _ = await agent._enrich_contact(
        organization_id="1003",
        conversation_id="conv-conflict",
        channel="webchat",
        message="yes",
        entities=ContactEntities(),
        profile=profile,
        tenant_context={"contact_profile": {}},
    )
    assert second_result["result"]["appliedFields"] == ["email"]
    assert calls[1] == {
        "email": "new@example.com",
        "confirmedFields": ["email"],
    }


def test_sales_product_answers_come_only_from_knowledge(monkeypatch) -> None:
    assert "call GET_SALES_KNOWLEDGE first" in SALES_SYSTEM_PROMPT
    assert "do not have that detail" in SALES_SYSTEM_PROMPT
    assert "offer to raise a ticket" in SERVICE_SYSTEM_PROMPT
    captured: dict = {}

    async def fake_search(query, *, organization_id, module, **_kwargs):
        captured["query"] = query
        captured["organization_id"] = organization_id
        captured["module"] = module
        return {"ok": False, "empty": True, "results": []}

    monkeypatch.setattr(
        "app.services.knowledge_search.search_knowledge_gateway",
        fake_search,
    )
    result = get_sales_knowledge("Worktual products", domainId="1003")
    assert captured == {
        "query": "Worktual products",
        "organization_id": "1003",
        "module": "business",
    }
    assert result["context"] == ""
    assert "Do not invent products" in result["message"]

    async def fake_hit(query, *, organization_id, module, **_kwargs):
        return {
            "ok": True,
            "empty": False,
            "results": [{"text": "Worktual CCaaS handles customer conversations."}],
        }

    monkeypatch.setattr(
        "app.services.knowledge_search.search_knowledge_gateway",
        fake_hit,
    )
    hit = get_sales_knowledge("What is CCaaS?", organization_id="1003")
    assert "Worktual CCaaS handles customer conversations." in hit["context"]
