"""Unit tests for CDP preferences_json normalize + engagement fill."""

from app.contacts.channel_preferences import (
    empty_preferences,
    merge_preferences_json,
    normalize_preferences_json,
    preferences_from_engagement,
)


def test_normalize_empty():
    assert normalize_preferences_json(None) == empty_preferences()
    assert normalize_preferences_json({}) == empty_preferences()


def test_normalize_flat_01():
    assert normalize_preferences_json(
        {"email": 1, "whatsapp": 0, "push": 0, "web": 0, "sms": 0}
    ) == {
        "email": 1,
        "whatsapp": 0,
        "push": 0,
        "web": 0,
        "sms": 0,
    }


def test_normalize_bool_and_aliases():
    out = normalize_preferences_json({"email": True, "app_push": 1})
    assert out["email"] == 1
    assert out["push"] == 1
    assert out["whatsapp"] == 0


def test_normalize_preserves_timing():
    raw = {
        "email": 1,
        "whatsapp": 0,
        "push": 0,
        "web": 0,
        "sms": 0,
        "timezone": "Asia/Kolkata",
        "timing": {
            "days": ["mon", "tue", "wed", "thu", "fri"],
            "start": "09:00",
            "end": "18:00",
        },
        "channel_timing": {
            "email": {"days": ["mon"], "start": "09:00", "end": "11:00"}
        },
        "junk": "drop-me",
    }
    out = normalize_preferences_json(raw)
    assert out["email"] == 1
    assert out["timezone"] == "Asia/Kolkata"
    assert out["timing"]["start"] == "09:00"
    assert out["channel_timing"]["email"]["end"] == "11:00"
    assert "junk" not in out


def test_normalize_strips_invalid_timing():
    out = normalize_preferences_json(
        {"email": 1, "timing": {"days": [], "start": "25:00", "end": "x"}}
    )
    assert out["email"] == 1
    assert "timing" not in out


def test_merge_flags_keeps_existing_timing():
    existing = {
        "email": 0,
        "whatsapp": 1,
        "push": 0,
        "web": 0,
        "sms": 0,
        "timezone": "Asia/Kolkata",
        "timing": {
            "days": ["mon", "tue", "wed", "thu", "fri"],
            "start": "09:00",
            "end": "18:00",
        },
    }
    incoming = {
        "email": 1,
        "whatsapp": 0,
        "push": 0,
        "web": 0,
        "sms": 0,
    }
    out = merge_preferences_json(existing, incoming)
    assert out["email"] == 1
    assert out["whatsapp"] == 0
    assert out["timing"]["start"] == "09:00"
    assert out["timezone"] == "Asia/Kolkata"


def test_engagement_picks_email_winner():
    out = preferences_from_engagement(
        email_open_count=3,
        email_click_count=1,
        email_unsubscribed=False,
    )
    assert out == {
        "email": 1,
        "whatsapp": 0,
        "push": 0,
        "web": 0,
        "sms": 0,
    }


def test_engagement_unsubscribed_email_zero():
    out = preferences_from_engagement(
        email_open_count=10,
        email_click_count=5,
        email_unsubscribed=True,
        whatsapp_engage_count=2,
    )
    assert out["email"] == 0
    assert out["whatsapp"] == 1


def test_engagement_no_signal_all_zero():
    assert preferences_from_engagement() == empty_preferences()
