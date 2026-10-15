"""Tool validation — channels require explicit user confirmation."""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_update_setup_rejects_channels_without_confirmed() -> None:
    from unittest.mock import AsyncMock, patch

    from app.agents.create_campaign.tool_functions import handle_update_campaign_setup

    with patch(
        "app.agents.create_campaign.tool_functions.handle_update_campaign_meta",
        new_callable=AsyncMock,
    ) as mock_meta:
        mock_meta.return_value = {"ok": True, "campaign": {"name": "T", "goal": "G", "objective": "O"}}
        out = await handle_update_campaign_setup(
            "sid",
            "tok",
            {
                "name": "Seasonal Sale",
                "goal": "Drive urgency",
                "objective": "Convert VIPs",
                "channels": ["email"],
                "change_summary": "meta",
            },
        )
    assert out.get("ok") is False
    assert out.get("error") == "channels_not_confirmed"
    user_html = str(out.get("user_message") or out.get("message") or "").lower()
    assert "email" in user_html or "channels" in user_html


@pytest.mark.asyncio
async def test_update_setup_rejects_meta_and_channels_same_call() -> None:
    from unittest.mock import AsyncMock, patch

    from app.agents.create_campaign.tool_functions import handle_update_campaign_setup

    with patch(
        "app.agents.create_campaign.tool_functions.handle_update_campaign_meta",
        new_callable=AsyncMock,
    ) as mock_meta:
        mock_meta.return_value = {"ok": True}
        out = await handle_update_campaign_setup(
            "sid",
            "tok",
            {
                "goal": "Drive urgency",
                "channels": ["email"],
                "channels_confirmed": True,
                "change_summary": "both",
            },
        )
    assert out.get("ok") is False
    assert out.get("error") == "channels_with_meta"


@pytest.mark.asyncio
async def test_update_setup_accepts_channels_only_with_confirmed() -> None:
    from unittest.mock import AsyncMock, patch

    from app.agents.create_campaign.tool_functions import handle_update_campaign_setup

    with patch(
        "app.agents.create_campaign.tool_functions.handle_set_channels_core",
        new_callable=AsyncMock,
    ) as mock_ch:
        mock_ch.return_value = {"ok": True, "message": "saved channels"}
        out = await handle_update_campaign_setup(
            "sid",
            "tok",
            {
                "channels": ["email", "whatsapp"],
                "channels_confirmed": True,
                "change_summary": "channels",
            },
        )
    assert out.get("ok") is True
    assert "channels" in (out.get("updated_fields") or [])
    mock_ch.assert_awaited_once()


@pytest.mark.asyncio
async def test_update_setup_accepts_channels_with_user_text_context() -> None:
    from unittest.mock import AsyncMock, patch

    from app.agents.create_campaign.tool_functions import handle_update_campaign_setup

    with patch(
        "app.agents.create_campaign.tool_functions.handle_set_channels_core",
        new_callable=AsyncMock,
    ) as mock_ch:
        mock_ch.return_value = {"ok": True, "message": "saved channels"}
        out = await handle_update_campaign_setup(
            "sid",
            "tok",
            {
                "channels": ["email"],
                "channels_confirmed": True,
                "user_text": "email",
                "change_summary": "channels",
            },
        )
    assert out.get("ok") is True
    assert "channels" in (out.get("updated_fields") or [])
    mock_ch.assert_awaited_once()
