"""Lead summary must ground on enrichment company profile + products."""

from __future__ import annotations

from app.agents.summarize_lead_agent import (
    _build_facts,
    _clamp_overview,
    clamp_summary_lines,
)


def test_summary_facts_include_company_what_they_do_and_products():
    facts = "\n".join(
        _build_facts(
            {
                "displayName": "Sivaji R",
                "title": "Product Manager",
                "companyName": "Zendesk",
                "industry": "Customer support software",
                "companyDescription": (
                    "Zendesk builds customer service and engagement software "
                    "used by support and CX teams."
                ),
                "products": "Zendesk Support; Zendesk Chat; Zendesk Talk",
                "employeeCount": 5000,
                "bant": {},
                "activities": [],
                "deals": [],
            }
        )
    )
    assert "What the company does: Zendesk builds customer service" in facts
    assert "Their products: Zendesk Support; Zendesk Chat; Zendesk Talk" in facts
    assert "Company: Zendesk" in facts
    assert "Sivaji R" in facts


def test_summary_lines_keep_only_real_sources():
    ctx = {
        "activities": [
            {"id": "act-email", "type": "email", "subject": "Pricing"},
            {"id": "act-note", "type": "note", "subject": "Internal"},
        ],
        "omniChannelSummary": "Asked about AI CCaaS in conversationId 1112.",
    }
    lines = clamp_summary_lines(
        [
            {"text": "Asked for pricing.", "sourceKind": "activity", "sourceId": "act-email"},
            {"text": "Invented a call.", "sourceKind": "activity", "sourceId": "missing"},
            {"text": "A note is not a channel.", "sourceKind": "activity", "sourceId": "act-note"},
            {
                "text": "Asked about AI CCaaS.",
                "sourceKind": "omni",
                "conversationId": "1112",
            },
            {
                "text": "Bad conversation id.",
                "sourceKind": "omni",
                "conversationId": "9999",
            },
        ],
        ctx,
    )
    assert [line["sourceId"] for line in lines] == ["act-email", None, None]
    assert lines[1]["conversationId"] is None
    assert lines[2]["conversationId"] is None
    assert "1112" not in lines[1]["text"]
    cleaned = clamp_summary_lines(
        [
            {
                "text": (
                    "Asked about AI CCaaS. "
                    '<a href="https://example.com/thread">open</a> '
                    "conversationId 1112 CDP-webchat-org1003-visitor_abc"
                ),
                "sourceKind": "omni",
            }
        ],
        ctx,
    )
    assert cleaned[0]["text"] == "Asked about AI CCaaS. open"
    assert "http" not in cleaned[0]["text"]
    assert "<" not in cleaned[0]["text"]
    assert "CDP-" not in cleaned[0]["text"]


def test_activity_lines_drop_pasted_email_and_calendar():
    ctx = {
        "activities": [
            {"id": "act-email", "type": "email", "subject": "Exclusive"},
            {"id": "act-meet", "type": "meeting", "subject": "Initial demo"},
        ],
    }
    lines = clamp_summary_lines(
        [
            {
                "text": (
                    "<!DOCTYPE html><html><title>Exclusive</title> "
                    "From: bot@worktual.com To: ashika@gmail.com Hi Ashika"
                ),
                "sourceKind": "activity",
                "sourceId": "act-email",
            },
            {
                "text": "Join https://meet.google.com/abc-defg-hij eid=abc123",
                "sourceKind": "activity",
                "sourceId": "act-meet",
            },
            {
                "text": "Ashika asked by email for a product demo.",
                "sourceKind": "activity",
                "sourceId": "act-email",
            },
        ],
        ctx,
    )
    assert [line["text"] for line in lines] == [
        "Ashika asked by email for a product demo."
    ]


def test_facts_strip_html_and_links_from_activity_bodies():
    facts = "\n".join(
        _build_facts(
            {
                "displayName": "Ashika",
                "bant": {},
                "deals": [],
                "activities": [
                    {
                        "id": "1",
                        "type": "email",
                        "subject": "Offer",
                        "body": "<html><a href='https://meet.google.com/x'>Join</a> bot@x.com",
                    }
                ],
            }
        )
    )
    assert "<html" not in facts.lower()
    assert "meet.google" not in facts
    assert "bot@x.com" not in facts


def test_overview_keeps_five_engagement_lines():
    text = _clamp_overview(
        "Opened the offer.\n"
        "Replied asking for quote approval.\n"
        "Has not answered the next email.\n"
        "Called once about the commercial terms.\n"
        "Asked to see the proposal before deciding.\n"
        "Sixth line is dropped.\n"
        "Email: someone@example.com"
    )
    assert text.count("\n") == 4
    assert "Sixth line" not in text
    assert text.startswith("Opened the offer.")
