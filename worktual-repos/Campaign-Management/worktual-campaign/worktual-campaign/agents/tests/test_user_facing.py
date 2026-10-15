"""User-facing reply sanitization — no internal tool text in chat."""

from __future__ import annotations

import re

from app.agents.create_campaign.user_facing import (
    looks_like_inline_template_html,
    looks_like_internal_reply,
    sanitize_user_facing_reply,
    strip_inline_template_from_reply,
    tool_result_for_llm,
)


def test_looks_like_internal_reply_catches_channel_guard() -> None:
    text = (
        "Save meta and channels in separate tool calls unless the user gave "
        "both in one message. This turn: save meta only (no channels), ask "
        "which channels in your reply."
    )
    assert looks_like_internal_reply(text)


def test_looks_like_internal_orchestration_leak() -> None:
    text = (
        'Soft design/audience/orchestration notes (launch not blocked) '
        '2 messaging channels. Orchestration "prefer_primary". '
        'To launch_channels=["email"].'
    )
    assert looks_like_internal_reply(text)
    out = sanitize_user_facing_reply(text)
    assert "prefer_primary" not in out.lower()
    assert "launch_channels" not in out.lower()
    assert "<p>" in out


def test_sanitize_replaces_internal_channel_text() -> None:
    raw = (
        "Save meta and channels in separate tool calls unless the user gave "
        "both in one message."
    )
    out = sanitize_user_facing_reply(raw)
    assert "separate tool calls" not in out.lower()
    assert "<p>" in out


def test_tool_result_for_llm_strips_internal_message() -> None:
    payload = {
        "ok": False,
        "error": "channels_with_meta",
        "message": "Save meta and channels in separate tool calls.",
        "user_message": "<p>Email noted.</p>",
    }
    llm = tool_result_for_llm(payload)
    assert "message" not in llm
    assert "agent_instruction" in llm
    assert llm["user_message"] == "<p>Email noted.</p>"


def test_strip_inline_template_html() -> None:
    raw = (
        "<p>Here is your email:</p>"
        "<div style='background:#f5f5f5'>"
        "<h1>Wishing You a Blessed Vinayaka Chavithi!</h1>"
        "<p>Dear {{first_name}},</p>"
        "<table><tr><td>Special Festive Offer</td></tr></table>"
        "<p>Explore Festive Joy</p></div>"
    )
    assert looks_like_inline_template_html(raw)
    out = strip_inline_template_from_reply(raw)
    assert "vinayaka" not in out.lower()
    assert "dear {{first_name}}" not in out.lower()
    assert "view" in out.lower()
    assert "generate" in out.lower() or "regenerate" in out.lower()
    assert "template is ready" not in out.lower()
    assert "doesn't belong" not in out.lower()


def test_audience_options_table_not_claimed_as_template_ready() -> None:
    """Regression: mail-alone reply with audience <table> must keep asking who receives.

    Previously len>450 + <table triggered strip_inline_template and rewrote the
    bubble to 'Your template is ready' with no build_campaign / no cards.
    """
    raw = (
        "<p>✅ <strong>Email</strong> confirmed as your channel.</p>"
        "<p>Now — <strong>who should receive this email?</strong> Here are your options:</p>"
        "<table><tr><th>Option</th><th>Details</th></tr>"
        "<tr><td>All contacts</td><td>353 total (248 with email)</td></tr>"
        "<tr><td>By city</td><td>Filter your CRM audience</td></tr>"
        "<tr><td>Named people</td><td>Give emails and I'll look them up</td></tr>"
        "<tr><td>Upload sheet</td><td>Temporary contacts for this send</td></tr>"
        "</table>"
        "<p>Which option should we use?</p>"
    )
    assert not looks_like_inline_template_html(raw)
    out = sanitize_user_facing_reply(raw)
    assert "template is ready" not in out.lower()
    assert "who should receive" in out.lower() or "option" in out.lower()
    assert "<table>" in out.lower()


def test_sanitize_image_tool_leak() -> None:
    raw = "Call ENHANCE_IMAGE_PROMPT first — raw user chat cannot reach the image API."
    out = sanitize_user_facing_reply(raw)
    assert "enhance_image" not in out.lower()
    assert "<p>" in out


def test_edit_space_reply_is_plain_text() -> None:
    from app.agents.create_campaign.user_facing import edit_space_reply

    out = edit_space_reply(
        "<p>I'm working on the hero image for your template — check the live preview.</p>"
    )
    assert "<p>" not in out
    assert "hero image" in out.lower()


def test_generate_media_save_failure_is_not_chat_upload_copy() -> None:
    from app.agents.create_campaign.user_facing import user_facing_image_failure

    raw = "Media upload failed for all hosts (http://127.0.0.1:3001/api): ConnectionError"
    out = user_facing_image_failure(raw, kind="generate")
    assert "campaign media" in out.lower()
    assert out.lower().count("image upload failed") == 0
    upload = user_facing_image_failure(raw, kind="upload")
    assert "try again" in upload.lower()


def test_bare_sheet_url_rewritten_to_hypertext() -> None:
    from app.agents.create_campaign.user_facing import (
        ensure_temporary_sheet_hypertext,
        sanitize_user_facing_reply,
    )

    bare = (
        "<p>You can upload temporary contacts using "
        "https://rebuild-campaign-api.worktual.com/api/public/temporary-contact-template.csv"
        " for this campaign.</p>"
    )
    out = sanitize_user_facing_reply(bare)
    assert "Download sample sheet" in out
    assert "<a " in out.lower() or "<a href" in out.lower()
    # Bare URL must not remain as plain text outside an href attribute.
    without_hrefs = re.sub(r'href="[^"]*"', 'href=""', out, flags=re.I)
    assert "temporary-contact-template.csv" not in without_hrefs or "Download sample sheet" in out
    assert (
        "https://rebuild-campaign-api.worktual.com/api/public/temporary-contact-template.csv"
        not in without_hrefs
    )

    linked = (
        '<p>Use <a href="https://example.com/api/public/temporary-contact-template.csv" '
        'download="temporary-contact-template.csv">Download sample sheet</a>.</p>'
    )
    kept = ensure_temporary_sheet_hypertext(linked)
    assert kept.count("<a ") == 1
    assert "Download sample sheet" in kept


def test_audience_reply_without_link_not_injected_by_sanitizer() -> None:
    """Sheet offer is agent-instruction driven — sanitizer must not invent it."""
    from app.agents.create_campaign.user_facing import sanitize_user_facing_reply

    raw = (
        "<p>Who should receive this? A few options from your contact base "
        "(All contacts with email, By city).</p>"
    )
    out = sanitize_user_facing_reply(raw)
    assert "Download sample sheet" not in out
    assert "temporary-contact-template" not in out.lower()