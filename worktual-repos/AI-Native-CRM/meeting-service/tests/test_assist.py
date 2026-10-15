import jwt

from tests.conftest import SECRET, auth_header, insert_meeting


def test_assist_503_when_bot_unset(client):
    insert_meeting(client.extra["Session"])
    r = client.post(
        "/v1/assist/ask",
        json={"meeting_url": "https://meet.google.com/abc-defg-hij", "query": "What was budget?"},
        headers=auth_header(),
    )
    assert r.status_code == 503
    assert "not configured" in r.json()["detail"]


def test_assist_proxies_to_bot(client, monkeypatch):
    insert_meeting(client.extra["Session"], entity_type="deal", entity_id="D-1")
    captured = {}

    def fake_ask(payload, bearer, db=None):
        captured["payload"] = payload
        captured["bearer"] = bearer
        return {"reply": "They said 50k"}

    monkeypatch.setattr("app.services.crm_bot.ask", fake_ask)
    settings_mod = __import__("app.config", fromlist=["settings"]).settings
    settings_mod.crm_bot_base_url = "http://crm-bot.test"
    r = client.post(
        "/v1/assist/ask",
        json={
            "meeting_url": "https://meet.google.com/abc-defg-hij",
            "query": "What was budget?",
            "email": "spoof@evil.test",
        },
        headers=auth_header(),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["meeting_id"]
    assert body["reply"] == "They said 50k"
    assert captured["payload"]["meeting_id"] == body["meeting_id"]
    assert captured["payload"]["entity_type"] == "deal"
    assert captured["payload"]["query"] == "What was budget?"
    assert "email" not in captured["payload"] or captured["payload"]["user"].get("email") != "spoof@evil.test"
    assert captured["payload"]["user"]["crm_sub"] == "user-1"


def test_assist_google_email_mismatch(client, monkeypatch):
    insert_meeting(client.extra["Session"])
    settings_mod = __import__("app.config", fromlist=["settings"]).settings
    settings_mod.google_addon_client_id = "client.apps.googleusercontent.com"
    settings_mod.crm_bot_base_url = "http://crm-bot.test"
    monkeypatch.setattr(
        "app.services.google_id.verify_google_id_token",
        lambda token: ("other@company.com", "g-1"),
    )
    token = jwt.encode(
        {
            "organization_id": "org-a",
            "sub": "user-1",
            "email": "rep@company.com",
            "scopes": ["meetings:write"],
        },
        SECRET,
        algorithm="HS256",
    )
    r = client.post(
        "/v1/assist/ask",
        json={
            "meeting_url": "https://meet.google.com/abc-defg-hij",
            "query": "hi",
            "google_id_token": "fake-google",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_assist_google_token_required_when_client_id_set(client):
    insert_meeting(client.extra["Session"])
    settings_mod = __import__("app.config", fromlist=["settings"]).settings
    settings_mod.google_addon_client_id = "client.apps.googleusercontent.com"
    settings_mod.crm_bot_base_url = "http://crm-bot.test"
    r = client.post(
        "/v1/assist/ask",
        json={"meeting_url": "https://meet.google.com/abc-defg-hij", "query": "hi"},
        headers=auth_header(),
    )
    assert r.status_code == 401


def test_assist_verified_email_forwarded(client, monkeypatch):
    insert_meeting(client.extra["Session"])
    settings_mod = __import__("app.config", fromlist=["settings"]).settings
    settings_mod.google_addon_client_id = "client.apps.googleusercontent.com"
    settings_mod.crm_bot_base_url = "http://crm-bot.test"
    monkeypatch.setattr(
        "app.services.google_id.verify_google_id_token",
        lambda token: ("rep@company.com", "g-99"),
    )
    captured = {}

    def fake_ask(payload, bearer, db=None):
        captured["user"] = payload["user"]
        return {"reply": "ok"}

    monkeypatch.setattr("app.services.crm_bot.ask", fake_ask)
    token = jwt.encode(
        {
            "organization_id": "org-a",
            "sub": "user-1",
            "email": "rep@company.com",
            "scopes": ["meetings:write"],
        },
        SECRET,
        algorithm="HS256",
    )
    r = client.post(
        "/v1/assist/ask",
        json={
            "meeting_url": "https://meet.google.com/abc-defg-hij",
            "query": "hi",
            "google_id_token": "ok-token",
            "email": "ignored@evil.test",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert captured["user"]["email"] == "rep@company.com"
    assert captured["user"]["google_sub"] == "g-99"
    assert r.json()["user"]["email"] == "rep@company.com"


def test_meet_addon_served_when_test_ui_off(client):
    r = client.get("/addons/meet/")
    assert r.status_code == 200
    assert "Worktual Assist" in r.text
    assert "worktual-logo.png" in r.text
    assert "frame-ancestors" in r.headers.get("content-security-policy", "")
    cfg = client.get("/addons/meet/config")
    assert r.status_code == 200
    assert "google_client_id" in cfg.json()
