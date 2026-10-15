"""Launch readiness user HTML + internal instruction separation."""

from __future__ import annotations

import unittest

from app.agents.create_campaign.launch_guard import (
    best_template_by_channel,
    launch_readiness_message,
    launch_readiness_user_html,
    template_ready_for_launch,
)


class LaunchGuardTests(unittest.TestCase):
    def test_partial_templates_user_html(self) -> None:
        session = {
            "campaign": {
                "name": "Upsell",
                "goal": "Upgrade",
                "objective": "Move tier",
            },
            "audience": {"matched_count": 1},
            "channels": ["email", "whatsapp", "web", "push"],
            "templates": [{"channel": "email", "template_id": "1"}],
        }
        html = launch_readiness_user_html(session) or ""
        self.assertIn("email", html.lower())
        self.assertIn("whatsapp", html.lower())
        self.assertNotIn("Tell the user", html)
        self.assertNotIn("Say <b>regenerate</b>", html)
        llm = launch_readiness_message(session) or ""
        self.assertIn("Never paste", llm)
        self.assertIn("launch_campaign", llm)

    def test_ready_when_complete(self) -> None:
        session = {
            "campaign": {
                "name": "Upsell",
                "goal": "Upgrade",
                "objective": "Move tier",
            },
            "audience": {"matched_count": 1},
            "channels": ["email"],
            "templates": [
                {
                    "channel": "email",
                    "template_id": "1",
                    "fields": {
                        "subject": "Upgrade offer",
                        "paragraphs": ["Hello", "Upgrade today for more value."],
                    },
                }
            ],
        }
        self.assertIsNone(launch_readiness_user_html(session))
        self.assertIsNone(launch_readiness_message(session))

    def test_ready_when_phase2_compiled_html(self) -> None:
        session = {
            "campaign": {
                "name": "Your Seat Awaits",
                "goal": "Win-back",
                "objective": "Re-engage dormant sign-ups",
            },
            "audience": {"matched_count": 1},
            "channels": ["email"],
            "templates": [
                {
                    "channel": "email",
                    "template_id": "2",
                    "fields": {
                        "subject": "Your seat is waiting",
                        "pipeline": "compose",
                        "compiled_html": (
                            "<html><body><h1>Your seat is waiting</h1>"
                            "<p>Come back and finish what you started.</p>"
                            "</body></html>"
                        ),
                    },
                }
            ],
        }
        self.assertIsNone(launch_readiness_user_html(session))
        self.assertIsNone(launch_readiness_message(session))

    def test_older_incomplete_email_does_not_block_complete_card(self) -> None:
        session = {
            "campaign": {
                "name": "Your Seat Awaits",
                "goal": "Win-back",
                "objective": "Re-engage",
            },
            "audience": {"matched_count": 1},
            "channels": ["email"],
            "templates": [
                {
                    "channel": "email",
                    "template_id": "old",
                    "fields": {"subject": "Campaign message"},
                },
                {
                    "channel": "email",
                    "template_id": "new",
                    "fields": {
                        "subject": "Your seat is waiting",
                        "compiled_html": (
                            "<html><body><p>Come back for your reserved seat today.</p>"
                            "</body></html>"
                        ),
                    },
                },
            ],
        }
        self.assertIsNone(launch_readiness_user_html(session))

    def test_email_only_launch_plan_ignores_missing_web_push(self) -> None:
        session = {
            "campaign": {
                "name": "Dusshera",
                "goal": "Sale",
                "objective": "Drive sales",
            },
            "audience": {"matched_count": 1},
            "channels": ["email", "web"],
            "launch_plan": {"launch_channels": ["email"]},
            "templates": [
                {
                    "channel": "email",
                    "template_id": "e1",
                    "fields": {
                        "subject": "Celebrate Dusshera",
                        "compiled_html": "<html><body><p>Shop ornaments</p></body></html>",
                    },
                }
            ],
        }
        self.assertIsNone(launch_readiness_user_html(session))

    def test_best_template_by_channel_prefers_renderable(self) -> None:
        rows = [
            {"channel": "email", "template_id": "empty", "fields": {"subject": "x"}},
            {
                "channel": "email",
                "template_id": "good",
                "fields": {
                    "subject": "Celebrate",
                    "compiled_html": "<html><body><p>Body</p></body></html>",
                },
            },
        ]
        picked = best_template_by_channel(rows)["email"]
        self.assertEqual(picked.get("template_id"), "good")
        self.assertTrue(template_ready_for_launch("email", picked))


if __name__ == "__main__":
    unittest.main()
