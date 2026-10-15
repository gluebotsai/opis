"""Recommendations agent: past/knowledge prompt + card normalize (no seed fallback)."""

from __future__ import annotations

import unittest

from app.agents.create_campaign.prompts import (
    RECOMMENDATION_RUN_PROMPT,
    build_system_prompt as create_prompt,
    welcome_recommendation_run,
)
from app.agents.recommendations.prompts import build_system_prompt, welcome_text
from app.agents.recommendations.tools.handlers import _normalize_recommendations
from app.agents.recommendations.tools.schemas import GENERATE_RECOMMENDATIONS


class RecommendationsPromptTests(unittest.TestCase):
    def test_prompt_is_past_first_then_knowledge(self) -> None:
        text = build_system_prompt(
            {
                "session_id": "recommendations-main",
                "module": "recommendations",
                "past_has_history": False,
                "past_campaigns": [],
                "recommendations": [],
            }
        )
        lower = text.lower()
        self.assertIn("LOAD_PAST_CAMPAIGNS", text)
        self.assertIn("GENERATE_RECOMMENDATIONS", text)
        self.assertIn("past", lower)
        self.assertIn("knowledge", lower)
        self.assertIn("empty", lower)
        self.assertNotIn("Festival Sale Blast", text)

    def test_welcome_mentions_past_or_knowledge(self) -> None:
        text = welcome_text({"mode": "b2b"})
        lower = text.lower()
        self.assertIn("past", lower)
        self.assertIn("knowledge", lower)


class RecommendationsNormalizeTests(unittest.TestCase):
    def test_empty_generate_list_stays_empty(self) -> None:
        self.assertEqual(_normalize_recommendations([]), [])

    def test_title_only_card_gets_defaults(self) -> None:
        rows = _normalize_recommendations(
            [
                {"title": "Only a title"},
                {
                    "title": "Full idea",
                    "goal": "Re-engage quiet customers",
                    "objective": "Win back 90-day inactive buyers",
                    "audience": "Inactive in 90 days",
                    "channels": ["email"],
                    "why_created": "No past sends — knowledge start.",
                    "timing_label": "Tuesday 10:00",
                },
            ]
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["title"], "Only a title")
        self.assertTrue(rows[0]["goal"])
        self.assertTrue(rows[0]["timing_label"])
        self.assertEqual(rows[1]["title"], "Full idea")
        self.assertEqual(rows[1]["goal"], "Re-engage quiet customers")
        self.assertIn("Email", rows[1]["channels"])

    def test_generate_schema_requires_card_fields(self) -> None:
        item_required = GENERATE_RECOMMENDATIONS["function"]["parameters"][
            "properties"
        ]["recommendations"]["items"]["required"]
        for key in (
            "title",
            "goal",
            "objective",
            "audience",
            "channels",
            "why_created",
            "timing_label",
        ):
            self.assertIn(key, item_required)


class RecommendationsEmptyBoardTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_generate_emits_cards_event(self) -> None:
        from app.agents.recommendations.tools.handlers import generate_recommendations

        events: list = []

        async def cb(ev):
            events.append(ev)

        result = await generate_recommendations(
            "recommendations-test-empty-board",
            "tok",
            {"recommendations": [], "change_summary": "nothing useful"},
            event_callback=cb,
        )
        self.assertTrue(result.get("ok"))
        self.assertGreaterEqual(int(result.get("count") or 0), 1)
        self.assertEqual(events[0]["type"], "recommendation_cards")
        self.assertTrue(events[0]["payload"])


class RecommendationRunPromptTests(unittest.TestCase):
    def test_run_prompt_asks_edit_or_run(self) -> None:
        lower = RECOMMENDATION_RUN_PROMPT.lower()
        self.assertIn("edit", lower)
        self.assertIn("run this campaign", lower)
        self.assertIn("launch_campaign", RECOMMENDATION_RUN_PROMPT)
        self.assertIn("select_audience", RECOMMENDATION_RUN_PROMPT)
        self.assertIn("do not suggest three names", lower)

    def test_run_session_uses_run_prompt(self) -> None:
        text = create_prompt(
            {
                "session_id": "rec-run-test",
                "module": "create_campaign",
                "recommendation_run": True,
                "recommendation_why": "Past Summer Sale had a 12% open rate.",
                "campaign": {
                    "name": "Summer follow-up",
                    "goal": "Re-engage",
                    "objective": "Win back quiet buyers",
                },
                "audience": {"description": "90-day inactive", "matched_count": 0},
                "channels": ["email"],
            },
            {},
        )
        lower = text.lower()
        self.assertIn("edit", lower)
        self.assertIn("run this campaign", lower)
        self.assertIn("summer follow-up", lower)
        self.assertIn("12% open", lower)

    def test_run_welcome_asks_edit_or_run(self) -> None:
        text = welcome_recommendation_run().lower()
        self.assertIn("edit", text)
        self.assertIn("run this campaign", text)


if __name__ == "__main__":
    unittest.main()
