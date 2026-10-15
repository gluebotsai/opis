"""Tests for create-campaign fallback replies."""

from app.mas.runtime.create_chat_reply import fallback_create_campaign_reply


def test_fallback_asks_channels_when_meta_saved() -> None:
    text = fallback_create_campaign_reply(
        {
            "reply": "",
            "state": {
                "campaign": {"name": "Diwali", "goal": "G", "objective": "O"},
                "channels": [],
                "templates": [],
            },
        }
    )
    assert "channels" in text.lower()
    assert "email" in text.lower()


def test_fallback_preserves_non_empty_reply() -> None:
    assert fallback_create_campaign_reply({"reply": "<p>Hello</p>"}) == "<p>Hello</p>"
