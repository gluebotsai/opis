"""Template edit image pipeline — single generate + single attach."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_run_template_edit_image_pipeline_single_shot():
    from app.agents.template_library.template_edit_image import (
        run_template_edit_image_pipeline,
    )

    enhance = {"ok": True, "enhanced_prompt": "bold hero banner for festive sale"}
    generate = {
        "ok": True,
        "image_url": "https://cdn.example.com/a.png",
        "ui_events": [{"type": "image_generated", "image_url": "https://cdn.example.com/a.png"}],
    }
    attach = {
        "ok": True,
        "ui_events": [
            {
                "type": "template_image_attached",
                "template_id": "tpl-1",
                "image_url": "https://cdn.example.com/a.png",
                "fields": {
                    "subject": "Sale",
                    "header_image": "https://cdn.example.com/a.png",
                    "sections": [
                        {"type": "headline", "content": "Hi"},
                        {"type": "image", "url": "https://cdn.example.com/a.png"},
                    ],
                },
            }
        ],
    }
    handle_enhance = AsyncMock(return_value=enhance)
    handle_generate = AsyncMock(return_value=generate)
    handle_attach = AsyncMock(return_value=attach)
    get_template = AsyncMock(
        return_value={
            "template": {
                "template_id": "tpl-1",
                "channel": "email",
                "fields": {
                    "subject": "Sale",
                    "header_image": "https://cdn.example.com/a.png",
                    "sections": [
                        {"type": "headline", "content": "Hi"},
                        {"type": "image", "url": "https://cdn.example.com/a.png"},
                    ],
                },
            }
        }
    )

    with (
        patch(
            "app.agents.image.tools.handlers._handle_enhance",
            handle_enhance,
        ),
        patch(
            "app.agents.image.tools.handlers._handle_generate",
            handle_generate,
        ),
        patch(
            "app.agents.image.tools.handlers._handle_attach",
            handle_attach,
        ),
        patch(
            "app.session_store.get_or_create_session",
            AsyncMock(return_value={"session_id": "sess-1"}),
        ),
        patch(
            "app.session_store.save_session",
            AsyncMock(),
        ),
        patch(
            "app.template_store.get_template",
            get_template,
        ),
    ):
        out = await run_template_edit_image_pipeline(
            session_id="sess-1",
            token="tok",
            template_id="tpl-1",
            channel="email",
            instruction="add hero image",
            executor_id="image_generate",
        )

    assert out["ok"] is True
    handle_enhance.assert_awaited_once()
    handle_generate.assert_awaited_once()
    handle_attach.assert_awaited_once()
    assert out["fields"]["header_image"] == "https://cdn.example.com/a.png"
