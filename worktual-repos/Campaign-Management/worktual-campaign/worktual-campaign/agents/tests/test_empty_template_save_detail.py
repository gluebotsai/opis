from app.agents.create_campaign.tool_functions import _empty_template_save_detail


def test_empty_save_notes_thin_web_copy(monkeypatch):
    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: type("S", (), {"campaign_api_base": "http://192.168.1.10:3001/api"})(),
    )
    msg = _empty_template_save_detail(
        [
            {
                "channel": "web",
                "template_id": "00000000-0000-4000-8000-000000000001",
                "fields": {"title": "Hi", "body": "short"},
            }
        ],
    )
    assert "quality checks" in msg.lower()
    assert "web" in msg.lower()
