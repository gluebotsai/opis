"""Phase 2 Gemini image executor + HTML mapping."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.mas.phase2_compose.executors import image as image_ex
from app.mas.phase2_compose.html_images import (
    apply_image_assets_to_html,
    map_hero_fields,
    map_uploaded_hero_fields,
    skip_urls_from_brand,
)
from app.mas.phase2_compose.workspace import Workspace


def test_apply_image_assets_replaces_hero_and_skips_logo() -> None:
    html = (
        '<html><body>'
        '<img src="https://brand.example/logo.png" alt="logo" width="80"/>'
        '<img src="https://old.example/hero.png" alt="hero"/>'
        "</body></html>"
    )
    out = apply_image_assets_to_html(
        html,
        [{"role": "hero", "url": "https://rebuild.example/new.png", "width_px": 600}],
        skip_urls=skip_urls_from_brand({"logo_url": "https://brand.example/logo.png"}),
    )
    assert "https://brand.example/logo.png" in out
    assert "https://rebuild.example/new.png" in out
    assert "https://old.example/hero.png" not in out


def test_apply_image_assets_does_not_paint_extra_imgs() -> None:
    html = (
        '<html><body>'
        '<img src="https://old.example/hero.png" alt="hero"/>'
        '<img src="https://old.example/icon.png" alt="icon" width="24"/>'
        "</body></html>"
    )
    out = apply_image_assets_to_html(
        html,
        [{"role": "hero", "url": "https://rebuild.example/new.png", "width_px": 600}],
    )
    assert "https://rebuild.example/new.png" in out
    assert "https://old.example/icon.png" in out
    assert "https://old.example/hero.png" not in out
    html = "<html><body><p>Hello</p></body></html>"
    out = apply_image_assets_to_html(
        html,
        [{"role": "hero", "url": "https://rebuild.example/hero.png", "width_px": 600}],
    )
    assert 'src="https://rebuild.example/hero.png"' in out
    assert "<p>Hello</p>" in out


def test_apply_image_assets_replaces_bracket_placeholder() -> None:
    html = (
        "<html><body>"
        "<h1>NEW ARRIVALS</h1>"
        "<p>[Image: Wide retail display showing clothes]</p>"
        "<p>Hi {{first_name}}</p>"
        "</body></html>"
    )
    out = apply_image_assets_to_html(
        html,
        [{"role": "hero", "url": "https://rebuild.example/api/media/hero.png", "width_px": 600}],
    )
    assert "[Image:" not in out
    assert "https://rebuild.example/api/media/hero.png" in out


def test_map_hero_fields_updates_html_and_mirrors() -> None:
    fields = {
        "pipeline": "compose",
        "compiled_html": '<html><body><img src="https://old.example/x.png"/></body></html>',
        "image_assets": [{"role": "hero", "url": "https://old.example/x.png"}],
    }
    mapped = map_hero_fields(fields, "https://rebuild.example/hero.png")
    assert mapped["header_image"] == "https://rebuild.example/hero.png"
    assert mapped["image_url"] == "https://rebuild.example/hero.png"
    assert mapped["image_assets"][0]["url"] == "https://rebuild.example/hero.png"
    assert "https://rebuild.example/hero.png" in mapped["compiled_html"]


def test_map_uploaded_hero_fields_replaces_hero_not_logo() -> None:
    fields = {
        "pipeline": "compose",
        "compiled_html": (
            "<html><body>"
            '<img src="https://brand.example/logo.png" alt="logo"/>'
            '<img src="https://old.example/x.png" alt="hero"/>'
            "</body></html>"
        ),
        "brand_guidelines": {"logo_url": "https://brand.example/logo.png"},
        "image_assets": [{"role": "hero", "url": "https://old.example/x.png"}],
    }
    mapped = map_uploaded_hero_fields(fields, "https://cdn.example/api/media/u.png")
    assert mapped["header_image"] == "https://cdn.example/api/media/u.png"
    assert "https://cdn.example/api/media/u.png" in mapped["compiled_html"]
    assert "https://brand.example/logo.png" in mapped["compiled_html"]
    assert "https://old.example/x.png" not in mapped["compiled_html"]


@pytest.mark.asyncio
async def test_image_executor_uses_gemini_url() -> None:
    ws = Workspace()
    ws.plan = {
        "subject": "Pro Plan Sale",
        "content_brief": "50% off",
        "image_slots": [
            {
                "role": "hero",
                "needed": True,
                "width_px": 600,
                "height_px": 338,
                "prompt": "Gandhi Jayanti festive hero",
            }
        ],
    }
    enhance = AsyncMock(
        return_value=type(
            "E",
            (),
            {
                "ok": True,
                "enhanced_prompt": "Detailed festive hero brief. Avoid: watermarks.",
                "refused": False,
                "error": "",
            },
        )()
    )
    with (
        patch("app.agents.image.enhance.enhance_image_prompt", new=enhance),
        patch(
            "app.integrations.gemini_image.generate_and_upload_rebuild_url",
            new_callable=AsyncMock,
            return_value={
                "url": "https://rebuild-campaign-api.worktual.com/api/media/abc",
                "media_id": "abc",
                "used_stub": False,
            },
        ),
        patch(
            "app.gallery.image_asset_registry.register_gallery_image",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        out = await image_ex.run({"campaign": {"name": "Sale"}}, ws)
    assert out["status"] == "completed"
    assets = (out.get("payload") or {}).get("image_assets") or []
    assert assets[0]["url"].startswith("https://rebuild-campaign-api.worktual.com/")
    enhance.assert_awaited()


@pytest.mark.asyncio
async def test_image_executor_no_assets_when_gemini_fails() -> None:
    ws = Workspace()
    ws.plan = {
        "image_slots": [
            {"role": "hero", "needed": True, "width_px": 600, "height_px": 338, "prompt": "x"}
        ]
    }
    with patch(
        "app.mas.phase2_compose.executors.image.generate_compose_image_url",
        new_callable=AsyncMock,
        return_value={"ok": False, "error": "GEMINI_API_KEY"},
    ):
        out = await image_ex.run({}, ws)
    assert out["status"] == "failed"
    assets = (out.get("payload") or {}).get("image_assets") or []
    assert assets == []
    warns = out.get("warnings") or []
    assert any(str(w).startswith("Images did not attach") for w in warns)
    assert "gstatic.com" not in " ".join(str(w) for w in warns)


def test_strip_untrusted_drops_gstatic_keeps_gemini() -> None:
    html = (
        '<html><body>'
        '<img src="https://www.gstatic.com/images/stock.png" alt="stock"/>'
        '<img src="https://rebuild.example/api/media/abc" alt="hero"/>'
        "</body></html>"
    )
    from app.mas.phase2_compose.html_images import strip_untrusted_content_images

    out = strip_untrusted_content_images(
        html,
        allowed_urls={"https://rebuild.example/api/media/abc"},
    )
    assert "gstatic.com" not in out
    assert "https://rebuild.example/api/media/abc" in out


def test_skip_urls_from_brand_ignores_gstatic() -> None:
    from app.mas.phase2_compose.html_images import skip_urls_from_brand

    skip = skip_urls_from_brand(
        {
            "logo_url": "https://brand.example/logo.png",
            "banner_url": "https://www.gstatic.com/fake-banner.png",
        }
    )
    assert "https://brand.example/logo.png" in skip
    assert not any("gstatic.com" in u for u in skip)


@pytest.mark.asyncio
async def test_image_executor_uses_ready_url_without_gemini() -> None:
    ws = Workspace()
    ws.plan = {
        "image_slots": [
            {"role": "hero", "needed": True, "width_px": 600, "height_px": 338, "prompt": "x"}
        ]
    }
    gemini = AsyncMock(side_effect=AssertionError("gemini must not run"))
    with patch(
        "app.mas.phase2_compose.executors.image.generate_compose_image_url",
        new=gemini,
    ):
        out = await image_ex.run(
            {
                "ready_image_url": "https://rebuild-campaign-api.worktual.com/api/media/ee8",
            },
            ws,
        )
    assert out["status"] == "completed"
    assets = (out.get("payload") or {}).get("image_assets") or []
    assert assets[0]["url"].endswith("/api/media/ee8")
    gemini.assert_not_called()


def test_slot_user_prompt_does_not_embed_html_copy() -> None:
    plan = {
        "subject": "Big News Inside: We've hit a major milestone!",
        "content_brief": (
            "Hi {{first_name}}, WE HIT 1M! Thank you for your support. "
            "Celebrate this milestone with Booxoo."
        ),
    }
    prompt = image_ex._slot_user_prompt(plan, {"role": "hero", "needed": True})
    lower = prompt.lower()
    assert "{{" not in prompt
    assert "first_name" not in lower
    assert "we hit 1m" not in lower
    assert "hi {{" not in lower
    assert "no text" in lower or "no letters" in lower

    tagged = image_ex._slot_user_prompt(
        plan, {"role": "hero", "prompt": "Team photo for {{first_name}}"}
    )
    assert "{{" not in tagged
    assert "first_name" not in tagged.lower()

    brief = image_ex._alignment_brief(plan, {})
    assert "{{" not in brief
    assert "first_name" not in brief.lower()
