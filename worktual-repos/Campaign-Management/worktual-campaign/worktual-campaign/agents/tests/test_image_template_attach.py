"""Image attach merge — must not wipe template copy."""

from __future__ import annotations

from app.agents.image.template_attach import attach_preserves_content, build_attach_fields


def test_build_attach_fields_flat_template():
    prior = {
        "subject": "Summer Sale",
        "paragraphs": ["Hello there", "Shop now"],
        "cta_label": "Shop",
    }
    out = build_attach_fields(
        prior,
        image_url="https://cdn.example.com/api/media/abc",
        field_key="header_image",
    )
    assert out["header_image"] == "https://cdn.example.com/api/media/abc"
    assert out["image_url"] == "https://cdn.example.com/api/media/abc"
    assert "sections_patch" not in out
    # Flat templates get a hero image section so email preview can render the upload.
    sections = out.get("sections") or []
    assert len(sections) == 1
    assert sections[0]["type"] == "image"
    assert sections[0]["url"] == "https://cdn.example.com/api/media/abc"


def test_build_attach_fields_compiled_html_replaces_placeholder():
    prior = {
        "subject": "New stock",
        "compiled_html": (
            "<html><body><p>[Image: Wide retail display]</p>"
            "<p>Hi {{first_name}}</p></body></html>"
        ),
        "pipeline": "compose",
    }
    media = "https://rebuild-campaign-api.worktual.com/api/media/xyz"
    out = build_attach_fields(prior, image_url=media, field_key="header_image")
    assert out["header_image"] == media
    assert "[Image:" not in str(out.get("compiled_html") or "")
    assert media in str(out.get("compiled_html") or "")


def test_build_attach_fields_semantic_updates_existing_image_section():
    prior = {
        "subject": "Launch",
        "sections": [
            {"type": "headline", "content": "Big news"},
            {"type": "image", "url": "http://example/old.png"},
            {"type": "text", "content": "Details here"},
        ],
    }
    out = build_attach_fields(
        prior,
        image_url="http://example/media/x.png",
    )
    assert out["header_image"] == "http://example/media/x.png"
    sections = out["sections"]
    assert sections[1]["type"] == "image"
    assert sections[1]["url"] == "http://example/media/x.png"
    assert sections[1]["content"] == "http://example/media/x.png"


def test_build_attach_fields_semantic_inserts_after_headline():
    prior = {
        "subject": "Launch",
        "sections": [
            {"type": "headline", "content": "Big news"},
            {"type": "text", "content": "Details here"},
            {"type": "cta", "label": "Go", "url": "{{campaign_url}}"},
        ],
    }
    out = build_attach_fields(
        prior,
        image_url="http://example/media/x.png",
    )
    sections = out["sections"]
    assert sections[1]["type"] == "image"
    assert sections[1]["url"] == "http://example/media/x.png"
    assert sections[0]["content"] == "Big news"


def test_build_attach_fields_scrubs_url_only_text_section():
    media = "https://rebuild-campaign-api.worktual.com/api/media/abc"
    prior = {
        "subject": "Launch",
        "sections": [
            {"type": "headline", "content": "Big news"},
            {"type": "text", "content": media},
            {"type": "benefits", "items": ["One"]},
        ],
    }
    out = build_attach_fields(prior, image_url=media)
    sections = out["sections"]
    assert sections[1]["type"] == "image"
    assert sections[1]["url"] == media
    assert all(
        not (
            row.get("type") == "text"
            and str(row.get("content") or "").strip() == media
        )
        for row in sections
        if isinstance(row, dict)
    )


def test_attach_preserves_content_detects_wipe():
    prior = {"subject": "Hi", "paragraphs": ["Body copy"]}
    wiped = {"header_image": "http://x/img.png"}
    assert attach_preserves_content(prior, wiped) is False
    merged = {**prior, "header_image": "http://x/img.png"}
    assert attach_preserves_content(prior, merged) is True
