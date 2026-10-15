from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, unquote, urlparse


class UrlParseError(ValueError):
    error_code = "invalid_url"


@dataclass(frozen=True)
class ParsedMeeting:
    platform: str
    native_meeting_id: str
    passcode: str | None
    meeting_url: str


_MEET_CODE = re.compile(r"^[a-z0-9]{3,4}-[a-z0-9]{4}-[a-z0-9]{3}$", re.I)
_TEAMS_NUMERIC = re.compile(r"^\d{10,15}$")
_SAFELINK = re.compile(r"https?://[^/]*safelinks\.protection\.outlook\.com/", re.I)
_URLDEFENSE = re.compile(r"https?://urldefense(?:\.proofpoint)?\.com/", re.I)


def unwrap_redirect(url: str) -> str:
    raw = url.strip()
    parsed = urlparse(raw)
    qs = parse_qs(parsed.query)
    if _SAFELINK.search(raw) and "url" in qs:
        return unquote(qs["url"][0])
    if _URLDEFENSE.search(raw) and "u" in qs:
        u = qs["u"][0].replace("-3A", ":").replace("_", "/").replace("-2D", "-")
        return u
    return raw


def parse_meeting_url(url: str) -> ParsedMeeting:
    if not url or not url.strip():
        raise UrlParseError("meeting_url is required")
    cleaned = unwrap_redirect(url)
    parsed = urlparse(cleaned)
    host = (parsed.netloc or "").lower()
    path = parsed.path or ""
    qs = parse_qs(parsed.query)

    if "meet.google.com" in host:
        parts = [p for p in path.split("/") if p]
        code = parts[-1] if parts else ""
        if not _MEET_CODE.match(code):
            raise UrlParseError("unrecognized Google Meet code")
        code = code.lower()
        return ParsedMeeting("google_meet", code, None, cleaned)

    if "zoom.us" in host or host.endswith(".zoom.us") or "zoom.com" in host:
        m = re.search(r"/(?:j|wc)/(\d+)", path)
        if not m:
            raise UrlParseError("unrecognized Zoom meeting id")
        native = m.group(1)
        pwd = qs.get("pwd", [None])[0]
        return ParsedMeeting("zoom", native, pwd, cleaned)

    if "teams.microsoft.com" in host or "teams.live.com" in host or "microsoft.us" in host:
        thread = re.search(r"19:meeting_[^/@]+@thread\.v2", cleaned)
        if thread:
            return ParsedMeeting("teams", thread.group(0), None, cleaned)
        numeric = ""
        for key in ("meetingId", "meetingid"):
            if key in qs:
                numeric = qs[key][0]
                break
        if not numeric:
            for part in path.split("/"):
                if _TEAMS_NUMERIC.match(part):
                    numeric = part
                    break
        passcode = None
        for key in ("p", "passcode", "password"):
            if key in qs:
                passcode = qs[key][0]
                break
        if numeric and _TEAMS_NUMERIC.match(numeric):
            return ParsedMeeting("teams", numeric, passcode, cleaned)
        raise UrlParseError("unrecognized Teams meeting id")

    raise UrlParseError("meeting_url must be Google Meet, Zoom, or Teams")
