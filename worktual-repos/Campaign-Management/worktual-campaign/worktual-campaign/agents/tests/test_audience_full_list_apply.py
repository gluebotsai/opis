"""Tests for audience APPLY empty-filters → full list (no wording coerce)."""

from __future__ import annotations

import unittest

from app.agents.create_campaign.filtering import _plan_from_apply_tool


class PlanFromApplyToolTests(unittest.TestCase):
    def test_empty_filters_replace_is_full_audience_without_wording(self):
        plan = _plan_from_apply_tool(
            {
                "mode": "replace",
                "filters": {},
                "why": "user wants the whole list",
            },
            catalog_keys={"city", "company"},
            custom_keys=set(),
            user_text="i want to use all the audience to run campaign",
            campaign={},
            prior_filters=None,
        )
        self.assertEqual(plan["intent"], "replace")
        self.assertEqual(plan["filters"], {})
        self.assertTrue(plan["all_contacts"])
        self.assertEqual(plan.get("needs_clarification") or "", "")

    def test_empty_filters_not_coerced_to_clarify_on_odd_phrasing(self):
        plan = _plan_from_apply_tool(
            {"mode": "replace", "filters": {}, "change_summary": "everyone"},
            catalog_keys={"city"},
            custom_keys=set(),
            user_text="use everyone we have",
            campaign=None,
            prior_filters={"city": "Chennai"},
        )
        self.assertEqual(plan["intent"], "replace")
        self.assertTrue(plan["all_contacts"])


if __name__ == "__main__":
    unittest.main()
