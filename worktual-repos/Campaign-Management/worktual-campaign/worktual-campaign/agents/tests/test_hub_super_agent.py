"""Unit tests for Hub Super Agent routing and sequential execution."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from app.hub_super.orchestrator import run_hub_task
from app.hub_super.router import route_pipeline
from app.hub_super.schemas import normalize_hub_request
from app.hub_super.skill_catalog import INTENT_PIPELINES, agent_card, skill_ids


class HubSuperSchemasTests(unittest.TestCase):
    def test_normalize_requires_token_and_intent(self):
        req = normalize_hub_request({"intent": "on_demand_send"})
        codes = {e["code"] for e in req["validation_errors"]}
        self.assertIn("MISSING_TOKEN", codes)

    def test_normalize_merges_flat_payload(self):
        req = normalize_hub_request(
            {
                "intent": "create_contact",
                "token": "t",
                "first_name": "Ada",
                "email": "ada@example.com",
            }
        )
        self.assertEqual(req["payload"]["first_name"], "Ada")
        self.assertEqual(req["payload"]["email"], "ada@example.com")
        self.assertEqual(req["validation_errors"], [])


class HubSuperRouterTests(unittest.TestCase):
    def test_intent_on_demand(self):
        routed = route_pipeline({"intent": "on_demand_send"})
        self.assertTrue(routed["ok"])
        self.assertEqual(routed["pipeline"], ["on_demand"])

    def test_intent_create_contact_and_send(self):
        routed = route_pipeline({"intent": "create_contact_and_send"})
        self.assertTrue(routed["ok"])
        self.assertEqual(routed["pipeline"], ["contacts", "on_demand"])

    def test_explicit_pipeline(self):
        routed = route_pipeline({"pipeline": ["monitoring"]})
        self.assertTrue(routed["ok"])
        self.assertEqual(routed["pipeline"], ["monitoring"])

    def test_unknown_intent(self):
        routed = route_pipeline({"intent": "dance"})
        self.assertFalse(routed["ok"])

    def test_skill_catalog_covers_runners(self):
        self.assertEqual(set(skill_ids()), {"on_demand", "contacts", "monitoring"})
        for steps in INTENT_PIPELINES.values():
            for skill in steps:
                self.assertIn(skill, skill_ids())

    def test_agent_card_shape(self):
        card = agent_card()
        self.assertTrue(card["no_clarification"])
        self.assertEqual(card["execution"], "sequential")
        self.assertEqual(len(card["skills"]), 3)


class HubSuperOrchestratorTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_validation_no_clarification(self):
        result = await run_hub_task({"intent": "on_demand_send"})
        self.assertEqual(result["status"], "failed")
        self.assertNotIn("needs_clarification", result)
        self.assertTrue(result["errors"])

    async def test_sequential_contacts_then_on_demand(self):
        contact_out = {
            "ok": True,
            "skill": "contacts",
            "status": "ok",
            "contact_id": "c1",
            "contact": {"id": "c1", "email": "a@b.com", "first_name": "Ada"},
        }
        on_demand_out = {
            "ok": True,
            "skill": "on_demand",
            "status": "ok",
            "campaign_id": "camp-9",
        }

        with (
            patch(
                "app.hub_super.registry.SKILL_RUNNERS",
                {
                    "contacts": AsyncMock(return_value=contact_out),
                    "on_demand": AsyncMock(return_value=on_demand_out),
                    "monitoring": AsyncMock(),
                },
            ) as runners,
        ):
            result = await run_hub_task(
                {
                    "intent": "create_contact_and_send",
                    "token": "tok",
                    "payload": {
                        "first_name": "Ada",
                        "email": "a@b.com",
                        "request_text": "Email Ada about CRM",
                    },
                }
            )

        self.assertEqual(result["status"], "completed")
        self.assertEqual(result["pipeline"], ["contacts", "on_demand"])
        self.assertEqual(result["result"].get("campaign_id"), "camp-9")
        self.assertEqual(result["result"].get("contact_id"), "c1")
        self.assertEqual(runners["contacts"].await_count, 1)
        self.assertEqual(runners["on_demand"].await_count, 1)
        # On-demand receives prior contacts in context
        od_ctx = runners["on_demand"].await_args.args[0]
        self.assertEqual(od_ctx["prior"]["contacts"]["contact_id"], "c1")

    async def test_monitoring_missing_campaign_id_fails_structurally(self):
        from app.hub_super.sub_agents.monitoring_agent import run_monitoring_agent

        out = await run_monitoring_agent(
            {
                "token": "tok",
                "intent": "campaign_report",
                "payload": {},
                "prior": {},
            }
        )
        self.assertFalse(out["ok"])
        self.assertEqual(out["errors"][0]["code"], "MISSING_CAMPAIGN_ID")


if __name__ == "__main__":
    unittest.main()
