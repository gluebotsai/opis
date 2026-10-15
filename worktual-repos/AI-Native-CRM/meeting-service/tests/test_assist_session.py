import jwt

from app.config import settings
from tests.conftest import SECRET


def test_session_503_without_google_client(client):
    r = client.post("/v1/assist/session", json={"google_id_token": "x"})
    assert r.status_code == 503
    assert "Google" in r.json()["detail"]


def test_session_mints_token_from_google_email(client, monkeypatch):
    monkeypatch.setattr(settings, "google_addon_client_id", "client.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "crm_users_base_url", "internal")
    monkeypatch.setattr(settings, "crm_assist_dummy_org_id", "org-a")
    monkeypatch.setattr(
        "app.services.assist_session.verify_google_id_token",
        lambda token: ("rep@company.com", "g-99"),
    )
    r = client.post("/v1/assist/session", json={"google_id_token": "ok-token"})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "rep@company.com"
    assert body["user"]["organization_id"] == "org-a"
    claims = jwt.decode(body["token"], SECRET, algorithms=["HS256"])
    assert claims["organization_id"] == "org-a"
    assert claims["email"] == "rep@company.com"
    assert "meetings:write" in claims["scopes"]


def test_session_rejects_google_not_connected_in_crm(client, monkeypatch):
    monkeypatch.setattr(settings, "google_addon_client_id", "client.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "crm_users_base_url", "http://crm-users.test")
    monkeypatch.setattr(
        "app.services.assist_session.verify_google_id_token",
        lambda token: ("other@gmail.com", "g-2"),
    )
    monkeypatch.setattr(
        "app.services.assist_session.crm_users.lookup_by_email",
        lambda email: {
            "organization_id": "org-a",
            "sub": "u1",
            "email": "rep@company.com",
            "scopes": ["meetings:write"],
            "connected_google_email": "configured@gmail.com",
        },
    )
    r = client.post("/v1/assist/session", json={"google_id_token": "ok-token"})
    assert r.status_code == 409
    assert r.json()["detail"] == "crm_login_required"


def test_session_unknown_crm_user(client, monkeypatch):
    monkeypatch.setattr(settings, "google_addon_client_id", "client.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "crm_users_base_url", "http://crm-users.test")
    monkeypatch.setattr(
        "app.services.assist_session.verify_google_id_token",
        lambda token: ("stranger@x.test", "g-1"),
    )

    class FakeResp:
        status_code = 404

        def json(self):
            return {}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def get(self, *a, **k):
            return FakeResp()

    monkeypatch.setattr("app.services.crm_users.httpx.Client", FakeClient)
    r = client.post("/v1/assist/session", json={"google_id_token": "ok-token"})
    assert r.status_code == 409
    assert r.json()["detail"] == "crm_login_required"


def test_session_token_looks_up_meeting(client, monkeypatch):
    from tests.conftest import insert_meeting

    insert_meeting(client.extra["Session"])
    monkeypatch.setattr(settings, "google_addon_client_id", "client.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "crm_users_base_url", "internal")
    monkeypatch.setattr(settings, "crm_assist_dummy_org_id", "org-a")
    monkeypatch.setattr(
        "app.services.assist_session.verify_google_id_token",
        lambda token: ("rep@company.com", "g-99"),
    )
    sess = client.post("/v1/assist/session", json={"google_id_token": "ok-token"})
    token = sess.json()["token"]
    r = client.get(
        "/v1/meetings/lookup",
        params={"meeting_url": "https://meet.google.com/abc-defg-hij"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "active"


def test_session_ask_skips_google_token(client, monkeypatch):
    from tests.conftest import insert_meeting

    insert_meeting(client.extra["Session"])
    monkeypatch.setattr(settings, "google_addon_client_id", "client.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "crm_users_base_url", "internal")
    monkeypatch.setattr(settings, "crm_assist_dummy_org_id", "org-a")
    monkeypatch.setattr(settings, "crm_bot_base_url", "http://crm-bot.test")
    monkeypatch.setattr(
        "app.services.assist_session.verify_google_id_token",
        lambda token: ("rep@company.com", "g-99"),
    )
    monkeypatch.setattr("app.services.crm_bot.ask", lambda payload, bearer, db=None: {"reply": "ok"})
    sess = client.post("/v1/assist/session", json={"google_id_token": "ok-token"})
    token = sess.json()["token"]
    r = client.post(
        "/v1/assist/ask",
        json={"meeting_url": "https://meet.google.com/abc-defg-hij", "query": "hi"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["reply"] == "ok"


def test_password_session_mints_token(client, monkeypatch):
    def verify(email, password):
        assert password == "secret"
        return {
            "organization_id": "org-a",
            "sub": "u1",
            "email": email,
            "scopes": ["meetings:write"],
            "connected_google_email": None,
        }

    monkeypatch.setattr("app.services.assist_session.crm_users.verify_login", verify)
    r = client.post(
        "/v1/assist/session/login",
        json={"email": "rep@company.com", "password": "secret"},
    )
    assert r.status_code == 200
    assert r.json()["user"]["email"] == "rep@company.com"
    claims = jwt.decode(r.json()["token"], SECRET, algorithms=["HS256"])
    assert claims["sub"] == "u1"
    assert claims["google_sub"] == ""


def test_meet_addon_is_chat_panel(client):
    r = client.get("/addons/meet/")
    assert r.status_code == 200
    assert "Worktual Assist" in r.text
    assert "worktual-logo.png" in r.text
    assert "Type your question" in r.text
    assert 'id="crmLogin"' in r.text
    assert 'id="crmPassword"' in r.text
    assert "renderButton" not in r.text
    assert "CRM JWT" not in r.text
    assert "tpiadmin" not in r.text
    assert "Notetaker" not in r.text
    assert "Summarize this meeting" not in r.text
