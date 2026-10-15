from datetime import datetime
from zoneinfo import ZoneInfo

from app.agents.org_clock import format_local_now, local_now_line, zone_for_location


def test_india_uses_kolkata_day_first_clock():
    zone = zone_for_location("India")
    assert zone == "Asia/Kolkata"
    stamp = format_local_now(
        zone,
        when=datetime(2026, 10, 2, 4, 46, tzinfo=ZoneInfo("UTC")),
    )
    assert stamp == "Friday, 2 October 2026, 10:16 AM IST (Asia/Kolkata)"


def test_us_city_in_billing_address_picks_pacific_month_first():
    zone = zone_for_location("United States", "100 Market St, San Francisco, CA")
    assert zone == "America/Los_Angeles"
    stamp = format_local_now(
        zone,
        when=datetime(2026, 10, 2, 17, 16, tzinfo=ZoneInfo("UTC")),
    )
    assert stamp == "Friday, October 2, 2026, 10:16 AM PDT (America/Los_Angeles)"


def test_explicit_timezone_wins_over_country():
    assert zone_for_location("India", explicit_zone="Europe/London") == "Europe/London"


def test_prompt_line_uses_organization_country():
    line = local_now_line({"organizationCountry": "United Kingdom"})
    assert line.startswith("- now=")
    assert "Europe/London" in line
    assert "United Kingdom" in line


def test_system_prompt_includes_org_clock():
    from app.agents.crm_tools import build_system_prompt

    prompt = build_system_prompt(
        "sales",
        "create",
        {"pathname": "/sales/new", "organizationCountry": "India"},
    )
    assert "now=" in prompt
    assert "Asia/Kolkata" in prompt
    assert prompt.index("now=") < prompt.index("nameRule=")
