"""Jun30 loop + no regex intent recovery."""

from __future__ import annotations

import inspect
import unittest

from app.agents.create_campaign import agent as create_agent
from app.agents.create_campaign.prompts import build_system_prompt
from app.progress_status import pick_progress_label


class Jun30LoopTests(unittest.TestCase):
    def test_no_remint_or_regex_recovery(self):
        src = inspect.getsource(create_agent)
        self.assertNotIn("_remint_audience_followup", src)
        self.assertNotIn("_sanitize_user_reply", src)
        self.assertNotIn("_recover_strategy", src)
        self.assertNotIn("_STRATEGY_ACCEPT_CUE", src)
        self.assertIn("Jun30", create_agent.run_coordinator.__doc__ or "")

    def test_strategist_prompt_is_jun30(self):
        session = {
            "session_id": "test-sess",
            "campaign": {},
            "audience": {},
            "channels": [],
            "templates": [],
            "messages": [],
            "audience_segmentation": {"total_contacts": 10, "by_city": []},
        }
        prompt = build_system_prompt(
            session,
            {
                "filterable_fields": [{"key": "city", "description": "City"}],
                "channels_available": [{"id": "email"}],
            },
        )
        self.assertIn("Worktual campaign strategist", prompt)
        self.assertIn("build_campaign", prompt)
        self.assertIn("Live session", prompt)

    def test_progress_pools_exist(self):
        self.assertTrue(pick_progress_label("filtering"))


if __name__ == "__main__":
    unittest.main()
