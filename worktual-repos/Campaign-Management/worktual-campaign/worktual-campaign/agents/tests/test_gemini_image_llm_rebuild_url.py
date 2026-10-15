"""GeminiImageLLM returns rebuild URLs, never local paths for templates."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch


def test_local_path_to_rebuild_url_reads_file_and_uploads(tmp_path) -> None:
    import asyncio

    from app.integrations.gemini_image import local_path_to_rebuild_url

    img = tmp_path / "hero.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)

    async def _run() -> None:
        with patch(
            "app.agents.image.media_upload.upload_image_bytes",
            new=AsyncMock(
                return_value={
                    "url": "https://rebuild-campaign-api.worktual.com/api/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    "media_id": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    "path": "/api/media/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                }
            ),
        ):
            out = await local_path_to_rebuild_url(str(img), token="t")
        assert out["url"].startswith(
            "https://rebuild-campaign-api.worktual.com/api/media/"
        )
        assert not out["url"].startswith("/")
        assert "Documents" not in out["url"]

    asyncio.run(_run())


def test_gemini_image_llm_run_returns_rebuild_url_not_path() -> None:
    import asyncio

    from app.integrations.gemini_image import GeminiImageLLM

    async def _run() -> None:
        llm = GeminiImageLLM(api_key="fake-key", token="t")
        with (
            patch(
                "app.integrations.gemini_image._generate_sync",
                return_value=b"\x89PNG\r\n\x1a\n" + b"\x00" * 64,
            ),
            patch(
                "app.integrations.gemini_image.local_path_to_rebuild_url",
                new=AsyncMock(
                    return_value={
                        "url": "https://rebuild-campaign-api.worktual.com/api/media/bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                        "media_id": "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                    }
                ),
            ),
        ):
            url = await llm.run("festive lamp hero")
        assert url.startswith("https://rebuild-campaign-api.worktual.com/api/media/")
        assert not url.endswith(".png")
        assert url != "IMAGE_URL"

    asyncio.run(_run())


def test_generate_and_upload_uses_llm_run() -> None:
    import asyncio

    from app.integrations.gemini_image import generate_and_upload_rebuild_url

    async def _run() -> None:
        with patch(
            "app.integrations.gemini_image.GeminiImageLLM.run",
            new=AsyncMock(
                return_value="https://rebuild-campaign-api.worktual.com/api/media/cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee"
            ),
        ):
            out = await generate_and_upload_rebuild_url("festive lamp", token="t")
        assert out["url"].startswith("https://rebuild-campaign-api.worktual.com/api/media/")
        assert out["media_id"] == "cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee"
        assert "Documents" not in str(out["url"])

    asyncio.run(_run())
