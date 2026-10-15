from datetime import datetime, timezone
from app.agents.reports_b2b.core.time import resolve_time_window, resolve_expression

def test_resolve_this_month():
    as_of = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)
    start, end = resolve_time_window("this_month", as_of)
    assert start == datetime(2026, 9, 1, 0, 0, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 10, 1, 0, 0, 0, tzinfo=timezone.utc)

def test_resolve_last_7_days():
    as_of = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)
    start, end = resolve_time_window("last 7 days", as_of)
    assert start is not None and end is not None
    assert (end - start).days >= 7


def test_resolve_custom_iso_range():
    tb = resolve_expression("2026-09-01 to 2026-09-15")
    assert tb.status == "bounded"
    assert tb.start.isoformat().startswith("2026-09-01")
    assert tb.end.isoformat().startswith("2026-09-16")


def test_resolve_one_day_alias():
    as_of = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)
    tb = resolve_expression("1 day", now=as_of)
    assert tb.status == "bounded"

def test_resolve_all_time():
    start, end = resolve_time_window("all_time")
    assert start is None
    assert end is None

def test_resolve_expression_named_tuple():
    tb = resolve_expression("this_month")
    assert tb.start is not None
    assert tb.end is not None
    assert "this month" in tb.echo
