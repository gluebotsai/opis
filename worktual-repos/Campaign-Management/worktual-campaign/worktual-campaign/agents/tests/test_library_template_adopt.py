"""Library adopt must persist session channel templates (not library ids)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

from app.agents.create_campaign.tool_functions import (
    _adopt_persist_payload,
    _adopt_seeded_library_templates,
)


def test_adopt_persist_payload_omits_library_template_id():
    payload = _adopt_persist_payload(
        [
            {
                "template_id": "88",
                "library_template_id": "88",
                "channel": "email",
                "fields": {"subject": "Hello", "sections": []},
            }
        ]
    )
    assert len(payload) == 1
    assert "template_id" not in payload[0]
    assert payload[0]["channel"] == "email"
    assert payload[0]["fields"]["subject"] == "Hello"


def test_adopt_seeded_library_templates_persists_and_remaps_ids():
    async def run():
        session = {
            "session_id": "lib-adopt-1",
            "templates": [
                {
                    "library_template_id": "88",
                    "template_id": "88",
                    "channel": "email",
                    "fields": {"subject": "Test", "sections": [{"type": "text", "content": "Hi"}]},
                }
            ],
            "selected_library_templates": [],
        }
        with patch(
            "app.agents.create_campaign.tool_functions.get_or_create_session",
            new_callable=AsyncMock,
            return_value=session,
        ), patch(
            "app.agents.create_campaign.tool_functions.save_session",
            new_callable=AsyncMock,
            return_value=session,
        ), patch(
            "app.agents.create_campaign.tool_functions.create_templates_batch",
            new_callable=AsyncMock,
            return_value={
                "templates": [
                    {
                        "template_id": "987654321012345678",
                        "channel": "email",
                        "fields": session["templates"][0]["fields"],
                    }
                ]
            },
        ), patch(
            "app.request_context.get_request_token",
            return_value="tok",
        ):
            return await _adopt_seeded_library_templates("lib-adopt-1", {})

    out = asyncio.run(run())
    assert out.get("ok") is True
    assert out.get("template_ids") == ["987654321012345678"]
    assert out.get("adopted") is True
