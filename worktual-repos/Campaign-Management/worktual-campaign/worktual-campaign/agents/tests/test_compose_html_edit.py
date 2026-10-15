"""Compose HTML Template-chat edit + undo/redo snapshot stack."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.mas.phase2_compose.compose_edit import run_compose_html_edit
from app.mas.phase2_compose.domain import is_compose_html_fields
from app.mas.phase2_compose.llm import extract_email_html, looks_like_html


def test_extract_email_html_drops_chain_of_thought() -> None:
    cot = (
        "Let's think step-by-step. 1. **Analyze the Request:** "
        "**Goal:** Fast-Register Discount Push. 7. **Generate Output:** "
        "(Proceeding to generate HTML)"
    )
    assert extract_email_html(cot) == ""
    assert looks_like_html(cot) is False
    wrapped = "<think>plan</think>\n<html><body><p>Hello</p></body></html>"
    assert "<p>Hello</p>" in extract_email_html(wrapped)
    fenced = "```html\n<div><p>Hi</p></div>\n```"
    assert extract_email_html(fenced).startswith("<div>")
    assert is_compose_html_fields({"pipeline": "compose", "compiled_html": "<p>x</p>"})
    assert is_compose_html_fields(
        {"compiled_html": "<html><body><p>long enough email body here</p></body></html>"}
    )
    assert not is_compose_html_fields({"subject": "Hi", "sections": [{"type": "headline"}]})
    assert not is_compose_html_fields(
        {
            "pipeline": "compose",
            "compiled_html": (
                "Let's think step-by-step. 1. **Analyze the Request:** "
                "**Goal:** Fast-Register Discount Push. (Proceeding to generate HTML)"
            ),
        }
    )


@pytest.mark.asyncio
async def test_compose_html_edit_runs_html_edit() -> None:
    current = {
        "pipeline": "compose",
        "subject": "Old",
        "compiled_html": "<html><body><p>Old body</p></body></html>",
    }
    with (
        patch(
            "app.mas.phase2_compose.compose_edit._pick_action",
            new_callable=AsyncMock,
            return_value={
                "action": "html_edit",
                "restated_query": "make the background black",
                "direct_reply": "Updated the background.",
            },
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._load_history",
            new_callable=AsyncMock,
            return_value=({}, {}, {"past": [], "future": []}),
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._save_history",
            new_callable=AsyncMock,
        ),
        patch("app.mas.phase2_compose.domain.TemplateDomain") as Domain,
    ):
        Domain.return_value.invoke = AsyncMock(
            return_value={
                "ok": True,
                "fields": {
                    **current,
                    "compiled_html": "<html><body style='background:#000'><p>New</p></body></html>",
                },
            }
        )
        out = await run_compose_html_edit(
            current_fields=current,
            instruction="make the background black and change the text color",
            session_id="s1",
            token="t",
            template_id="tid",
        )
    assert out["persist_fields"] is True
    assert "background:#000" in out["display_fields"]["compiled_html"]
    assert out["skill_id"] == "compose_html_edit"


@pytest.mark.asyncio
async def test_compose_html_undo_uses_snapshot_not_llm() -> None:
    current = {
        "pipeline": "compose",
        "subject": "New",
        "compiled_html": "<html><body><p>New</p></body></html>",
    }
    previous = {
        "pipeline": "compose",
        "subject": "Old",
        "compiled_html": "<html><body><p>Old</p></body></html>",
    }
    with (
        patch(
            "app.mas.phase2_compose.compose_edit._pick_action",
            new_callable=AsyncMock,
            return_value={
                "action": "undo",
                "restated_query": "undo",
                "direct_reply": "Restored.",
            },
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._load_history",
            new_callable=AsyncMock,
            return_value=({}, {}, {"past": [previous], "future": []}),
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._save_history",
            new_callable=AsyncMock,
        ) as save,
    ):
        out = await run_compose_html_edit(
            current_fields=current,
            instruction="undo that",
            session_id="s1",
            token="t",
            template_id="tid",
        )
    assert out["display_fields"]["compiled_html"] == previous["compiled_html"]
    assert out["skill_id"] == "compose_html_undo"
    assert save.await_count == 1


@pytest.mark.asyncio
async def test_compose_html_generate_image_maps_into_html() -> None:
    current = {
        "pipeline": "compose",
        "subject": "Sale",
        "compiled_html": '<html><body><img src="https://old.example/x.png" alt=""/></body></html>',
        "plan": {
            "subject": "Sale",
            "image_slots": [
                {
                    "role": "hero",
                    "needed": True,
                    "width_px": 600,
                    "height_px": 338,
                    "prompt": "festive sale",
                }
            ],
        },
        "image_assets": [{"role": "hero", "url": "https://old.example/x.png"}],
    }
    mapped = {
        **current,
        "compiled_html": (
            '<html><body><img src="https://rebuild.example/hero.png" alt=""/></body></html>'
        ),
        "header_image": "https://rebuild.example/hero.png",
        "image_url": "https://rebuild.example/hero.png",
        "image_assets": [{"role": "hero", "url": "https://rebuild.example/hero.png"}],
    }
    with (
        patch(
            "app.mas.phase2_compose.compose_edit._pick_action",
            new_callable=AsyncMock,
            return_value={
                "action": "generate_image",
                "restated_query": "festive hero",
                "direct_reply": "Updated the email image.",
            },
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._load_history",
            new_callable=AsyncMock,
            return_value=({}, {}, {"past": [], "future": []}),
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._save_history",
            new_callable=AsyncMock,
        ),
        patch(
            "app.mas.phase2_compose.executors.image.generate_and_map_compose_images",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "url": "https://rebuild.example/hero.png",
                "fields": mapped,
            },
        ),
    ):
        out = await run_compose_html_edit(
            current_fields=current,
            instruction="generate a new hero image",
            session_id="s1",
            token="t",
            template_id="tid",
        )
    assert out["persist_fields"] is True
    assert "https://rebuild.example/hero.png" in out["display_fields"]["compiled_html"]
    assert out["image_url"] == "https://rebuild.example/hero.png"
    assert out["skill_id"] == "compose_html_image"


@pytest.mark.asyncio
async def test_compose_html_edit_commentary_falls_back_to_gemini() -> None:
    current = {
        "pipeline": "compose",
        "subject": "Sale",
        "compiled_html": (
            "<html><body>"
            "<p>" + ("Hello there, this is a full email body. " * 20) + "</p>"
            "</body></html>"
        ),
    }
    mapped = {
        **current,
        "compiled_html": (
            '<html><body><img src="https://rebuild.example/hero.png" alt=""/>'
            "<p>Hello</p></body></html>"
        ),
        "header_image": "https://rebuild.example/hero.png",
        "image_url": "https://rebuild.example/hero.png",
        "image_assets": [{"role": "hero", "url": "https://rebuild.example/hero.png"}],
    }
    with (
        patch(
            "app.mas.phase2_compose.compose_edit._pick_action",
            new_callable=AsyncMock,
            return_value={
                "action": "html_edit",
                "restated_query": "add an image to the template",
                "direct_reply": "I'll add an image.",
            },
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._load_history",
            new_callable=AsyncMock,
            return_value=({}, {}, {"past": [], "future": []}),
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._save_history",
            new_callable=AsyncMock,
        ),
        patch("app.mas.phase2_compose.domain.TemplateDomain") as Domain,
        patch(
            "app.mas.phase2_compose.executors.image.generate_and_map_compose_images",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "url": "https://rebuild.example/hero.png",
                "fields": mapped,
            },
        ) as gen,
    ):
        Domain.return_value.invoke = AsyncMock(
            return_value={
                "ok": True,
                "fields": {
                    **current,
                    "compiled_html": (
                        "<p>I can't add an image to this email: the plan explicitly "
                        "says No images — do not add img tags.</p>"
                    ),
                },
            }
        )
        out = await run_compose_html_edit(
            current_fields=current,
            instruction="I'll add an image to the template.",
            session_id="s1",
            token="t",
            template_id="tid",
        )
    gen.assert_awaited()
    assert out["skill_id"] == "compose_html_image"
    assert "https://rebuild.example/hero.png" in out["display_fields"]["compiled_html"]
    assert "I can't add an image" not in out["display_fields"]["compiled_html"]


@pytest.mark.asyncio
async def test_compose_html_attach_upload_maps_hero() -> None:
    current = {
        "pipeline": "compose",
        "subject": "Sale",
        "compiled_html": (
            "<html><body>"
            '<img src="https://brand.example/logo.png" alt="logo" width="80"/>'
            '<img src="https://old.example/hero.png" alt="hero"/>'
            "<p>Body copy stays.</p>"
            "</body></html>"
        ),
        "brand_guidelines": {"logo_url": "https://brand.example/logo.png"},
        "image_assets": [{"role": "hero", "url": "https://old.example/hero.png"}],
    }
    upload = "https://cdn.example/api/media/upload.png"
    with (
        patch(
            "app.mas.phase2_compose.compose_edit._pick_action",
            new_callable=AsyncMock,
            return_value={
                "action": "attach_upload",
                "restated_query": "use this photo",
                "direct_reply": "Placed your photo as the email hero.",
            },
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._load_history",
            new_callable=AsyncMock,
            return_value=({}, {}, {"past": [], "future": []}),
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._save_history",
            new_callable=AsyncMock,
        ),
        patch(
            "app.agents.image.media_upload.ensure_public_media_url",
            new=AsyncMock(side_effect=lambda url, token="": (url, "")),
        ),
        patch(
            "app.mas.phase2_compose.executors.image.generate_and_map_compose_images",
            new_callable=AsyncMock,
        ) as gen,
    ):
        out = await run_compose_html_edit(
            current_fields=current,
            instruction="use this photo",
            session_id="s1",
            token="t",
            template_id="tid",
            pending_image_uploads=[{"image_url": upload, "status": "this_turn"}],
        )
    gen.assert_not_awaited()
    html = out["display_fields"]["compiled_html"]
    assert upload in html
    assert "https://brand.example/logo.png" in html
    assert "https://old.example/hero.png" not in html
    assert "<p>Body copy stays.</p>" in html
    assert out["display_fields"]["header_image"] == upload
    assert out["display_fields"]["image_url"] == upload
    assert out["skill_id"] == "compose_html_image"
    assert any(
        ev.get("type") == "template_image_attached" and ev.get("attach_target") == "hero"
        for ev in (out.get("ui_events") or [])
    )


@pytest.mark.asyncio
async def test_compose_html_this_turn_upload_skips_generate() -> None:
    current = {
        "pipeline": "compose",
        "subject": "Sale",
        "compiled_html": '<html><body><img src="https://old.example/x.png"/></body></html>',
    }
    upload = "https://cdn.example/api/media/this-turn.png"
    with (
        patch(
            "app.mas.phase2_compose.compose_edit._pick_action",
            new_callable=AsyncMock,
            return_value={
                "action": "generate_image",
                "restated_query": "add an image",
                "direct_reply": "Updated.",
            },
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._load_history",
            new_callable=AsyncMock,
            return_value=({}, {}, {"past": [], "future": []}),
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._save_history",
            new_callable=AsyncMock,
        ),
        patch(
            "app.agents.image.media_upload.ensure_public_media_url",
            new=AsyncMock(side_effect=lambda url, token="": (url, "")),
        ),
        patch(
            "app.mas.phase2_compose.executors.image.generate_and_map_compose_images",
            new_callable=AsyncMock,
        ) as gen,
    ):
        out = await run_compose_html_edit(
            current_fields=current,
            instruction="add an image",
            session_id="s1",
            token="t",
            template_id="tid",
            pending_image_uploads=[{"image_url": upload, "status": "this_turn"}],
        )
    gen.assert_not_awaited()
    assert upload in out["display_fields"]["compiled_html"]
    assert out["display_fields"]["header_image"] == upload


@pytest.mark.asyncio
async def test_compose_html_commentary_without_this_turn_generates() -> None:
    current = {
        "pipeline": "compose",
        "subject": "Sale",
        "compiled_html": (
            "<html><body>"
            "<p>" + ("Hello there, this is a full email body. " * 20) + "</p>"
            "</body></html>"
        ),
    }
    mapped = {
        **current,
        "compiled_html": (
            '<html><body><img src="https://rebuild.example/hero.png" alt=""/>'
            "<p>Hello</p></body></html>"
        ),
        "header_image": "https://rebuild.example/hero.png",
        "image_url": "https://rebuild.example/hero.png",
        "image_assets": [{"role": "hero", "url": "https://rebuild.example/hero.png"}],
    }
    with (
        patch(
            "app.mas.phase2_compose.compose_edit._pick_action",
            new_callable=AsyncMock,
            return_value={
                "action": "html_edit",
                "restated_query": "add an image to the template",
                "direct_reply": "I'll add an image.",
            },
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._load_history",
            new_callable=AsyncMock,
            return_value=({}, {}, {"past": [], "future": []}),
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._save_history",
            new_callable=AsyncMock,
        ),
        patch("app.mas.phase2_compose.domain.TemplateDomain") as Domain,
        patch(
            "app.agents.image.media_upload.ensure_public_media_url",
            new=AsyncMock(side_effect=lambda url, token="": (url, "")),
        ),
        patch(
            "app.mas.phase2_compose.executors.image.generate_and_map_compose_images",
            new_callable=AsyncMock,
            return_value={
                "ok": True,
                "url": "https://rebuild.example/hero.png",
                "fields": mapped,
            },
        ) as gen,
    ):
        Domain.return_value.invoke = AsyncMock(
            return_value={
                "ok": True,
                "fields": {
                    **current,
                    "compiled_html": (
                        "<p>I can't add an image to this email: the plan explicitly "
                        "says No images — do not add img tags.</p>"
                    ),
                },
            }
        )
        out = await run_compose_html_edit(
            current_fields=current,
            instruction="I'll add an image to the template.",
            session_id="s1",
            token="t",
            template_id="tid",
            pending_image_uploads=[{"image_url": "https://cdn.example/api/media/old.png", "status": "queued"}],
        )
    Domain.return_value.invoke.assert_awaited()
    gen.assert_not_awaited()
    assert "https://cdn.example/api/media/old.png" in out["display_fields"]["compiled_html"]
    assert "I can't add an image" not in out["display_fields"]["compiled_html"]


@pytest.mark.asyncio
async def test_compose_html_reattach_uses_earlier_session_photo() -> None:
    current = {
        "pipeline": "compose",
        "subject": "New stock",
        "compiled_html": (
            "<html><body><p>[Image: Wide retail display]</p>"
            "<p>Hi {{first_name}}</p></body></html>"
        ),
    }
    prior = "https://cdn.example/api/media/dusera.png"
    with (
        patch(
            "app.mas.phase2_compose.compose_edit._pick_action",
            new_callable=AsyncMock,
            return_value={
                "action": "attach_upload",
                "restated_query": "add to the template",
                "direct_reply": "Adding it.",
            },
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._load_history",
            new_callable=AsyncMock,
            return_value=({}, {}, {"past": [], "future": []}),
        ),
        patch(
            "app.mas.phase2_compose.compose_edit._save_history",
            new_callable=AsyncMock,
        ),
        patch(
            "app.agents.image.media_upload.ensure_public_media_url",
            new=AsyncMock(side_effect=lambda url, token="": (url, "")),
        ),
    ):
        out = await run_compose_html_edit(
            current_fields=current,
            instruction="add to the template",
            session_id="s1",
            token="t",
            template_id="tid",
            pending_image_uploads=[{"image_url": prior, "status": "in_session"}],
            recent_messages=[
                {
                    "role": "user",
                    "kind": "text",
                    "payload": {"text": "add this", "image_url": prior},
                }
            ],
        )
    html = str(out["display_fields"]["compiled_html"])
    assert "[Image:" not in html
    assert prior in html
    assert out["persist_fields"] is True
    assert out["reply"] == "Placed your photo as the email hero."

