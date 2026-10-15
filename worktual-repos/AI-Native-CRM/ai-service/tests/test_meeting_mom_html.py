"""Customer MOM HTML: empty-section omit, table, no invented dates."""

from __future__ import annotations

from app.agents.meeting_mom_html import (
    normalize_customer_mom,
    normalize_internal_mom,
    render_customer_mom_html,
    render_internal_mom_html,
)

META = {
    "contactName": "Meera Kapoor",
    "companyName": "Bright Horizon Learning",
    "topic": "Product Demonstration",
    "whenLabel": "Thu, Sep 3, 2026",
    "ownerName": "Mohammed Sha",
    "sellerName": "Worktual",
}


def _html(parsed: dict) -> str:
    doc = normalize_customer_mom(parsed, META)
    return render_customer_mom_html(doc)


def test_header_and_footer() -> None:
    html = _html({"customerEmail": {"subject": "Minutes of Meeting — Demo"}})
    assert "WORKTUAL" in html
    assert "Meeting Summary" in html
    assert "Minutes of Meeting — Product Demonstration" in html
    assert "Worktual · Minutes of Meeting" in html
    assert "Mohammed Sha — Sales Representative, Worktual" in html
    assert "Meera Kapoor" in html


def test_hides_empty_sections() -> None:
    html = _html(
        {
            "customerEmail": {
                "subject": "MOM",
                "title": "Minutes of Meeting — Demo",
                "objective": "",
                "sections": [],
                "nextStepsWorktual": [],
                "nextStepsClient": [],
                "actionItems": [],
                "participants": [],
            },
            "discussionTopics": [],
            "keyDetails": [],
            "actionItems": [],
        }
    )
    assert "Meeting objective:" not in html
    assert "KEY FEATURES" not in html
    assert "Next Steps" not in html
    assert "Action Items" not in html
    # Seeded attendees still render from CRM meta when LLM omits them.
    assert "KEY PARTICIPANTS" in html


def test_product_section_shows_key_features() -> None:
    html = _html(
        {
            "customerEmail": {
                "subject": "MOM",
                "objective": "Walk through AICC and chatbot fit.",
                "sections": [
                    {
                        "heading": "Business Requirement Discussion",
                        "description": "",
                        "bullets": ["Need multilingual student support"],
                    },
                    {
                        "heading": "AI Contact Center (AICC)",
                        "description": "Inbound engagement platform.",
                        "bullets": ["Omnichannel routing"],
                    },
                ],
                "nextStepsWorktual": ["Schedule a follow-up demo"],
                "nextStepsClient": ["Arrange Vijay's participation"],
                "actionItems": [
                    {
                        "action": "Schedule follow-up demo",
                        "owner": "Worktual Team",
                        "dueDate": "",
                    }
                ],
            }
        }
    )
    assert "Walk through AICC and chatbot fit." in html
    assert "1. Business Requirement Discussion" in html
    assert "KEY FEATURES" in html
    assert "2. AI Contact Center (AICC)" in html
    assert "ACTIONS & NEXT STEPS" in html or "ACTIONS" in html
    assert "ACTION" in html
    assert "Schedule follow-up demo" in html
    assert "[Date]" not in html


def test_placeholder_due_dates_become_dash() -> None:
    doc = normalize_customer_mom(
        {
            "customerEmail": {
                "actionItems": [
                    {"action": "Send recap", "owner": "Worktual Team", "dueDate": "[Date]"}
                ]
            }
        },
        META,
    )
    assert doc["actionItems"][0]["dueDate"] == "—"


def test_escapes_html() -> None:
    html = _html(
        {
            "customerEmail": {
                "objective": '<script>alert("x")</script>',
                "sections": [{"heading": "Notes", "bullets": ["<b>bold</b>"]}],
            }
        }
    )
    assert "<script>" not in html
    assert "&lt;script&gt;" in html
    assert "&lt;b&gt;" in html


def test_discussion_fallback_from_internal_topics() -> None:
    html = _html(
        {
            "discussionTopics": ["Pricing and timeline"],
            "customerEmail": {"subject": "MOM"},
        }
    )
    assert "Discussion" in html
    assert "Pricing and timeline" in html


def test_internal_mom_template() -> None:
    mom = {
        "executiveSummary": "Discussed Zendesk integration and multilingual support.",
        "sentiment": "Positive",
        "discussionTopics": ["Multilingual student support", "Zendesk workflow"],
        "decisions": ["Send evaluation plan"],
        "actionItems": [
            {
                "action": "Share scoped evaluation plan",
                "owner": "Mohammed Sha",
                "dueDate": "",
            },
            {
                "action": "Schedule follow-up demo",
                "owner": "Worktual Team",
                "dueDate": "",
            },
        ],
        "objections": ["Timeline uncertainty"],
        "nextSteps": ["Include IT lead Vijay"],
        "risks": ["Campus rollout dependency"],
        "nextBestAction": "Share scoped evaluation plan",
    }
    doc = normalize_internal_mom(
        mom,
        META,
        transcript_excerpt="Customer asked for written summary.",
        contact_href="https://crm.example.com/contact/abc",
        meet_link="https://meet.google.com/xyz",
    )
    html = render_internal_mom_html(doc)
    assert "INTERNAL · MINUTES OF MEETING" in html
    assert "MEETING OVERVIEW" in html
    assert "Multilingual student support" in html
    assert "Timeline uncertainty" in html
    assert "Share scoped evaluation plan" in html
    assert "Mohammed Sha" in html
    assert "Customer asked for written summary." in html
    assert "Open contact in CRM" in html
    assert "Confidential — do not forward externally." in html
    assert "NEXT BEST ACTION" in html
