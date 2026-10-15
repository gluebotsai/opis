"""Compose HTML maps uploaded campaign media URLs onto <img> tags."""

from __future__ import annotations

from app.agents.image.hero_image import fields_have_hero_image
from app.mas.phase2_compose.html_images import map_uploaded_hero_fields

_HERO_URL = "https://rebuild-campaign-api.worktual.com/api/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"


def test_map_uploaded_hero_puts_img_in_html() -> None:
    fields = {
        "pipeline": "compose",
        "compiled_html": "<html><body><p>Hi {{first_name}},</p></body></html>",
    }
    mapped = map_uploaded_hero_fields(fields, _HERO_URL)
    html = str(mapped.get("compiled_html") or "")
    assert _HERO_URL in html
    assert "<img" in html.lower()
    assert mapped.get("header_image") == _HERO_URL
    assert fields_have_hero_image(mapped) is True
