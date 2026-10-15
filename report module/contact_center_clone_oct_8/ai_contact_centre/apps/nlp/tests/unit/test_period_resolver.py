from datetime import date

from app.services.period_resolver import (
    apply_spoken_period,
    resolve_compare_periods,
    resolve_query_period,
)

TODAY = date(2026, 9, 5)


def test_named_calendar_day_overrides_page_30d() -> None:
    resolved = resolve_query_period(
        "august 20 handled conversations",
        page_start="2026-08-07",
        page_end="2026-09-05",
        page_range="30d",
        today=TODAY,
    )
    assert resolved.spoken is True
    assert resolved.start == "2026-08-20"
    assert resolved.end == "2026-08-20"


def test_aug_4_and_relative_windows() -> None:
    assert resolve_query_period("aug 4 chat count", today=TODAY).start == "2026-08-04"
    assert resolve_query_period("yesterday handled volume", today=TODAY).start == "2026-09-04"
    assert resolve_query_period("how many conversations today", today=TODAY).start == "2026-09-05"
    week = resolve_query_period("this week resolution rate", today=TODAY)
    assert week.start == "2026-08-31"
    assert week.end == "2026-09-05"
    last7 = resolve_query_period("last 7 days conversations handled", today=TODAY)
    assert last7.start == "2026-08-30"
    assert last7.end == "2026-09-05"
    last5 = resolve_query_period("webchat count for the last 5 days", today=TODAY)
    assert last5.start == "2026-09-01"
    assert last5.end == "2026-09-05"


def test_page_period_used_when_question_has_no_date() -> None:
    resolved = resolve_query_period(
        "average handle time",
        page_start="2026-08-07",
        page_end="2026-09-05",
        page_range="30d",
        today=TODAY,
    )
    assert resolved.spoken is False
    assert resolved.start == "2026-08-07"
    assert resolved.end == "2026-09-05"


def test_apply_spoken_period_clears_page_range() -> None:
    extra = {"range": "30d", "start": "2026-08-07", "end": "2026-09-05"}
    apply_spoken_period(extra, "september 2 handled", today=TODAY)
    assert extra["start"] == "2026-09-02"
    assert extra["end"] == "2026-09-02"
    assert extra["range"] is None
    assert extra["period_source"] == "spoken"


def test_compare_two_named_days() -> None:
    compared = resolve_compare_periods(
        "yesterday versus today handled volume",
        today=TODAY,
    )
    assert compared is not None
    assert [period.start for period in compared] == ["2026-09-04", "2026-09-05"]

    sept = resolve_compare_periods(
        "september 2 handled and yesterday handled",
        today=TODAY,
    )
    assert sept is not None
    assert [period.start for period in sept] == ["2026-09-02", "2026-09-04"]

    assert resolve_compare_periods(
        "last week handled volume and resolution rate",
        today=TODAY,
    ) is None

    extra = {"range": "30d", "start": "2026-08-07", "end": "2026-09-05"}
    apply_spoken_period(extra, "yesterday versus today handled volume", today=TODAY)
    assert extra["compare_periods"][0]["start"] == "2026-09-04"
    assert extra["compare_periods"][1]["start"] == "2026-09-05"
    assert "vs" in extra["period_label"]
