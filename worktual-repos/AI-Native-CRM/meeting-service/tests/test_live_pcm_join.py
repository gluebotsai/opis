from app.models import Meeting
from tests.conftest import insert_meeting


def test_live_pcm_join_by_native(client, monkeypatch):
    monkeypatch.setattr("app.config.settings.crm_bot_api_key", "test-bot-key")
    m = insert_meeting(
        client.extra["Session"],
        platform="google_meet",
        native_meeting_id="abc-defg-hij",
    )
    with client.websocket_connect(
        f"/v1/live-pcm/join/google_meet/abc-defg-hij?bot_key=test-bot-key"
    ) as ws:
        ready = ws.receive_json()
        assert ready["type"] == "ready"
        assert ready["meeting_id"] == m.id
        ws.send_json({"speaker": "Customer"})
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
