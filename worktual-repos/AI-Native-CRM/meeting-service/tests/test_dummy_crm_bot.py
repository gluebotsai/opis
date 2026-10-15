from app.config import settings
from tests.conftest import auth_header, insert_meeting


class _FakeMsg:
    content = "They have not named a budget yet."


class _FakeChoice:
    message = _FakeMsg()


class _FakeResp:
    choices = [_FakeChoice()]


def test_assist_uses_dummy_openai_when_internal(client, monkeypatch):
    insert_meeting(client.extra["Session"], entity_type="deal", entity_id="D-1")
    settings.crm_bot_base_url = "internal"
    settings.crm_bot_openai_base_url = "http://llm.test/v1"
    settings.crm_bot_openai_model = "worktual-gemma"
    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured["kwargs"] = kwargs
            return _FakeResp()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client"] = kwargs
            self.chat = FakeChat()

    monkeypatch.setattr("app.services.dummy_crm_bot.OpenAI", FakeClient)
    r = client.post(
        "/v1/assist/ask",
        json={"meeting_url": "https://meet.google.com/abc-defg-hij", "query": "What was budget?"},
        headers=auth_header(),
    )
    assert r.status_code == 200
    assert r.json()["reply"] == "They have not named a budget yet."
    assert captured["client"]["base_url"] == "http://llm.test/v1"
    assert captured["kwargs"]["model"] == "worktual-gemma"
    assert "What was budget?" in captured["kwargs"]["messages"][1]["content"]


def test_dummy_http_contract(client, monkeypatch):
    m = insert_meeting(client.extra["Session"])
    settings.crm_bot_openai_base_url = "http://llm.test/v1"
    settings.crm_bot_openai_model = "worktual-gemma"

    class FakeCompletions:
        def create(self, **kwargs):
            return _FakeResp()

    class FakeChat:
        completions = FakeCompletions()

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = FakeChat()

    monkeypatch.setattr("app.services.dummy_crm_bot.OpenAI", FakeClient)
    r = client.post(
        "/internal/crm-bot/v1/assist/ask",
        json={
            "meeting_id": m.id,
            "organization_id": "org-a",
            "entity_type": "contact",
            "entity_id": "C-1",
            "query": "Summarize",
            "intent": "ask",
            "user": {"crm_sub": "user-1"},
        },
    )
    assert r.status_code == 200
    assert r.json()["reply"] == "They have not named a budget yet."
    assert r.json()["source"] == "dummy"
