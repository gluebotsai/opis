"""Template-bound media URLs must stamp to rebuild when public base is configured."""

from __future__ import annotations

from unittest.mock import patch

from app.agents.image.media_upload import (
    publicize_template_image_fields,
    stamp_template_media_url,
)


def test_stamp_lan_to_rebuild_when_public_base_set() -> None:
    mid = "ddfb2ae9-a8a1-42f7-886a-571963bb367b"
    lan = f"http://192.168.13.91:3001/api/media/{mid}"

    class _S:
        campaign_api_base = "http://192.168.13.91:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""

    with patch("app.agents.image.media_upload.get_settings", return_value=_S()):
        out = stamp_template_media_url(lan)
    assert out == f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"


def test_publicize_template_fields_web_image() -> None:
    mid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    lan = f"http://192.168.13.91:3001/api/media/{mid}"

    class _S:
        campaign_api_base = "http://192.168.13.91:3001/api"
        campaign_api_public_base = "https://rebuild-campaign-api.worktual.com"
        cors_origin = ""

    fields = {"title": "Hi", "body": "Text", "image_url": lan}
    with patch("app.agents.image.media_upload.get_settings", return_value=_S()):
        out = publicize_template_image_fields(fields)
    assert out["image_url"] == (
        f"https://rebuild-campaign-api.worktual.com/api/media/{mid}"
    )
