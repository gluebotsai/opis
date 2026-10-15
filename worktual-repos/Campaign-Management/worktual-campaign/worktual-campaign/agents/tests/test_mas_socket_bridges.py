"""Socket MAS bridges — same helpers for seed and user_message paths."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch


def test_monitoring_bridge_legacy_when_flag_off(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "")
    from app.config import get_settings

    get_settings.cache_clear()

    async def run():
        with patch(
            "app.agents.monitoring.agent.run_monitoring_turn",
            new_callable=AsyncMock,
        ) as mock_turn:
            mock_turn.return_value = {"reply": "mon", "state": {}, "ui_events": []}
            from app.mas import socket_bridge as bridge

            return await bridge.run_monitoring_turn_via_mas_or_legacy(
                "sid", "tok", "list campaigns"
            ), mock_turn

    out, mock_turn = asyncio.run(run())
    assert out["reply"] == "mon"
    assert out.get("mas") is None
    mock_turn.assert_awaited_once()
    get_settings.cache_clear()


def test_monitoring_bridge_mas_when_optimization_enabled(monkeypatch):
    monkeypatch.setenv("MAS_ENABLED_DOMAINS", "optimization")
    from app.config import get_settings

    get_settings.cache_clear()

    async def run():
        with patch(
            "app.mas.socket_bridge._run_module_mas_chat",
            new_callable=AsyncMock,
        ) as mock_chat:
            mock_chat.return_value = {
                "reply": "via mas mon",
                "state": {},
                "ui_events": [],
                "mas": True,
            }
            from app.mas import socket_bridge as bridge

            return await bridge.run_monitoring_turn_via_mas_or_legacy(
                "sid", "tok", "pause campaign"
            ), mock_chat

    out, mock_chat = asyncio.run(run())
    assert out.get("mas") is True
    assert out["reply"] == "via mas mon"
    mock_chat.assert_awaited_once()
    assert mock_chat.await_args.kwargs["module"] == "monitoring"
    get_settings.cache_clear()


def test_seed_modules_include_events_report():
    """Parity: seed allowlist must include modules that have MAS bridges."""
    # Keep in sync with socket_server join seed allowlist.
    seed_modules = {
        "contacts",
        "monitoring",
        "reports",
        "events_report",
        "whatsapp_approved",
        "whatsapp_rejected",
        "create_campaign",
        "recommendations",
    }
    assert "events_report" in seed_modules
    assert "monitoring" in seed_modules
