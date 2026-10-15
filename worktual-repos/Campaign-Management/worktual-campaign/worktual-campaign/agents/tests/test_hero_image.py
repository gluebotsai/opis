"""Hero image section helpers."""

from __future__ import annotations

from app.agents.image.hero_image import (
    ensure_image_section_in_plan,
    fields_have_hero_image,
    find_image_section_index,
)


def test_ensure_image_section_after_headline() -> None:
    out = ensure_image_section_in_plan(["headline", "text", "cta"], wants_images=True)
    assert out == ["headline", "image", "text", "cta"]


def test_ensure_image_section_removed_when_not_wanted() -> None:
    out = ensure_image_section_in_plan(["headline", "image", "text"], wants_images=False)
    assert "image" not in out


def test_fields_have_hero_from_section() -> None:
    assert fields_have_hero_image(
        {"sections": [{"type": "image", "url": "https://x/img.png"}]}
    )


def test_find_image_section_index() -> None:
    sections = [{"type": "headline"}, {"type": "image"}, {"type": "text"}]
    assert find_image_section_index(sections) == 1
