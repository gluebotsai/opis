from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from jwt import encode

from app.api import bot as bot_api
from app.api import copilot as copilot_api
from app.api.copilot import get_agent_router
from app.api.omnichannel import get_cc_core_adapter
from app.config import get_settings
from app.llm.client import get_llm_client
from app.main import app
from app.schemas.bot import BotTurnResponse

INTERNAL_KEY = "test-internal-service-key-32-chars"
JWT_SECRET = "test-jwt-secret-key-32-characters"


class FakeAgent:
    def __init__(self, name: str = "general") -> None:
        self.definition = type("Definition", (), {"name": name})()

    async def stream(self, *_args: Any, **_kwargs: Any) -> AsyncIterator[str]:
        yield 'event: status\ndata: {"status":"thinking"}\n\n'
        yield 'event: text_delta\ndata: {"delta":"Hello"}\n\n'
        yield "event: done\ndata: {}\n\n"


class FakeRouter:
    def __init__(self) -> None:
        self.agent = FakeAgent()
        self.direct_calls: list[str] = []

    def select_agent(self, surface: str) -> FakeAgent:
        return FakeAgent("analytics" if surface == "dashboard" else "general")

    async def route_and_run(self, _messages: Any, context: Any, *_args: Any, **_kwargs: Any) -> dict[str, str]:
        agent = "analytics" if context.surface == "dashboard" else "general"
        return {"reply": "Hello", "agent": agent}

    async def stream(self, *_args: Any, **_kwargs: Any) -> AsyncIterator[str]:
        async for event in self.agent.stream():
            yield event

    async def stream_direct(
        self,
        agent_name: str,
        _messages: Any,
        _context: Any,
    ) -> AsyncIterator[str]:
        self.direct_calls.append(agent_name)
        async for event in self.agent.stream():
            yield event


class FakeSupportBot:
    async def run_turn(self, **_kwargs: Any) -> BotTurnResponse:
        return BotTurnResponse(
            reply="Hello",
            confidence=0.9,
            intent="greeting",
            trace_id="trace-1",
            model_name="test-model",
        )


class FakeLLM:
    model = "test-model"

    async def json(self, messages: list[dict[str, Any]]) -> dict[str, Any]:
        text = str(messages[-1]["content"])
        if "omni_channel_summary" in str(messages[0]["content"]):
            return {"omni_channel_summary": "Customer asked about an invoice."}
        if "URGENT" in text:
            return {"urgency": "high"}
        return {
            "contact_entities": {
                "email": "user@example.com",
                "phone": None,
                "first_name": None,
                "last_name": None,
                "company": None,
                "city": None,
                "country": None,
            }
        }


class FakeCcCore:
    async def request(
        self,
        method: str,
        _path: str,
        *_args: Any,
        **_kwargs: Any,
    ) -> dict[str, Any]:
        if method == "GET":
            return {
                "channelSummaries": [
                    {"channel": "webchat", "summary": "Asked about an invoice."}
                ]
            }
        return {"saved": True}


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    settings = get_settings()
    monkeypatch.setattr(settings, "debug", True)
    monkeypatch.setattr(settings, "jwt_secret", JWT_SECRET)
    monkeypatch.setattr(settings, "internal_service_key", INTERNAL_KEY)
    monkeypatch.setattr(settings, "together_api_key", "test-key")
    monkeypatch.setattr(settings, "chat_openai_api_key", "test-key")
    app.dependency_overrides[get_agent_router] = FakeRouter
    monkeypatch.setattr(
        bot_api.support_agent_registry,
        "resolve_support_agent",
        lambda _organization_id: FakeSupportBot(),
    )
    monkeypatch.setattr(
        bot_api.support_agent_registry,
        "get_default_support_bot_agent",
        lambda: FakeSupportBot(),
    )
    app.dependency_overrides[get_llm_client] = FakeLLM
    app.dependency_overrides[get_cc_core_adapter] = FakeCcCore
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def jwt_token(tenant_id: str = "tenant-1") -> str:
    return encode(
        {
            "sub": "user-1",
            "tenant_id": tenant_id,
            "role": "agent",
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        },
        JWT_SECRET,
        algorithm="HS256",
    )


