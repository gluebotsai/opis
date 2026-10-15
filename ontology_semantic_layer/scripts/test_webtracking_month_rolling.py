#!/usr/bin/env python3
"""Webtracking month rolling flag + ticketing calendar month unchanged."""

from __future__ import annotations

import os
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from semantic.time_resolver import (  # noqa: E402
    WEBTRACKING_MONTH_ALIASES,
    _today,
    apply_webtracking_month_rolling,
    resolve_time_window,
    webtracking_month_rolling_enabled,
)


def test_calendar_today_defaults_to_utc_not_host() -> None:
    os.environ.pop("SEMANTIC_CALENDAR_TZ", None)
    # Force a host-local offset that differs from UTC when possible; still assert
    # _today() matches UTC calendar date (pinned default).
    from datetime import datetime, timezone

    assert _today() == datetime.now(timezone.utc).date()


def test_current_month_is_calendar_without_flag() -> None:
    os.environ.pop("WEBTRACKING_MONTH_ROLLING", None)
    today = _today()
    got = resolve_time_window({"period": "current_month"})
    assert got["start"] == date(today.year, today.month, 1).isoformat()
    assert got["end"] == today.isoformat()


def test_webtracking_month_aliases_roll_when_flag_on() -> None:
    os.environ["WEBTRACKING_MONTH_ROLLING"] = "1"
    assert webtracking_month_rolling_enabled()
    expected = resolve_time_window({"period": "last_30_days"})
    for alias in sorted(WEBTRACKING_MONTH_ALIASES):
        rewritten = apply_webtracking_month_rolling({"period": alias})
        final = resolve_time_window(rewritten)
        assert final["start"] == expected["start"], alias
        assert final["end"] == expected["end"], alias
    os.environ.pop("WEBTRACKING_MONTH_ROLLING", None)


def test_webtracking_month_unchanged_when_flag_off() -> None:
    os.environ.pop("WEBTRACKING_MONTH_ROLLING", None)
    cal = resolve_time_window({"period": "month"})
    rewritten = apply_webtracking_month_rolling({"period": "month"})
    assert rewritten.get("period") == "month"
    assert resolve_time_window(rewritten) == cal


def test_ticketing_month_stays_calendar_even_if_flag_on() -> None:
    """Ticketing must call resolve_time_window only — never apply_webtracking_month_rolling."""
    os.environ["WEBTRACKING_MONTH_ROLLING"] = "1"
    today = _today()
    ticketing = resolve_time_window({"period": "month"})
    assert ticketing["start"] == date(today.year, today.month, 1).isoformat()
    assert ticketing["end"] == today.isoformat()
    # Rolling bounds differ from calendar on any day after the 1st (usually).
    rolling = resolve_time_window({"period": "last_30_days"})
    if today.day > 1:
        assert ticketing["start"] != rolling["start"]
    os.environ.pop("WEBTRACKING_MONTH_ROLLING", None)


if __name__ == "__main__":
    test_calendar_today_defaults_to_utc_not_host()
    test_current_month_is_calendar_without_flag()
    test_webtracking_month_aliases_roll_when_flag_on()
    test_webtracking_month_unchanged_when_flag_off()
    test_ticketing_month_stays_calendar_even_if_flag_on()
    print("OK: webtracking month rolling tests passed")
