"""Template edit image must not append to create-campaign chat transcript."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_template_edit_image_uses_deterministic_pipeline():
    from app.agents.template_library import template_edit_image

    pipeline = AsyncMock(
        return_value={
            "ok": True,
            "edit_outcome": "image_attached",
            "reply_facts": {
                "action": "image_attached",
                "image_used_stub": False,
                "image_url": "https://cdn.example.com/x.png",
            },
            "ui_events": [],
            "fields": {"header_image": "https://cdn.example.com/x.png"},
            "image_url": "https://cdn.example.com/x.png",
            "used_stub": False,
        }
    )

    with (
        patch.object(
            template_edit_image,
            "llm_pick_template_edit_route",
            AsyncMock(
                return_value={
                    "route": "image",
                    "executor_id": "image_generate",
                    "routing_hint": "add hero image",
                }
            ),
        ),
        patch(
            "app.mas.executors.shared.image_native.is_native_image",
            return_value=True,
        ),
        patch.object(
            template_edit_image,
            "run_template_edit_image_pipeline",
            pipeline,
        ),
        patch(
            "app.session_store.append_message",
            AsyncMock(),
        ) as append,
    ):
        out = await template_edit_image.try_template_image_edit(
            session_id="sess-1",
            token="tok",
            template_id="tpl-1",
            channel="email",
            instruction="add image",
            current_fields={"subject": "Hi"},
            event_callback=None,
        )

    assert out is not None
    assert out.get("intent") == "modify"
    assert out.get("edit_outcome") == "image_attached"
    assert "reply" not in out or not out.get("reply")
    pipeline.assert_awaited_once()
    append.assert_not_awaited()