def internal_headers() -> dict[str, str]:
    return {
        "x-tenant-id": "tenant-1",
        "x-internal-service-key": INTERNAL_KEY,
    }


def test_health_and_readiness(client: TestClient) -> None:
    assert client.get("/health").json() == {"status": "healthy"}
    assert client.get("/health/ready").json() == {"status": "ready"}


def test_copilot_rest_and_sse_contracts(client: TestClient) -> None:
    headers = {
        "authorization": f"Bearer {jwt_token()}",
        "x-tenant-id": "tenant-1",
    }
    payload = {
        "message": "Hello",
        "role": "agent",
        "context": {
            "path": "/agent/workspace",
            "surface": "dashboard",
            "conversationId": "conversation-1",
        },
    }
    response = client.post("/api/v1/copilot", headers=headers, json=payload)
    assert response.status_code == 200
    assert response.json()["turnId"]
    assert response.json()["route"] == "analytics"

    stream = client.post("/api/v1/copilot/stream", headers=headers, json=payload)
    assert stream.status_code == 200
    assert "text/event-stream" in stream.headers["content-type"]
    assert "event: status" in stream.text
    assert "event: text_delta" in stream.text
    assert "event: done" in stream.text

    suggest = client.post("/api/v1/copilot/suggest-reply/stream", headers=headers, json=payload)
    assert suggest.status_code == 200
    assert "text/event-stream" in suggest.headers["content-type"]
    assert "event: status" in suggest.text
    assert "event: text_delta" in suggest.text
    assert "event: done" in suggest.text


def test_suggest_reply_uses_direct_conversation_assist(client: TestClient) -> None:
    router = FakeRouter()
    app.dependency_overrides[get_agent_router] = lambda: router
    try:
        response = client.post(
            "/api/v1/copilot/suggest-reply/stream",
            headers={
                "authorization": f"Bearer {jwt_token()}",
                "x-tenant-id": "tenant-1",
            },
            json={
                "message": "Draft a reply",
                "role": "agent",
                "context": {
                    "path": "/agent/workspace",
                    "surface": "inbox",
                    "conversationId": "conversation-1",
                },
            },
        )
        assert response.status_code == 200
        assert router.direct_calls == ["conversation_assist"]
    finally:
        app.dependency_overrides[get_agent_router] = FakeRouter


def test_lola_assist_routes_inbox_and_suggested_reply_by_audience(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "custom_lola_assist_org_ids", "1003")
    calls: list[str] = []

    async def fake_lola_assist(_messages, _context, audience="customer"):
        calls.append(audience)
        yield 'event: text_delta\ndata: {"delta":"Lola assist"}\n\n'
        yield "event: done\ndata: {}\n\n"

    monkeypatch.setattr(copilot_api, "stream_lola_assist", fake_lola_assist)
    headers = {
        "authorization": f"Bearer {jwt_token('1003')}",
        "x-tenant-id": "1003",
    }
    payload = {
        "message": "Help this customer",
        "role": "agent",
        "context": {
            "path": "/agent/workspace",
            "surface": "inbox",
            "conversationId": "77",
        },
    }

    coworker = client.post("/api/v1/copilot/stream", headers=headers, json=payload)
    suggestion = client.post(
        "/api/v1/copilot/suggest-reply/stream",
        headers=headers,
        json=payload,
    )

    assert coworker.status_code == 200
    assert suggestion.status_code == 200
    assert calls == ["agent", "customer"]


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        (
            "/api/v1/webchat/turn",
            {"organization_id": "tenant-1", "conversation_id": "c1", "message": "Hi"},
        ),
        (
            "/api/v1/whatsapp/turn",
            {"organization_id": "tenant-1", "conversation_id": "c1", "message": "Hi"},
        ),
        (
            "/api/v1/social/turn",
            {
                "organization_id": "tenant-1",
                "conversation_id": "c1",
                "message": "Hi",
                "tenant_context": {"channel": "instagram"},
            },
        ),
    ],
)
def test_channel_turn_contracts(
    client: TestClient,
    path: str,
    payload: dict[str, Any],
) -> None:
    response = client.post(path, headers=internal_headers(), json=payload)
    assert response.status_code == 200
    assert response.json()["reply"] == "Hello"
    assert response.json()["confidence"] == 0.9


