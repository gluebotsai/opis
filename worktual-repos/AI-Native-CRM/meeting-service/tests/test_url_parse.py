from urllib.parse import quote

import pytest

from app.services.url_parse import UrlParseError, parse_meeting_url


def test_parse_google_meet():
    m = parse_meeting_url("https://meet.google.com/abc-defg-hij")
    assert m.platform == "google_meet"
    assert m.native_meeting_id == "abc-defg-hij"
    assert m.passcode is None


def test_parse_google_meet_four_letter_prefix():
    m = parse_meeting_url("https://meet.google.com/vcsp-kdoe-xjw")
    assert m.native_meeting_id == "vcsp-kdoe-xjw"


def test_parse_zoom_passcode():
    z = parse_meeting_url("https://zoom.us/j/81234567890?pwd=secret")
    assert z.platform == "zoom"
    assert z.native_meeting_id == "81234567890"
    assert z.passcode == "secret"


def test_parse_teams_thread():
    t = parse_meeting_url("https://teams.microsoft.com/l/meetup-join/19:meeting_abc@thread.v2/0")
    assert t.platform == "teams"
    assert "19:meeting_abc@thread.v2" in t.native_meeting_id


def test_parse_teams_numeric_passcode():
    t = parse_meeting_url("https://teams.microsoft.com/meet/12345678901?p=pass123")
    assert t.platform == "teams"
    assert t.native_meeting_id == "12345678901"
    assert t.passcode == "pass123"


def test_safelink_unwrap():
    inner = quote("https://meet.google.com/abc-defg-hij", safe="")
    wrapped = f"https://nam.safelinks.protection.outlook.com/?url={inner}"
    m = parse_meeting_url(wrapped)
    assert m.native_meeting_id == "abc-defg-hij"


def test_invalid_url():
    with pytest.raises(UrlParseError):
        parse_meeting_url("https://example.com/not-a-meeting")
