"""Gemini image config — no silent stub without explicit dev flag."""

from __future__ import annotations

import asyncio

import pytest


@pytest.fixture(autouse=True)
def _clear_settings_cache():
    from app.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_generate_fails_without_api_key_by_default(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GEMINI_IMAGE_ALLOW_DEV_STUB", "false")

    async def run():
        from app.integrations.gemini_image import generate_image_bytes

        with pytest.raises(RuntimeError) as exc:
            await generate_image_bytes("festive email hero banner")
        assert "GEMINI_API_KEY" in str(exc.value)

    asyncio.run(run())


def test_generate_uses_stub_when_dev_flag_enabled(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("GEMINI_IMAGE_ALLOW_DEV_STUB", "true")

    async def run():
        from app.integrations.gemini_image import generate_image_bytes

        raw, mime, used_stub = await generate_image_bytes("test prompt")
        assert used_stub is True
        assert mime == "image/png"
        assert len(raw) > 100

    asyncio.run(run())


def test_user_facing_image_failure_for_missing_gemini():
    from app.agents.create_campaign.user_facing import user_facing_image_failure
    from app.integrations.gemini_image import IMAGE_GENERATION_NOT_CONFIGURED

    out = user_facing_image_failure(IMAGE_GENERATION_NOT_CONFIGURED)
    assert "image generation" in out.lower() or "upload" in out.lower()
    assert "not available" in out.lower() or "isn't available" in out.lower()
