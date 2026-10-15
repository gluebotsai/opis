"""Channel id normalization only — no chat-intent parsing."""

from __future__ import annotations

import unittest

from app.agents.create_campaign.channels import (
    channel_display_name,
    normalize_channels,
    reconcile_launch_channels,
)


class ChannelNormalizeTests(unittest.TestCase):
    def test_normalize_aliases(self) -> None:
        self.assertEqual(
            normalize_channels(["email", "web_push", "app_push", "whatsapp"]),
            ["email", "web", "push", "whatsapp"],
        )
        self.assertEqual(normalize_channels(["app", "email"]), ["push", "email"])

    def test_normalize_spaced_and_hyphen_tool_ids(self) -> None:
        self.assertEqual(normalize_channels(["web push"]), ["web"])
        self.assertEqual(normalize_channels(["web-push"]), ["web"])
        self.assertEqual(normalize_channels(["app-push"]), ["push"])

    def test_normalize_ignores_unknown_and_sms(self) -> None:
        self.assertEqual(normalize_channels(["email", "sms", "fax"]), ["email"])

    def test_display_name(self) -> None:
        self.assertEqual(channel_display_name("whatsapp"), "WhatsApp")
        self.assertIn("web push", channel_display_name("web").lower())
        self.assertIn("app push", channel_display_name("push").lower())

    def test_reconcile_keeps_session_web_when_launch_passes_push(self) -> None:
        kept, note = reconcile_launch_channels(["push"], ["web"])
        self.assertEqual(kept, ["web"])
        self.assertIsNotNone(note)

    def test_reconcile_keeps_session_push_when_launch_passes_web(self) -> None:
        kept, note = reconcile_launch_channels(["web_push"], ["push"])
        self.assertEqual(kept, ["push"])
        self.assertIsNotNone(note)

    def test_reconcile_allows_subset(self) -> None:
        kept, note = reconcile_launch_channels(["email"], ["email", "web"])
        self.assertEqual(kept, ["email"])
        self.assertIsNone(note)

    def test_reconcile_allows_adding_non_push_channel(self) -> None:
        kept, note = reconcile_launch_channels(["email", "web"], ["web"])
        self.assertEqual(kept, ["email", "web"])
        self.assertIsNone(note)


if __name__ == "__main__":
    unittest.main()
