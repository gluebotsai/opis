"""Hero image detection — placeholders are not real URLs."""

from __future__ import annotations

from app.agents.image.hero_image import (
    fields_have_hero_image,
    fields_need_hero_image,
    templates_channels_needing_hero,
)


def test_placeholder_is_not_hero_image() -> None:
    fields = {
        "sections": [
            {"type": "headline", "content": "Happy Dussehra"},
            {
                "type": "image",
                "content": "[Dussehra Greeting Image Placeholder]",
            },
        ],
    }
    assert fields_have_hero_image(fields) is False
    assert fields_need_hero_image(fields) is True


def test_http_url_counts_as_hero() -> None:
    fields = {
        "sections": [
            {
                "type": "image",
                "url": "https://cdn.example.com/hero.png",
            },
        ],
    }
    assert fields_have_hero_image(fields) is True
    assert fields_need_hero_image(fields) is False


def test_compiled_html_bracket_placeholder_needs_hero() -> None:
    fields = {
        "compiled_html": (
            "<html><body><p>[Image: Wide retail display]</p><p>Hi</p></body></html>"
        ),
        "pipeline": "compose",
    }
    assert fields_have_hero_image(fields) is False
    assert fields_need_hero_image(fields) is True


def test_templates_channels_needing_hero() -> None:
    templates = [
        {
            "channel": "email",
            "fields": {
                "sections": [
                    {"type": "image", "content": "[Banner Placeholder]"},
                ],
            },
        }
    ]
    assert templates_channels_needing_hero(templates) == ["email"]
