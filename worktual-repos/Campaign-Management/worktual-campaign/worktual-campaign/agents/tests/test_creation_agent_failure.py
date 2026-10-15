"""Total template generation failure emits failed progress + structured result."""

from __future__ import annotations

import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents.template_library.creation_agent import run_creation_agent


class CreationAgentFailureTests(unittest.TestCase):
    def test_all_channels_fail_emits_failed_progress(self):
        events: list[dict] = []

        async def event_callback(event: dict) -> None:
            events.append(event)

        async def run():
            with (
                patch(
                    "app.agents.template_library.creation_agent.fetch_campaign_knowledge",
                    AsyncMock(return_value=""),
                ),
                patch(
                    "app.agents.template_library.creation_agent.list_recent_org_templates",
                    AsyncMock(return_value=[]),
                ),
                patch(
                    "app.agents.template_library.creation_agent.plan_generation",
                    AsyncMock(
                        return_value=(
                            {"narrative": "test"},
                            [
                                {"channel": "email", "design_plan": {"channel": "email", "sections": ["headline", "text", "cta"]}},
                                {"channel": "whatsapp", "design_plan": {"channel": "whatsapp", "preset_id": "wa_header_hook"}},
                            ],
                            {},
                        )
                    ),
                ),
                patch(
                    "app.agents.template_library.creation_agent._run_channel_agent",
                    AsyncMock(side_effect=RuntimeError("llm down")),
                ),
            ):
                result = await run_creation_agent(
                    campaign={"name": "T", "goal": "G", "objective": "O"},
                    audience={},
                    channels=["email", "whatsapp"],
                    event_callback=event_callback,
                )
                self.assertFalse(result.get("ok"))
                self.assertEqual(result.get("failed_channels"), ["email", "whatsapp"])
                final = events[-1]
                self.assertEqual(final["type"], "template_progress")
                payload = final["payload"]
                self.assertEqual(payload["status"], "failed")
                self.assertEqual(payload["percent"], 100)
                self.assertEqual(payload["completed_channels"], [])
                self.assertEqual(payload["failed_channels"], ["email", "whatsapp"])

        asyncio.run(run())

    def test_success_does_not_mark_persist_complete(self):
        events: list[dict] = []

        async def event_callback(event: dict) -> None:
            events.append(event)

        async def _ok_channel(*args, **kwargs):
            channel = args[0] if args else "email"
            return {
                "template_id": f"t-{channel}",
                "channel": channel,
                "fields": {"body": "hello from campaign", "compiled_html": "<p>hi</p>"},
            }

        async def run():
            with (
                patch(
                    "app.agents.template_library.creation_agent.fetch_campaign_knowledge",
                    AsyncMock(return_value=""),
                ),
                patch(
                    "app.agents.template_library.creation_agent.list_recent_org_templates",
                    AsyncMock(return_value=[]),
                ),
                patch(
                    "app.agents.template_library.creation_agent.plan_generation",
                    AsyncMock(
                        return_value=(
                            {"narrative": "test"},
                            [
                                {"channel": "email", "design_plan": {"channel": "email"}},
                            ],
                            {},
                        )
                    ),
                ),
                patch(
                    "app.agents.template_library.creation_agent._run_channel_agent",
                    AsyncMock(side_effect=_ok_channel),
                ),
            ):
                result = await run_creation_agent(
                    campaign={"name": "T", "goal": "G", "objective": "O"},
                    audience={},
                    channels=["email"],
                    event_callback=event_callback,
                    use_phase2_email=False,
                )
                self.assertTrue(result.get("ok"))
                final = events[-1]
                self.assertEqual(final["type"], "template_progress")
                payload = final["payload"]
                self.assertEqual(payload["status"], "generating")
                self.assertEqual(payload["percent"], 96)
                self.assertEqual(payload["label"], "Saving templates…")

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
