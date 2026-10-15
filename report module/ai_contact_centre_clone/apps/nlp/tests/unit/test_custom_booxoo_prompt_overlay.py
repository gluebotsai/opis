"""Channel overlay tests for custom_booxoo_bot."""

from app.agents.custom_booxoo_bot.prompt_overlay import (
    apply_channel_overlay,
    build_channel_overlay,
)


def test_build_channel_overlay_for_instagram() -> None:
    overlay = build_channel_overlay("instagram")
    assert "Instagram" in overlay
    assert "under 3 short paragraphs" in overlay


def test_build_channel_overlay_for_whatsapp() -> None:
    overlay = build_channel_overlay("whatsapp")
    assert "WhatsApp" in overlay
    assert "plain text" in overlay.lower()


def test_webchat_overlay_asks_for_html_not_markdown() -> None:
    overlay = build_channel_overlay("webchat")
    assert "<p>" in overlay
    assert "<b>" in overlay
    assert "markdown" in overlay.lower()
    rendered = apply_channel_overlay("Base prompt", "webchat")
    assert rendered.startswith("Base prompt")
    assert "WEBCHAT CHANNEL" in rendered


def test_email_overlay_uses_subject_and_skips_social_length_rules() -> None:
    overlay = build_channel_overlay("email")
    assert "subject" in overlay.lower()
    assert "under 3 short paragraphs" not in overlay
    rendered = apply_channel_overlay("Base prompt", "email")
    assert rendered.startswith("Base prompt")
    assert "EMAIL CHANNEL" in rendered
