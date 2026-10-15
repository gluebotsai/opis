"""Launch hydrates session templates from DB so edits win over stale session copy."""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents.create_campaign.tool_functions import (
    _hydrate_session_templates_from_db,
    _persist_canonical_email_templates,
)


class HydrateTemplatesTests(unittest.TestCase):
    def test_db_fields_overlay_session_cards(self):
        session = {
            "templates": [
                {
                    "template_id": "t1",
                    "channel": "whatsapp",
                    "fields": {"body": "old body"},
                }
            ]
        }

        async def run():
            with patch(
                "app.agents.create_campaign.tool_functions.list_session_templates",
                AsyncMock(
                    return_value=[
                        {
                            "template_id": "t1",
                            "channel": "whatsapp",
                            "fields": {"body": "edited body", "footer": "f"},
                        }
                    ]
                ),
            ):
                out = await _hydrate_session_templates_from_db(session, "s1")
                fields = out["templates"][0]["fields"]
                self.assertEqual(fields.get("body"), "edited body")
                self.assertEqual(fields.get("footer"), "f")
                self.assertEqual(len(out["templates"]), 1)

        asyncio.run(run())

    def test_does_not_append_historical_db_rows(self):
        session = {
            "templates": [
                {
                    "template_id": "t1",
                    "channel": "email",
                    "fields": {"subject": "A"},
                }
            ]
        }

        async def run():
            with patch(
                "app.agents.create_campaign.tool_functions.list_session_templates",
                AsyncMock(
                    return_value=[
                        {
                            "template_id": "t1",
                            "channel": "email",
                            "fields": {"subject": "A"},
                        },
                        {
                            "template_id": "t-old",
                            "channel": "email",
                            "fields": {"subject": "old"},
                        },
                    ]
                ),
            ):
                out = await _hydrate_session_templates_from_db(session, "s1")
                ids = [t["template_id"] for t in out["templates"]]
                self.assertEqual(ids, ["t1"])

        asyncio.run(run())

    def test_email_hydrate_prefers_richer_session_html_over_stale_db_shell(self):
        full_html = (
            "<!DOCTYPE html><html><body><p>"
            "We believe that looking great should not be complicated. "
            "Discover your new everyday wardrobe at BOOXOO today."
            "</p></body></html>"
        )
        session = {
            "templates": [
                {
                    "template_id": "t-email",
                    "channel": "email",
                    "fields": {
                        "subject": "New Season",
                        "compiled_html": full_html,
                    },
                }
            ]
        }

        async def run():
            with patch(
                "app.agents.create_campaign.tool_functions.list_session_templates",
                AsyncMock(
                    return_value=[
                        {
                            "template_id": "t-email",
                            "channel": "email",
                            "fields": {
                                "subject": "New Season",
                                "compiled_html": "<div></div>",
                                "sections": [
                                    {"type": "headline", "content": "BOOXOO"},
                                    {"type": "text", "content": "Hi"},
                                ],
                            },
                        }
                    ]
                ),
            ):
                out = await _hydrate_session_templates_from_db(session, "s1")
                fields = out["templates"][0]["fields"]
                self.assertIn("everyday wardrobe", fields.get("compiled_html", ""))

        asyncio.run(run())


class PersistCanonicalEmailTests(unittest.TestCase):
    def test_persist_writes_session_compiled_html(self):
        html = "<html><body><p>Preview body that must reach send</p></body></html>"
        session = {
            "templates": [
                {
                    "template_id": "tid-email",
                    "channel": "email",
                    "fields": {
                        "subject": "Launch",
                        "compiled_html": html,
                        "sections": [{"type": "text", "content": "Hi"}],
                    },
                }
            ]
        }
        captured: dict = {}

        async def run():
            async def fake_update(tid, fields, token=None):
                captured["tid"] = tid
                captured["fields"] = fields
                return {"template": {"fields": fields}}

            with patch(
                "app.template_store.update_template_fields",
                fake_update,
            ):
                out = await _persist_canonical_email_templates(session, token="t")
            self.assertEqual(captured["tid"], "tid-email")
            self.assertEqual(captured["fields"]["compiled_html"], html)
            self.assertEqual(
                out["templates"][0]["fields"]["compiled_html"], html
            )

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
