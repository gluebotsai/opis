"""Image gallery asset helpers."""

from app.gallery.image_asset_registry import (
    default_short_description,
    media_id_from_url,
)


def test_media_id_from_url():
    url = "https://example.com/api/media/550e8400-e29b-41d4-a716-446655440000"
    assert media_id_from_url(url) == "550e8400-e29b-41d4-a716-446655440000"
    assert media_id_from_url(url, "explicit-id") == "explicit-id"


def test_default_short_description():
    assert default_short_description(source="uploaded") == "Uploaded marketing image"
    assert "Launch" in default_short_description(
        source="ai_generated",
        generation_prompt="Launch hero banner for retail sale",
    )
