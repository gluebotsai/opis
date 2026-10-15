"""Send-strategy facts from tool-supplied orchestration — no chat-text inference."""

from __future__ import annotations

import unittest

from app.agents.create_campaign.tool_functions import send_strategy_facts_for_llm


class SendStrategyFactsTests(unittest.TestCase):
    def test_multi_channel_facts(self) -> None:
        facts = send_strategy_facts_for_llm(
            {
                "mode": "prefer_primary",
                "primary_channel": "email",
                "t0_channels": ["email"],
                "channel_sequence": ["email", "whatsapp", "web", "push"],
                "multi_channel": True,
                "messaging_count": 4,
            }
        )
        self.assertTrue(facts.get("multi_channel"))
        self.assertEqual(facts.get("mode"), "prefer_primary")

    def test_single_channel_facts(self) -> None:
        facts = send_strategy_facts_for_llm(
            {
                "mode": "prefer_primary",
                "primary_channel": "email",
                "t0_channels": ["email"],
                "channel_sequence": ["email"],
                "multi_channel": False,
                "messaging_count": 1,
            }
        )
        self.assertFalse(facts.get("multi_channel"))

    def test_broadcast_mode_facts(self) -> None:
        facts = send_strategy_facts_for_llm(
            {
                "mode": "broadcast",
                "primary_channel": "email",
                "t0_channels": ["email", "whatsapp"],
                "channel_sequence": ["email", "whatsapp"],
                "multi_channel": True,
                "messaging_count": 2,
                "requires_broadcast_confirm": True,
            }
        )
        self.assertEqual(facts.get("mode"), "broadcast")


if __name__ == "__main__":
    unittest.main()
