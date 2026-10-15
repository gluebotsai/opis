"""Smoke tests for unified campaign setup + contact check tools."""

from __future__ import annotations

import unittest

from app.agents.create_campaign.channels import normalize_channels
from app.agents.create_campaign.tools import CORE_TOOLS, CHECK_CONTACTS, UPDATE_CAMPAIGN_SETUP


class UnifiedSetupToolsTests(unittest.TestCase):
    def test_core_tools_expose_setup_and_check(self) -> None:
        names = [t["function"]["name"] for t in CORE_TOOLS]
        self.assertIn("update_campaign_setup", names)
        self.assertIn("check_contacts", names)
        self.assertIn("build_campaign", names)
        self.assertIn("set_email_ab", names)
        self.assertIn("launch_campaign", names)
        self.assertEqual(UPDATE_CAMPAIGN_SETUP["function"]["name"], "update_campaign_setup")
        self.assertEqual(CHECK_CONTACTS["function"]["name"], "check_contacts")

    def test_normalize_channels_from_tool_args(self) -> None:
        self.assertEqual(
            normalize_channels(["email", "webpush", "apppush"]),
            ["email", "web", "push"],
        )

    def test_setup_and_launch_channel_enum_includes_push_aliases(self) -> None:
        setup_items = UPDATE_CAMPAIGN_SETUP["function"]["parameters"]["properties"][
            "channels"
        ]["items"]
        launch = next(
            t for t in CORE_TOOLS if t["function"]["name"] == "launch_campaign"
        )
        launch_items = launch["function"]["parameters"]["properties"]["launch_channels"][
            "items"
        ]
        for schema in (setup_items, launch_items):
            enum = schema["enum"]
            self.assertIn("web", enum)
            self.assertIn("web_push", enum)
            self.assertIn("push", enum)
            self.assertIn("app_push", enum)


if __name__ == "__main__":
    unittest.main()
