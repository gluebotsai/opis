"""Additive Hub skill routing (no change to legacy seven skills)."""

from __future__ import annotations

import unittest

from app.hub_super.registry import _audience_from_temp_rows, get_runner
from app.hub_super.skill_catalog import pipeline_for_intent


class HubNewSkillTests(unittest.TestCase):
    def test_intent_pipelines(self):
        self.assertEqual(pipeline_for_intent("send_approved_whatsapp"), ["whatsapp_send"])
        self.assertEqual(pipeline_for_intent("generate_image"), ["image_gen"])
        self.assertEqual(
            pipeline_for_intent("temp_audience_and_send"),
            ["temp_audience_send"],
        )

    def test_runners_registered(self):
        for sid in ("whatsapp_send", "image_gen", "temp_audience_send"):
            self.assertIsNotNone(get_runner(sid), sid)

    def test_rows_to_audience(self):
        emails, phones = _audience_from_temp_rows(
            [
                {"email": "a@example.com"},
                {"phone": "919876543210", "email": "b@example.com"},
            ]
        )
        self.assertEqual(emails, ["a@example.com", "b@example.com"])
        self.assertEqual(phones, ["919876543210"])


if __name__ == "__main__":
    unittest.main()
