"""Tests for Campaign SFT agent catalog on :8005 FastAPI."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.socket_server import api


class SftAgentCatalogTests(unittest.TestCase):
    def setUp(self):
        self._env = patch.dict(
            "os.environ",
            {"INTERNAL_SERVICE_KEY": "test-sft-key"},
            clear=False,
        )
        self._env.start()
        from app.config import get_settings

        get_settings.cache_clear()
        self.client = TestClient(api)
        self.headers = {"x-internal-service-key": "test-sft-key"}

    def tearDown(self):
        from app.config import get_settings

        get_settings.cache_clear()
        self._env.stop()

    def test_unauthorized_without_key(self):
        res = self.client.get("/internal/v1/agents")
        self.assertEqual(res.status_code, 401)

    def test_unauthorized_wrong_key(self):
        res = self.client.get(
            "/internal/v1/agents",
            headers={"x-internal-service-key": "nope"},
        )
        self.assertEqual(res.status_code, 401)

    def test_list_agents(self):
        res = self.client.get("/internal/v1/agents", headers=self.headers)
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["version"], "1.0.0")
        self.assertEqual(body["source"], "campaign-mas-agent-definitions")
        ids = {a["id"] for a in body["agents"]}
        self.assertIn("campaign_super", ids)
        self.assertIn("audience", ids)
        self.assertIn("contact", ids)
        self.assertIn("launch_scheduling", ids)
        self.assertEqual(body["agentCount"], len(body["agents"]))
        self.assertGreaterEqual(body["agentCount"], 20)

    def test_detail_contact(self):
        res = self.client.get("/internal/v1/agents/contact", headers=self.headers)
        self.assertEqual(res.status_code, 200, res.text)
        agent = res.json()["agent"]
        self.assertEqual(agent["id"], "contact")
        self.assertEqual(agent["layer"], "executor")
        self.assertEqual(agent["family"], "campaign_coworker")
        self.assertTrue(agent["systemPrompt"])
        self.assertEqual(len(agent["promptVersion"]), 12)
        self.assertTrue(agent["tools"])
        self.assertTrue(agent["sampleConversations"])
        self.assertGreaterEqual(len(agent["sampleConversations"]), 1)

    def test_export_matches_list_count(self):
        listed = self.client.get("/internal/v1/agents", headers=self.headers).json()
        exported = self.client.get("/internal/v1/agents/export", headers=self.headers).json()
        self.assertEqual(exported["agentCount"], listed["agentCount"])
        self.assertEqual(len(exported["agents"]), listed["agentCount"])
        self.assertIn("systemPrompt", exported["agents"][0])

    def test_unknown_agent_404(self):
        res = self.client.get("/internal/v1/agents/no-such-agent", headers=self.headers)
        self.assertEqual(res.status_code, 404)

    def test_prompt_version_stable(self):
        a = self.client.get("/internal/v1/agents/contact", headers=self.headers).json()["agent"]
        b = self.client.get("/internal/v1/agents/contact", headers=self.headers).json()["agent"]
        self.assertEqual(a["promptVersion"], b["promptVersion"])


if __name__ == "__main__":
    unittest.main()
