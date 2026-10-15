"""Sales guide CTA is clamped to the operations this contact can start."""

from app.agents.sales_guide_agent import clamp_guide


def test_guide_keeps_email_when_the_interaction_needs_a_reply():
    guide = clamp_guide(
        {
            "suggestions": [
                "Yaswanth replied by email about high-volume telecom support.",
                "Ask what is breaking in the current setup before sending a quote.",
            ],
            "nextBestAction": {
                "title": "Reply to the telecom support email",
                "detail": "Answer the pain points he raised and offer a short call.",
                "dueInDays": 1,
            },
            "action": {
                "kind": "email",
                "subject": "Re: Managing high-volume telecom support",
                "message": "Hi Yaswanth, I saw your note on support volume.",
                "dueInDays": 1,
            },
            "disposition": {"status": "new", "reason": "ignored"},
        },
        {"email", "call", "meeting", "task", "note"},
    )
    assert guide["action"]["kind"] == "email"
    assert "disposition" not in guide
    assert guide["suggestions"][0].startswith("Yaswanth replied")


def test_guide_drops_a_quote_when_there_is_no_deal():
    guide = clamp_guide(
        {
            "suggestions": ["They asked for pricing."],
            "nextBestAction": {"title": "Send pricing", "detail": "Prepare a quote."},
            "action": {"kind": "quote", "subject": "", "message": ""},
        },
        {"email", "meeting", "task", "note"},
    )
    assert guide["action"] is None


def test_guide_drops_an_email_with_no_message():
    guide = clamp_guide(
        {
            "suggestions": ["They wrote in."],
            "nextBestAction": {"title": "Reply", "detail": "Answer the question."},
            "action": {"kind": "email", "subject": "Hello", "message": ""},
        },
        {"email", "task"},
    )
    assert guide["action"] is None
