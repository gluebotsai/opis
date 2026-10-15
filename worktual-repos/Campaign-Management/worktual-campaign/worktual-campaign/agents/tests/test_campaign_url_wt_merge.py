"""Guard: email CTAs use a real destination or no button — never a static landing."""

from __future__ import annotations

import unittest

from app.agents.create_campaign import tool_functions as tf
from app.campaign_destination_url import resolve_campaign_destination_url


class CampaignUrlMergeTagTests(unittest.TestCase):
    def test_placeholder_cta_stripped_when_no_dest(self):
        templates = [
            {
                "channel": "email",
                "fields": {
                    "subject": "Hi",
                    "cta_url": "{{campaign_url}}",
                    "sections": [
                        {
                            "type": "cta",
                            "label": "Go",
                            "url": "{{campaign_url}}",
                        }
                    ],
                },
            }
        ]
        out = tf._ensure_campaign_url_merge_tags(templates, dest="")
        fields = out[0]["fields"]
        self.assertNotIn("cta_url", fields)
        self.assertEqual(fields["sections"], [])

    def test_compiled_html_hash_cta_unwrapped_without_dest(self):
        templates = [
            {
                "channel": "email",
                "fields": {
                    "subject": "Hi",
                    "compiled_html": (
                        '<html><body><a href="#" class="cta">Buy</a></body></html>'
                    ),
                    "pipeline": "compose",
                },
            }
        ]
        out = tf._ensure_campaign_url_merge_tags(templates, dest="")
        html = out[0]["fields"]["compiled_html"]
        self.assertNotIn("{{campaign_url}}", html)
        self.assertNotIn('href="#"', html)
        self.assertIn("Buy", html)

    def test_compiled_html_hash_cta_bakes_dest(self):
        templates = [
            {
                "channel": "email",
                "fields": {
                    "subject": "Hi",
                    "compiled_html": (
                        '<html><body><a href="#" class="cta">Buy</a></body></html>'
                    ),
                    "pipeline": "compose",
                },
            }
        ]
        dest = "https://shop.example.com/sale"
        out = tf._ensure_campaign_url_merge_tags(templates, dest=dest)
        html = out[0]["fields"]["compiled_html"]
        self.assertIn(f'href="{dest}"', html)

    def test_click_url_from_session_ignores_empty(self):
        self.assertEqual(tf._campaign_click_url_from_session({}), "")
        self.assertEqual(
            tf._campaign_click_url_from_session({"form_url": "https://forms.example/x"}),
            "https://forms.example/x",
        )

    def test_resolve_from_knowledge_text(self):
        url = resolve_campaign_destination_url(
            knowledge="Visit https://www.zifo.com/lola for details",
        )
        self.assertEqual(url, "https://www.zifo.com/lola")


if __name__ == "__main__":
    unittest.main()
