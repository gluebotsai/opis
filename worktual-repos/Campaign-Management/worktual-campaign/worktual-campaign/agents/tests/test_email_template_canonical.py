"""Email template canonicalization — send matches saved sections."""

from __future__ import annotations

from app.agents.template_library.fields import (
    canonicalize_email_fields,
    dedupe_email_sections,
    normalize_email_hero_sections,
)

UNSPLASH = (
    "https://images.unsplash.com/photo-1554224155-6726b3ff858f"
    "?auto=format&fit=crop&q=80&w=1000"
)


def test_dedupe_email_sections_removes_consecutive_duplicate_greeting():
    sections = [
        {"type": "text", "content": "✨ Happy Dussehra, {{first_name}}! ✨"},
        {"type": "text", "content": "✨ Happy Dussehra, {{first_name}}! ✨"},
        {"type": "text", "content": "Celebrate the victory of good over evil."},
    ]
    out = dedupe_email_sections(sections)
    assert len(out) == 2
    assert out[0]["content"].startswith("✨ Happy Dussehra")


def test_canonicalize_email_clears_flat_when_sections_exist():
    raw = {
        "subject": "Sale",
        "greeting": "Hi {{first_name}}",
        "paragraphs": ["Hi {{first_name}}", "Body copy"],
        "sections": [
            {"type": "text", "content": "Hi {{first_name}}"},
            {"type": "image", "url": "https://cdn.example.com/a.png"},
        ],
    }
    out = canonicalize_email_fields(raw)
    assert out["greeting"] == ""
    assert out["paragraphs"] == []
    assert len(out["sections"]) == 2
    assert "blocks" not in out


def test_canonicalize_flat_dedupes_greeting_and_first_paragraph():
    raw = {
        "subject": "Sale",
        "greeting": "Happy Dussehra!",
        "paragraphs": ["Happy Dussehra!", "More copy"],
    }
    out = canonicalize_email_fields(raw)
    assert out["paragraphs"] == ["More copy"]


def test_normalize_promotes_unsplash_text_to_image_section():
    sections = [
        {"type": "headline", "content": "More Power, Less Cost."},
        {"type": "text", "content": UNSPLASH},
        {"type": "text", "content": "Hi {{first_name}}, great news."},
    ]
    out = normalize_email_hero_sections(sections)
    assert len(out) == 3
    assert out[1]["type"] == "image"
    assert out[1]["url"] == UNSPLASH
    assert out[2]["content"].startswith("Hi")


def test_canonicalize_sets_header_image_from_text_url():
    raw = {
        "subject": "Pricing update",
        "sections": [
            {"type": "headline", "content": "New lower rates"},
            {"type": "text", "content": UNSPLASH},
            {"type": "text", "content": "Hi {{first_name}},"},
        ],
    }
    out = canonicalize_email_fields(raw)
    assert out["header_image"] == UNSPLASH
    types = [row["type"] for row in out["sections"]]
    assert types.count("image") == 1


def test_canonicalize_keeps_columns_section():
    raw = {
        "subject": "Sale",
        "sections": [
            {"type": "headline", "content": "Hello"},
            {
                "type": "columns",
                "cells": {"a": "Left offer", "b": "Right offer"},
                "content": '{"a":"Left offer","b":"Right offer"}',
            },
        ],
    }
    out = canonicalize_email_fields(raw)
    kinds = [row["type"] for row in out["sections"]]
    assert "columns" in kinds
    columns = next(row for row in out["sections"] if row["type"] == "columns")
    assert columns["cells"]["a"] == "Left offer"
    assert columns["cells"]["b"] == "Right offer"


def test_normalize_fields_keeps_manual_edit_columns():
    from app.agents.template_library.fields import normalize_fields

    out = normalize_fields(
        "email",
        {
            "subject": "Sale",
            "sections": [
                {"type": "headline", "content": "Hello"},
                {"type": "columns", "cells": {"a": "Col 1", "b": "Col 2"}},
            ],
        },
    )
    kinds = [row["type"] for row in out["sections"]]
    assert "columns" in kinds
    columns = next(row for row in out["sections"] if row["type"] == "columns")
    assert columns["cells"]["a"] == "Col 1"
    assert columns["cells"]["b"] == "Col 2"
    assert UNSPLASH not in [
        str(row.get("content") or "")
        for row in out["sections"]
        if row.get("type") == "text"
    ]


def test_canonicalize_keeps_compiled_html_with_sections():
    html = (
        "<html><body><p>Full composed newsletter body with enough visible "
        "copy to pass the send-time body threshold for outbound email.</p></body></html>"
    )
    out = canonicalize_email_fields(
        {
            "subject": "Sale",
            "compiled_html": html,
            "sections": [{"type": "text", "content": "Hi"}],
        }
    )
    assert out["compiled_html"] == html
    assert out["greeting"] == ""


def test_canonicalize_drops_empty_shell_compiled_html_when_sections_exist():
    out = canonicalize_email_fields(
        {
            "subject": "Sale",
            "compiled_html": "<div></div>",
            "sections": [
                {"type": "headline", "content": "New Season"},
                {"type": "text", "content": "Hi {{first_name}},"},
                {"type": "text", "content": "Body copy for the campaign."},
            ],
        }
    )
    assert "compiled_html" not in out
    assert len(out["sections"]) == 3


def test_merge_email_fields_for_launch_prefers_session_html():
    from app.agents.template_library.fields import merge_email_fields_for_launch

    session = {
        "subject": "S",
        "compiled_html": "<p>" + ("Long preview body. " * 8) + "</p>",
    }
    db = {
        "subject": "S",
        "compiled_html": "<span></span>",
        "sections": [{"type": "text", "content": "x"}],
    }
    merged = merge_email_fields_for_launch(session, db)
    assert "Long preview body" in merged["compiled_html"]
