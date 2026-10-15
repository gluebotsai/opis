"""Deterministic preference windows from engagement timestamps."""

from datetime import datetime, timedelta, timezone

from app.contacts.preference_timing import (
    compute_preference_windows,
    fill_missing_windows,
    window_from_datetimes,
)


def _utc(y, m, d, h, minute=0):
    return datetime(y, m, d, h, minute, tzinfo=timezone.utc)


def test_window_from_datetimes_too_few():
    stamps = [_utc(2026, 9, 1, 9) for _ in range(4)]
    assert window_from_datetimes(stamps, "UTC") is None


def test_window_from_datetimes_peak_hour():
    # Tuesday 9:00 UTC × 5
    stamps = [_utc(2026, 9, 1, 9) for _ in range(5)]
    window = window_from_datetimes(stamps, "UTC")
    assert window is not None
    assert window["start"] == "09:00"
    assert window["end"] == "11:00"
    assert "tue" in window["days"]


def test_compute_skips_thin_sample():
    rows = [
        {
            "channel": "email",
            "opened_at": _utc(2026, 9, 1, 9),
            "clicked_at": None,
        }
    ]
    assert compute_preference_windows(rows, timezone_name="UTC") == {}


def test_compute_email_opens_not_clicks():
    now = _utc(2026, 9, 20, 12)
    opens = [
        {
            "channel": "email",
            "opened_at": _utc(2026, 9, 1, 9),
            "clicked_at": None,
        }
        for _ in range(5)
    ]
    out = compute_preference_windows(
        opens, timezone_name="UTC", now=now, min_events=5
    )
    assert out["timing"]["start"] == "09:00"
    assert out["channel_timing"]["email"]["start"] == "09:00"


def test_compute_push_uses_clicks_not_opens():
    now = _utc(2026, 9, 20, 12)
    rows = [
        {
            "channel": "push",
            "opened_at": _utc(2026, 9, 1, 4),
            "clicked_at": _utc(2026, 9, 1, 15),
        }
        for _ in range(5)
    ]
    out = compute_preference_windows(
        rows, timezone_name="UTC", now=now, min_events=5
    )
    assert out["channel_timing"]["push"]["start"] == "15:00"
    assert "email" not in out.get("channel_timing", {})


def test_fill_missing_does_not_overwrite_stored_timing():
    existing = {
        "timing": {
            "days": ["mon", "tue", "wed", "thu", "fri"],
            "start": "08:00",
            "end": "10:00",
        }
    }
    computed = {
        "timing": {
            "days": ["tue"],
            "start": "15:00",
            "end": "17:00",
        },
        "channel_timing": {
            "email": {"days": ["tue"], "start": "15:00", "end": "17:00"}
        },
    }
    filled = fill_missing_windows(existing, computed)
    assert filled["timing"]["start"] == "08:00"
    assert filled["channel_timing"]["email"]["start"] == "15:00"


def test_lookback_drops_old_events():
    now = _utc(2026, 9, 20, 12)
    old = now - timedelta(days=120)
    rows = [
        {"channel": "email", "opened_at": old, "clicked_at": None}
        for _ in range(8)
    ]
    assert compute_preference_windows(rows, timezone_name="UTC", now=now) == {}
