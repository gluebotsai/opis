"""Create-campaign chat HTML normalize (merge helper retained; agent turns do not merge)."""

from __future__ import annotations

from app.agents.create_campaign.chat_html_normalize import (
    looks_like_complete_user_reply,
    merge_preserved_user_replies,
    normalize_chat_html,
)
from app.agents.create_campaign.user_facing import sanitize_user_facing_reply


def test_normalize_plain_numbered_list_to_ol() -> None:
    raw = (
        "Here are three ideas:\n"
        "1. Welcome series for new signups\n"
        "2. Flash sale this weekend\n"
        "3. Loyalty thank-you note\n"
        "Which should we run?"
    )
    out = normalize_chat_html(raw)
    assert "<ol>" in out
    assert out.count("<li>") == 3
    assert "<p>" in out
    assert "1." not in out or "<li>" in out


def test_normalize_repairs_truncated_trailing_tag() -> None:
    raw = "<p>Your audience is ready.</p><p"
    out = normalize_chat_html(raw)
    assert out.endswith("</p>") or out.endswith("ready.")
    assert not out.rstrip().endswith("<p")
    assert "<p>" in out


def test_normalize_markdown_table_to_html() -> None:
    raw = (
        "| Channel | Fit |\n"
        "| --- | --- |\n"
        "| Email | High |\n"
        "| Push | Medium |"
    )
    out = normalize_chat_html(raw)
    assert "<table>" in out
    assert "<th>" in out
    assert "Email" in out
    assert "|" not in out.replace("</", "")


def test_sanitize_runs_normalize() -> None:
    raw = "Pick one:\n1. Alpha\n2. Beta"
    out = sanitize_user_facing_reply(raw)
    assert "<ol>" in out
    assert "<li>" in out


def test_looks_like_complete_skips_tool_nudge_text() -> None:
    assert not looks_like_complete_user_reply(
        "You must call update_campaign_setup before replying."
    )
    ideas = (
        "<p>Here are three campaign directions:</p>"
        "<ol><li>Welcome drip</li><li>Flash sale</li>"
        "<li>Loyalty thank-you</li></ol>"
        "<p>Which one should we build?</p>"
    )
    assert looks_like_complete_user_reply(ideas)


def test_merge_helper_not_used_for_cross_turn_stacking() -> None:
    """Agent no longer merges; helper behavior documented for legacy callers only."""
    old_turn = "<p>Got it — saving campaign name.</p>" * 5
    final = "<p>Launch confirmed for today.</p>"
    out = merge_preserved_user_replies(old_turn, final)
    # Helper still concatenates when final is short — create-campaign agent must not call it.
    assert "Launch confirmed" in out
    assert len(out) > len(final)