def test_webchat_agent_turn_ingests_without_bot_reply(client: TestClient) -> None:
    response = client.post(
        "/api/v1/webchat/turn",
        headers=internal_headers(),
        json={
            "organization_id": "tenant-1",
            "conversation_id": "c1",
            "message": "Hi there, I'm Bharathi",
            "from": "agent",
            "agent_name": "Bharathi Sivakumar",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == ""
    assert body["model_name"] == "agent-ingest"


def test_public_prefix_is_registered(client: TestClient) -> None:
    paths = app.openapi()["paths"]
    assert "/nlp-api/v1/copilot" in paths
    assert "/nlp-api/v1/webchat/turn" in paths
    assert "/nlp-api/v1/contact-entities/extract" in paths
    assert "/nlp-api/v1/omnichannel/summary/refresh" in paths


def test_email_contracts(client: TestClient) -> None:
    turn = client.post(
        "/api/v1/email/turn",
        headers=internal_headers(),
        json={
            "organization_id": "tenant-1",
            "conversation_id": "c1",
            "subject": "Invoice",
            "message": "Please help",
            "tenant_context": {},
            "transcript": [],
            "queue_profiles": [],
        },
    )
    assert turn.status_code == 200
    assert turn.json()["reply"] == "Hello"
    assert turn.json()["guard_passed"] is True

    priority = client.post(
        "/api/v1/email/priority",
        headers=internal_headers(),
        json={
            "organization_id": "tenant-1",
            "conversation_id": "c1",
            "subject": "URGENT",
            "message": "Service unavailable",
        },
    )
    assert priority.status_code == 200
    assert priority.json()["urgency"] == "high"


def test_internal_voice_queue_selection_contract(client: TestClient) -> None:
    response = client.post(
        "/internal/v1/voice-routing/select-queue",
        headers=internal_headers(),
        json={
            "organization_id": "tenant-1",
            "transcript": "customer: I need help with an invoice",
            "queue_profiles": [
                {
                    "key": "2788",
                    "name": "Support",
                    "description": "General support",
                    "intents": ["support"],
                    "skills": ["support"],
                },
                {
                    "key": "2789",
                    "name": "Billing",
                    "description": "Invoices and payments",
                    "intents": ["billing"],
                    "skills": ["billing"],
                },
            ],
        },
    )
    assert response.status_code == 200
    assert response.json() == {"queue_id": "2788", "skills": ["support"]}


def test_entity_and_omnichannel_contracts(client: TestClient) -> None:
    entities = client.post(
        "/api/v1/contact-entities/extract",
        headers=internal_headers(),
        json={
            "organization_id": "tenant-1",
            "conversation_id": "c1",
            "message": "My email is user@example.com",
            "channel": "webchat",
        },
    )
    assert entities.status_code == 200
    assert entities.json()["contact_entities"]["email"] == "user@example.com"

    summary = client.post(
        "/api/v1/omnichannel/summary/refresh",
        headers=internal_headers(),
        json={"organization_id": "tenant-1", "contact_id": "contact-1"},
    )
    assert summary.status_code == 200
    assert summary.json()["contact_id"] == "contact-1"
    assert summary.json()["channel_count"] == 1
    assert summary.json()["omni_channel_summary"] == "Customer asked about an invoice."
