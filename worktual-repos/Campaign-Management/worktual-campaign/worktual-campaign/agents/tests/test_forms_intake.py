"""Tests for forms agent intake and campaign handoff."""

from __future__ import annotations

import unittest

from app.agents.forms.intake import (
    build_campaign_handoff_query,
    confirmation_prompt,
    form_readiness,
    queue_campaign_handoff,
)


class FormsIntakeTests(unittest.TestCase):
    def test_form_readiness_requires_fields(self):
        empty = form_readiness({"title": "Demo", "fields": []})
        self.assertFalse(empty["ready"])
        ok = form_readiness(
            {
                "title": "Demo",
                "fields": [{"label": "Email", "type": "email"}],
                "public_url": "https://example.com/f/demo",
            }
        )
        self.assertTrue(ok["ready"])
        self.assertTrue(ok["published"])
        self.assertEqual(ok["field_count"], 1)

    def test_build_campaign_handoff_query_includes_form_context(self):
        session = {
            "form_event_id": "evt-123",
            "form_design": {
                "title": "Book a demo",
                "fields": [
                    {"label": "Full name"},
                    {"label": "Work email"},
                ],
                "public_url": "https://app.example/f/demo",
            },
        }
        q = build_campaign_handoff_query(session, campaign_goal="Invite enterprise leads")
        self.assertIn("Invite enterprise leads", q)
        self.assertIn("Book a demo", q)
        self.assertIn("Full name", q)
        self.assertIn("https://app.example/f/demo", q)
        self.assertIn("evt-123", q)

    def test_queue_campaign_handoff_sets_pending(self):
        session: dict = {
            "form_design": {
                "title": "Signup",
                "fields": [{"label": "Email"}],
            }
        }
        result = queue_campaign_handoff(session, campaign_goal="Drive signups")
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "pending_confirmation")
        self.assertEqual(session["pending_route"]["module"], "create_campaign")
        self.assertIn("Drive signups", session["pending_route"]["query"])

    def test_queue_campaign_handoff_rejects_empty_form(self):
        session: dict = {"form_design": {"title": "Empty", "fields": []}}
        result = queue_campaign_handoff(session)
        self.assertFalse(result["ok"])
        self.assertIn("field", result["error"].lower())

    def test_confirmation_prompt_mentions_publish_when_unpublished(self):
        msg = confirmation_prompt(
            {"title": "Demo", "field_count": 3, "public_url": None}
        )
        self.assertTrue(
            "not published" in msg.lower() or "publish" in msg.lower()
        )
        self.assertIn("3 field", msg)
        self.assertNotIn("Reply yes", msg)


if __name__ == "__main__":
    unittest.main()
