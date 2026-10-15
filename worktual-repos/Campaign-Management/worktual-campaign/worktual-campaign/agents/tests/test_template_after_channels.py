"""Tests: channels confirmed → templates (strategy not a hard block)."""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents.create_campaign.tool_functions import (
    _ensure_strategy_accepted_if_ready,
    handle_build_campaign,
)


class StrategyImpliedForTemplatesTests(unittest.TestCase):
    def test_ensure_strategy_when_audience_and_channels_ready(self):
        session = {
            "campaign": {"name": "N", "goal": "G", "objective": "O"},
            "strategy_accepted": False,
            "audience": {"matched_count": 1},
            "channels": ["email"],
        }
        self.assertTrue(_ensure_strategy_accepted_if_ready(session))
        self.assertTrue(session["strategy_accepted"])

    def test_build_does_not_return_strategy_not_accepted(self):
        session = {
            "campaign": {"name": "N", "goal": "G", "objective": "O"},
            "strategy_accepted": False,
            "audience": {"matched_count": 1, "sample_names": ["A"]},
            "channels": ["email"],
            "templates": [],
        }

        async def run():
            with (
                patch(
                    "app.agents.create_campaign.tool_functions.get_or_create_session",
                    AsyncMock(return_value=session),
                ),
                patch(
                    "app.agents.create_campaign.tool_functions.save_session",
                    AsyncMock(),
                ),
                patch(
                    "app.agents.create_campaign.tool_functions.handle_create_templates",
                    AsyncMock(
                        return_value={
                            "ok": True,
                            "message": "Templates ready",
                            "templates": [{"channel": "email"}],
                        }
                    ),
                ) as create,
            ):
                result = await handle_build_campaign(
                    "s1",
                    {"mode": "create", "user_confirmed": True},
                )
                self.assertTrue(result.get("ok"))
                self.assertNotEqual(result.get("error"), "Strategy not accepted yet.")
                create.assert_awaited()
                self.assertTrue(session["strategy_accepted"])

        asyncio.run(run())

    def test_build_proceeds_when_meta_and_channels_ready_without_confirm_flag(self):
        session = {
            "campaign": {"name": "N", "goal": "G", "objective": "O"},
            "strategy_accepted": True,
            "audience": {"matched_count": 1},
            "channels": ["email"],
            "templates": [],
        }

        async def run():
            with (
                patch(
                    "app.agents.create_campaign.tool_functions.get_or_create_session",
                    AsyncMock(return_value=session),
                ),
                patch(
                    "app.agents.create_campaign.tool_functions.save_session",
                    AsyncMock(),
                ),
                patch(
                    "app.agents.create_campaign.tool_functions.handle_create_templates",
                    AsyncMock(return_value={"ok": True}),
                ) as create,
            ):
                result = await handle_build_campaign(
                    "s1",
                    {
                        "mode": "create",
                        "user_confirmed": False,
                        "user_text": "generate template with image now",
                    },
                )
                self.assertTrue(result.get("ok"))
                create.assert_awaited()

        asyncio.run(run())

    def test_build_defaults_whatsapp_retry_and_continues(self):
        session = {
            "campaign": {"name": "N", "goal": "G", "objective": "O"},
            "strategy_accepted": True,
            "audience": {"matched_count": 1},
            "channels": ["whatsapp"],
            "whatsapp_retry": None,
            "templates": [],
        }

        async def run():
            with (
                patch(
                    "app.agents.create_campaign.tool_functions.get_or_create_session",
                    AsyncMock(return_value=session),
                ),
                patch(
                    "app.agents.create_campaign.tool_functions.save_session",
                    AsyncMock(),
                ),
                patch(
                    "app.agents.create_campaign.tool_functions.handle_create_templates",
                    AsyncMock(return_value={"ok": True, "channels": ["whatsapp"]}),
                ) as create,
            ):
                result = await handle_build_campaign(
                    "s1",
                    {"mode": "create", "user_confirmed": True},
                )
                self.assertTrue(result.get("ok"))
                self.assertEqual(session.get("whatsapp_retry"), 0)
                create.assert_awaited()

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
