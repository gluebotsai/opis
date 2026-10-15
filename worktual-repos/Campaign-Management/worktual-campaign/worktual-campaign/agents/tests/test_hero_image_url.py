"""Hero URL validation — tracking landings / campaign_url must never be image src."""

from __future__ import annotations

from app.agents.image.hero_image import is_http_image_url


def test_rejects_tracked_destination_with_utm() -> None:
    url = (
        "https://shop.example.com/sale?utm_source=worktual_campaign"
        "&utm_medium=email&utm_campaign=Festive+Diwali+Offers&wt=abc"
    )
    assert is_http_image_url(url) is False


def test_rejects_merge_tag() -> None:
    assert is_http_image_url("{{campaign_url}}") is False
    assert is_http_image_url("https://cdn.example/x.png?x={{campaign_url}}") is False


def test_accepts_media_cdn() -> None:
    assert is_http_image_url("https://cdn.example.com/media/abc123.jpg") is True
    assert is_http_image_url(
        "https://rebuild-campaign.worktual.com/api/media/xyz.webp"
    ) is True
    # Relative Campaign media paths absolutize + pass the gate.
    assert is_http_image_url("/api/media/xyz.webp") is True


def test_rejects_campaign_app_root() -> None:
    assert is_http_image_url("https://rebuild-campaign.worktual.com/") is False
