"""Tests for template edit image routing."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.agents.template_library.edit_postprocess import finalize_edit_result
from app.agents.template_library.template_edit_image import (
    llm_pick_template_edit_route,
)


def test_finalize_trusts_tool_intent_not_instruction_phrases():
    # Clarify + "save" text must NOT auto-save — only LLM intent=save does.
    out = finalize_edit_result(
        instruction="save",
        channel="email",
        current_fields={"subject": "Hi", "body": "Hello"},
        result={
            "intent": "clarify",
            "fields": None,
            "reply": "What should I change?",
        },
    )
    assert out["intent"] == "clarify"
    assert out["persist_fields"] is False

    saved = finalize_edit_result(
        instruction="whatever wording",
        channel="email",
        current_fields={"subject": "Hi", "body": "Hello"},
        result={
            "intent": "save",
            "fields": None,
            "reply": "Saved this version.",
        },
    )
    assert saved["intent"] == "save"
    assert saved["persist_fields"] is True
    assert saved["display_fields"]["subject"] == "Hi"


def test_llm_pick_template_edit_route_image():
    async def run():
        with patch(
            "app.agents.template_library.template_edit_image.run_single_tool_routing_loop",
            new_callable=AsyncMock,
        ) as mock_loop:
            mock_loop.return_value = {
                "ok": True,
                "tool_name": "route_image_edit",
                "tool_args": {"executor_id": "image_generate"},
            }
            return await llm_pick_template_edit_route(
                instruction="generate a new hero image",
                channel="email",
                has_header_image=False,
            )

    out = asyncio.run(run())
    assert out["route"] == "image"
    assert out["executor_id"] == "image_generate"


def test_llm_pick_template_edit_route_copy():
    async def run():
        with patch(
            "app.agents.template_library.template_edit_image.run_single_tool_routing_loop",
            new_callable=AsyncMock,
        ) as mock_loop:
            mock_loop.return_value = {
                "ok": True,
                "tool_name": "route_copy_edit",
                "tool_args": {},
            }
            return await llm_pick_template_edit_route(
                instruction="change the subject line",
                channel="email",
            )

    out = asyncio.run(run())
    assert out["route"] == "copy"
