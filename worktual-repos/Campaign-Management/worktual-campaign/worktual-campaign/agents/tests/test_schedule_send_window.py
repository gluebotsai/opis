"""Permanent schedule timing: clock fields must not be discarded as 'now'."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.agents.create_campaign.schedule_agent import (
    _from_iso,
    resolve_send_window,
)
from app.agents.create_campaign.tool_functions import (
    _coerce_schedule_mode,
    _launch_plan_timing_from_args,
)


def test_coerce_schedule_mode_forces_at_when_local_time_present():
    assert (
        _coerce_schedule_mode(
            "now",
            launch_local_date="2026-09-15",
            launch_local_time="12:30",
        )
        == "at"
    )
    assert (
        _coerce_schedule_mode(
            None,
            scheduled_at="2026-09-15T12:30:00",
        )
        == "at"
    )
    assert (
        _coerce_schedule_mode(
            "now",
            scheduled_at="2026-09-15T12:30:00+00:00",
        )
        == "now"
    )
    assert _coerce_schedule_mode("now") == "now"
    assert _coerce_schedule_mode("at") == "at"


def test_launch_now_does_not_inherit_prior_clock():
    mode, date, time, iso = _launch_plan_timing_from_args(
        {"schedule_mode": "now"},
        {
            "schedule_mode": "now",
            "launch_local_date": "2026-09-25",
            "launch_local_time": "11:56",
            "scheduled_at": "2026-09-25T06:26:00+00:00",
        },
    )
    assert mode == "now"
    assert date is None
    assert time is None
    assert iso is None


def test_launch_at_keeps_named_clock_this_turn():
    mode, date, time, iso = _launch_plan_timing_from_args(
        {
            "schedule_mode": "at",
            "launch_local_date": "2026-09-26",
            "launch_local_time": "12:05",
        },
        {
            "launch_local_date": "2026-09-25",
            "launch_local_time": "11:56",
        },
    )
    assert mode == "at"
    assert date == "2026-09-26"
    assert time == "12:05"
    assert iso is None


def test_from_iso_naive_is_campaign_local_not_utc():
    dt = _from_iso("2026-09-15T12:30:00", "Asia/Kolkata")
    assert dt is not None
    assert dt.tzinfo is not None
    assert dt.hour == 12
    assert dt.minute == 30
    # Same wall clock in Kolkata, not shifted as if the string were UTC.
    assert dt.astimezone(ZoneInfo("Asia/Kolkata")).strftime("%H:%M") == "12:30"


def test_from_iso_zulu_stays_absolute():
    dt = _from_iso("2026-09-15T07:00:00Z", "Asia/Kolkata")
    assert dt is not None
    # 07:00 UTC → 12:30 IST
    assert dt.strftime("%H:%M") == "12:30"


def test_prefer_now_does_not_drop_explicit_local_clock():
    tz = ZoneInfo("Asia/Kolkata")
    future = datetime.now(tz) + timedelta(hours=3)
    local_date = future.strftime("%Y-%m-%d")
    local_time = future.strftime("%H:%M")
    window = resolve_send_window(
        timezone_name="Asia/Kolkata",
        local_date=local_date,
        local_time=local_time,
        prefer_now=True,
        honor_explicit=True,
        consumer_hours=True,
    )
    assert window.local_time == local_time
    assert window.local_date == local_date
    assert "selected time" in window.reason


def test_schedule_mode_now_without_clock_is_immediate():
    window = resolve_send_window(
        timezone_name="Asia/Kolkata",
        prefer_now=True,
        honor_explicit=True,
        consumer_hours=True,
    )
    now = datetime.now(ZoneInfo("Asia/Kolkata")).replace(second=0, microsecond=0)
    assert window.local_date == now.strftime("%Y-%m-%d")
    assert window.local_time == now.strftime("%H:%M")
    assert "launching now" in window.reason
