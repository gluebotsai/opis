from app.config import settings
from app.services import google_id


def test_oauth_audiences_dedupes(monkeypatch):
    monkeypatch.setattr(settings, "google_addon_client_id", "a.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "google_client_id", "b.apps.googleusercontent.com")
    monkeypatch.setattr(settings, "google_oauth_extra_client_ids", "b.apps.googleusercontent.com,c.apps.googleusercontent.com")
    assert google_id._oauth_id_token_audiences() == [
        "a.apps.googleusercontent.com",
        "b.apps.googleusercontent.com",
        "c.apps.googleusercontent.com",
    ]
