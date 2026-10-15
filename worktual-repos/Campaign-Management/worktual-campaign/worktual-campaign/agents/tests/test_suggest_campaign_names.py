"""suggest_campaign_names tool + readiness gate on update_campaign_setup."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_suggest_campaign_names_persists_three():
    from app.agents.create_campaign.tool_functions import handle_suggest_campaign_names

    session = {"session_id": "s1", "ui": {}, "campaign": {}}

    with (
        patch(
            "app.agents.create_campaign.tool_functions.get_or_create_session",
            new=AsyncMock(return_value=session),
        ),
        patch(
            "app.agents.create_campaign.tool_functions.save_session",
            new=AsyncMock(),
        ),
    ):
        out = await handle_suggest_campaign_names(
            "s1",
            {
                "names": ["Diwali Glow", "Festival Spark", "Joy Offer"],
                "change_summary": "name options",
            },
        )

    assert out["ok"] is True
    assert out["names"] == ["Diwali Glow", "Festival Spark", "Joy Offer"]
    assert session["ui"]["name_suggestions_offered"] is True
    assert session["ui"]["name_suggestions"] == out["names"]


@pytest.mark.asyncio
async def test_update_setup_gates_when_name_missing():
    from app.agents.create_campaign.tool_functions import handle_update_campaign_setup

    session = {"session_id": "s1", "ui": {}, "campaign": {}}

    with patch(
        "app.agents.create_campaign.tool_functions.get_or_create_session",
        new=AsyncMock(return_value=session),
    ):
        out = await handle_update_campaign_setup(
            "s1",
            "tok",
            {
                "goal": "Re-engage dormant customers",
                "objective": "Drive bookings",
                "change_summary": "meta without name",
            },
        )

    assert out["ok"] is False
    assert out["error"] == "needs_name_suggestions"
    assert out["needs_name_suggestions"] is True
