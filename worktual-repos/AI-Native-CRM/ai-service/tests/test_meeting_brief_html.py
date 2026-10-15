"""Owner pre-brief HTML: pills, empty-section omit, no battlecards."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.agents.meeting_brief_html import (
    header_pill,
    heuristic_brief_doc,
    normalize_brief_doc,
    render_prebrief_html,
)


CTX = {
    "contactName": "Meera Kapoor",
    "companyName": "Bright Horizon Learning",
    "industry": "Education",
    "topic": "Discovery call",
    "whenLabel": "Thu, Sep 3, 2026 · 4:30 PM – 5:00 PM (Asia/Kolkata)",
    "meetingLink": "https://meet.google.com/abc-defg-hij",
    "leadSource": "Website contact form",
    "employeeCount": None,
    "daysSinceInquiry": 2,
    "authority": "Unknown — confirm authority in discovery",
    "contactTitle": None,
}


def _render(parsed: dict, reminder_window: str | None = None) -> str:
    doc = normalize_brief_doc(parsed, CTX, reminder_window)
    return render_prebrief_html(doc, CTX, reminder_window)


def test_renders_org_logo_when_present() -> None:
    ctx = {**CTX, "orgLogoUrl": "https://cdn.example.com/acme.png", "sellerName": "Acme Corp"}
    doc = normalize_brief_doc({"inShort": "Prep notes."}, ctx, None)
    html = render_prebrief_html(doc, ctx, None)
    assert "https://cdn.example.com/acme.png" in html
    assert "Acme Corp" in html


def test_header_pill_reminder_overrides_llm() -> None:
    assert header_pill("24h", "NEW LEAD · FIRST CALL") == "REMINDER · 24 HOURS"
    assert header_pill("1h", "NEW LEAD · FIRST CALL") == "STARTING SOON"
    assert header_pill(None, "QUALIFIED · PREP") == "QUALIFIED · PREP"
    assert header_pill(None, None) == "NEW LEAD · FIRST CALL"


def test_reminder_pill_in_html() -> None:
    html_24 = _render({"headerPill": "NEW LEAD · FIRST CALL"}, "24h")
    html_1h = _render({"headerPill": "NEW LEAD · FIRST CALL"}, "1h")
    html_book = _render({"headerPill": "NEW LEAD · FIRST CALL"}, None)
    assert "REMINDER · 24 HOURS" in html_24
    assert "STARTING SOON" in html_1h
    assert "NEW LEAD · FIRST CALL" in html_book
    assert "REMINDER · 24 HOURS" not in html_book


def test_hides_empty_sections() -> None:
    html = _render(
        {
            "inShort": "",
            "customerQuote": "",
            "weOwe": "",
            "theyOwe": "",
            "risks": [],
            "agenda": [],
            "objections": [],
            "assets": [],
            "carryOver": [],
            "crossChannelHistory": [],
            "accountSnapshot": [],
            "dealState": [],
        }
    )
    assert "ACCOUNT & DEAL INTELLIGENCE" not in html
    assert "PREP & RISKS" not in html
    assert "ANTICIPATED OBJECTIONS" not in html
    assert "ASSETS TO HAVE READY" not in html
    assert "CUSTOMER QUOTE" not in html
    assert "OPEN COMMITMENTS" not in html
    assert "In short:" not in html
    assert "MEETING OVERVIEW" in html
    assert "Join Meeting" in html
    assert "https://meet.google.com/abc-defg-hij" in html


def test_renders_coaching_sections_when_present() -> None:
    html = _render(
        {
            "inShort": "Use this call to build on the Zendesk question.",
            "customerQuote": "Does this integrate with Zendesk?",
            "weOwe": "Zendesk answer",
            "theyOwe": "Team size",
            "risks": ["Authority unconfirmed"],
            "agenda": ["Open with Zendesk", "Confirm timeline"],
            "whyThisOrder": "She already asked this over email.",
            "objections": [
                {
                    "objection": "We're just researching.",
                    "response": "Move from research to a scoped eval.",
                }
            ],
            "assets": ["Overview deck", "Discovery questions"],
            "accountSnapshot": [
                {"label": "Company", "value": "Bright Horizon Learning"},
            ],
        }
    )
    assert "Use this call to build on the Zendesk question." in html
    assert "Does this integrate with Zendesk?" in html
    assert "We owe:" in html
    assert "They owe:" in html
    assert "Authority unconfirmed" in html
    assert "PREP & RISKS" in html or "PREP &amp; RISKS" in html
    assert "Why this order:" in html
    assert "Overview deck" in html
    assert "battlecard" not in html.lower()


def test_drops_battlecard_objections() -> None:
    html = _render(
        {
            "objections": [
                {
                    "objection": "We're researching.",
                    "response": "[Link to battlecard: Early-stage / research mode]",
                },
                {
                    "objection": "I don't decide.",
                    "response": "Ask who else is involved.",
                },
            ]
        }
    )
    assert "battlecard" not in html.lower()
    assert "I don" in html
    assert "Ask who else is involved." in html


def test_escapes_html_in_quote() -> None:
    html = _render({"customerQuote": '<script>alert("x")</script>'})
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_rejects_non_http_join_link() -> None:
    ctx = {**CTX, "meetingLink": "javascript:alert(1)"}
    doc = normalize_brief_doc({}, ctx, None)
    html = render_prebrief_html(doc, ctx, None)
    assert "javascript:" not in html
    assert "Join Meeting" not in html


def test_heuristic_omits_coaching_without_facts() -> None:
    doc = heuristic_brief_doc(CTX, None, None)
    html = render_prebrief_html(doc, CTX, None)
    assert "WORKTUAL" in html
    assert "ANTICIPATED OBJECTIONS" not in html
    assert "ASSETS TO HAVE READY" not in html
    assert "Bright Horizon Learning" in html
    assert "Days since inquiry" in html or "DEAL STATE" in html


@pytest.mark.asyncio
async def test_owner_run_heuristic_returns_html() -> None:
    from unittest.mock import patch

    from app.agents.meeting_brief_agent import run

    with patch("app.agents.meeting_brief_agent.is_ai_configured", return_value=False):
        result = await run(
            "act-1",
            context=CTX,
            audience="owner",
            reminder_window="24h",
        )
    assert result["ok"] is True
    assert "WORKTUAL" in (result.get("body") or "")
    assert "REMINDER · 24 HOURS" in (result.get("body") or "")
    assert "Join Meeting" in (result.get("body") or "")
