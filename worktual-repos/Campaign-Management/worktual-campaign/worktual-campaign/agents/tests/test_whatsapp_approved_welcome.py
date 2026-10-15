"""Approved WA join welcome — generic variants, no template name in chat."""

from app.agents.whatsapp_approved.prompts import _WELCOME_VARIANTS, welcome_text


def test_welcome_is_generic_variant():
    msg = welcome_text("hello_world", "My Campaign")
    assert msg in _WELCOME_VARIANTS
    assert "hello_world" not in msg.lower()
    assert "My Campaign" not in msg


def test_welcome_mentions_audience_options():
    for variant in _WELCOME_VARIANTS:
        lower = variant.lower()
        assert "crm" in lower or "audience" in lower or "who" in lower
