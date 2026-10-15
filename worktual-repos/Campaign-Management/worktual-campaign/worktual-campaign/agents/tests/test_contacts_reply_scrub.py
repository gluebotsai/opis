"""User-visible reply must not echo internal tool/nudge wording."""

from app.agents.contacts.agent import _scrub_internal_leak_from_reply


def test_scrub_leaky_reply_strips_tool_names():
    raw = (
        "I understand. I'll sync any new details to the panel and use the "
        "contact lookup tool as we go. What would you like to do next?"
    )
    out = _scrub_internal_leak_from_reply(raw)
    assert "lookup tool" not in out.lower()
    assert "panel" not in out.lower() or "tell me" in out.lower()


def test_scrub_clean_reply_unchanged():
    text = "No problem — we can change the email or skip company. What next?"
    assert _scrub_internal_leak_from_reply(text) == text
