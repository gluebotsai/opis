"""Approved WA chat HTML helpers."""

from app.agents.whatsapp_approved.user_facing import (
    fact_reply_from_wa_tools,
    finalize_wa_user_reply,
)


def test_fact_reply_from_launch_tool():
    html = fact_reply_from_wa_tools(
        [
            (
                "LAUNCH_APPROVED_CAMPAIGN",
                {
                    "ok": True,
                    "user_message": "<p>Approved WhatsApp campaign launched.</p>",
                },
            )
        ]
    )
    assert "launched" in html.lower()


def test_finalize_repairs_escaped_sample_link():
    escaped = (
        '<p>&lt;a href="https://example.com/api/public/temporary-contact-template.csv" '
        'target="_blank" download="temporary-contact-template.csv"&gt;Download sample sheet&lt;/a&gt;</p>'
    )
    out = finalize_wa_user_reply(escaped)
    assert "&lt;a" not in out
    assert "temporary-contact-template.csv" in out
    assert "Download sample sheet" in out
