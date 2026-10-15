"""Tests for Campaign A2A spoke (card, token, dispatch, Hub remainder format)."""

from __future__ import annotations

import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.a2a.catalog import intent_for_skill, skill_version
from app.a2a.escalate import build_remainder_body
from app.a2a.hub_ondemand_log import log_json_block
from app.a2a.payload import flatten_hub_message
from app.a2a.server import create_a2a_app
from app.config import get_settings


class CatalogTests(unittest.TestCase):
    def test_skill_maps(self):
        self.assertEqual(intent_for_skill("on-demand-send"), "on_demand_send")
        self.assertEqual(intent_for_skill("create-contact"), "create_contact")
        self.assertEqual(intent_for_skill("send-approved-whatsapp"), "send_approved_whatsapp")
        self.assertEqual(intent_for_skill("generate-image"), "generate_image")
        self.assertEqual(intent_for_skill("temp-audience-and-send"), "temp_audience_and_send")
        self.assertIsNone(intent_for_skill("unknown"))

    def test_skill_version_stable(self):
        self.assertEqual(skill_version(), skill_version())
        self.assertEqual(len(skill_version()), 16)


class PayloadTests(unittest.TestCase):
    def test_flatten_hub_message(self):
        flat = flatten_hub_message(
            {
                "message": {
                    "messageId": "m1",
                    "parts": [
                        {
                            "kind": "data",
                            "data": {
                                "source": "hub",
                                "organizationId": "1001",
                                "skillId": "campaign-report",
                                "campaign_id": "1060",
                            },
                        }
                    ],
                }
            }
        )
        self.assertEqual(flat["intent"], "campaign_report")
        self.assertEqual(flat["organization_id"], "1001")
        self.assertEqual(flat["payload"]["campaign_id"], "1060")

    def test_instruction_in_arguments_maps_to_request_text(self):
        flat = flatten_hub_message(
            {
                "message": {
                    "parts": [
                        {
                            "kind": "data",
                            "data": {
                                "source": "hub",
                                "organizationId": "1012",
                                "skillId": "on-demand-send",
                                "arguments": {
                                    "email": "a@example.com",
                                    "instruction": "Send nurture email about product X",
                                },
                            },
                        }
                    ],
                }
            }
        )
        self.assertEqual(
            flat["payload"].get("request_text"),
            "Send nurture email about product X",
        )
        self.assertEqual(flat["payload"].get("emails"), ["a@example.com"])


class RemainderFormatTests(unittest.TestCase):
    def test_hub_remainder_shape(self):
        body = build_remainder_body(
            cdp_id="bbbbbbbb-cccc-4ddd-8eee-ffff00000001",
            query="I was charged twice this month and I want that fixed now.",
            organization_id=1000,
            channel="chat",
            spoke="Campaign",
        )
        self.assertEqual(
            body,
            {
                "cdp_id": "bbbbbbbb-cccc-4ddd-8eee-ffff00000001",
                "spoke": "Campaign",
                "recent_event": {
                    "channel": "chat",
                    "query": "I was charged twice this month and I want that fixed now.",
                },
                "organization_id": 1000,
            },
        )


class A2AHttpTests(unittest.TestCase):
    def setUp(self):
        get_settings.cache_clear()
        # Keep unit tests off real DB (ACCOUNT_DATABASE_URL may be set in .env).
        self._env_patch = patch.dict(
            "os.environ", {"ACCOUNT_DATABASE_URL": ""}, clear=False
        )
        self._env_patch.start()
        get_settings.cache_clear()
        self.client = TestClient(create_a2a_app())

    def tearDown(self):
        self._env_patch.stop()
        get_settings.cache_clear()

    def test_health_token_store_memory(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("token_store"), "memory")

    def test_agent_card(self):
        res = self.client.get("/.well-known/agent-card.json")
        self.assertEqual(res.status_code, 200)
        card = res.json()
        self.assertEqual(card["id"], "worktual-campaign")
        self.assertEqual(card["protocolVersion"], "1.0")
        self.assertEqual(card["preferredTransport"], "JSONRPC")
        self.assertTrue(card["supportsAuthenticatedExtendedCard"])
        self.assertIn("tokenUrl", card)
        self.assertIn("oauth2", card["securitySchemes"])
        self.assertTrue(card["skills"])
        ids = {s["id"] for s in card["skills"]}
        self.assertIn("on-demand-send", ids)
        self.assertIn("create-contact", ids)
        self.assertIn("campaign-report", ids)
        for skill in card["skills"]:
            self.assertTrue(skill.get("inputSchema"), skill["id"])
            self.assertTrue(skill.get("outputSchema"), skill["id"])
            self.assertEqual(
                skill["outputSchema"],
                "/a2a/contracts/skill-result.v1.json",
            )
            self.assertTrue(skill.get("security"))
        caps = card["capabilities"]["extensions"][0]["params"]
        self.assertEqual(
            caps["contractSchema"],
            "/a2a/contracts/worktual-envelope.v1.json",
        )
        self.assertIn("excludedCapabilities", caps)

    def test_contract_schemas(self):
        env = self.client.get("/a2a/contracts/worktual-envelope.v1.json")
        self.assertEqual(env.status_code, 200)
        self.assertIn("skillId", env.json()["properties"])

        result = self.client.get("/a2a/contracts/skill-result.v1.json")
        self.assertEqual(result.status_code, 200)
        self.assertIn("ok", result.json()["required"])

        for skill_id in (
            "on-demand-send",
            "create-contact",
            "campaign-report",
            "stop-channel",
            "resume-channel",
            "stop-campaign",
            "create-contact-and-send",
            "send-approved-whatsapp",
            "generate-image",
            "temp-audience-and-send",
        ):
            res = self.client.get(f"/a2a/contracts/skills/{skill_id}.v1.json")
            self.assertEqual(res.status_code, 200, skill_id)
            self.assertEqual(res.json()["type"], "object")

        missing = self.client.get("/a2a/contracts/skills/no-such-skill.v1.json")
        self.assertEqual(missing.status_code, 404)

    def test_extended_agent_card_requires_bearer(self):
        res = self.client.get("/a2a/agent-card/extended")
        self.assertEqual(res.status_code, 401)

        s = get_settings()
        tok = self.client.post(
            "/token",
            json={
                "grant_type": "client_credentials",
                "client_id": s.a2a_spoke_client_id,
                "client_secret": s.a2a_spoke_client_secret,
                "a2a_server_name": "worktual-campaign",
            },
        ).json()["access_token"]
        res = self.client.get(
            "/a2a/agent-card/extended",
            headers={"Authorization": f"Bearer {tok}"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        card = res.json()
        self.assertTrue(card.get("additionalInterfaces"))
        skill = next(s for s in card["skills"] if s["id"] == "on-demand-send")
        ext = skill["extensions"][0]["params"]
        self.assertEqual(ext["risk"], "high_impact")
        self.assertEqual(ext["specialist"], "on_demand")
        self.assertTrue(ext["inputSchema"])
        self.assertTrue(ext["outputSchema"])

    def test_token_client_credentials(self):
        s = get_settings()
        res = self.client.post(
            "/token",
            json={
                "grant_type": "client_credentials",
                "client_id": s.a2a_spoke_client_id,
                "client_secret": s.a2a_spoke_client_secret,
                "a2a_server_name": "worktual-campaign",
            },
        )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        self.assertIn("access_token", data)
        self.assertEqual(data["token_type"], "Bearer")
        self.assertIn("refresh_token", data)

    def test_invoke_requires_bearer(self):
        res = self.client.post(
            "/",
            json={"jsonrpc": "2.0", "id": "1", "method": "message/send", "params": {}},
        )
        self.assertIn(res.status_code, {401, 409})

    def test_invoke_dispatches_to_super_agent(self):
        s = get_settings()
        tok = self.client.post(
            "/token",
            json={
                "grant_type": "client_credentials",
                "client_id": s.a2a_spoke_client_id,
                "client_secret": s.a2a_spoke_client_secret,
                "a2a_server_name": "worktual-campaign",
            },
        ).json()["access_token"]

        with patch(
            "app.a2a.dispatch.run_hub_task",
            new=AsyncMock(
                return_value={
                    "status": "completed",
                    "pipeline": ["contacts"],
                    "result": {"contact_id": "c1"},
                    "warnings": [],
                    "errors": [],
                    "step_results": [],
                }
            ),
        ):
            res = self.client.post(
                "/",
                headers={"Authorization": f"Bearer {tok}"},
                json={
                    "jsonrpc": "2.0",
                    "id": "1",
                    "method": "message/send",
                    "params": {
                        "message": {
                            "role": "user",
                            "messageId": "m1",
                            "parts": [
                                {
                                    "kind": "data",
                                    "data": {
                                        "source": "hub",
                                        "organizationId": "1001",
                                        "skillId": "create-contact",
                                        "first_name": "Ada",
                                        "email": "ada@example.com",
                                        "campaignToken": "test-campaign-jwt",
                                    },
                                }
                            ],
                        }
                    },
                },
            )
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["result"]["status"]["state"], "completed")
        arts = body["result"]["artifacts"]
        self.assertTrue(arts)
        self.assertEqual(
            arts[0]["parts"][0]["data"]["result"]["contact_id"], "c1"
        )

    def test_escalate_skips_when_source_hub(self):
        res = self.client.post(
            "/internal/escalate-hub",
            json={
                "source": "hub",
                "cdp_id": "x",
                "query": "should not send",
                "organization_id": 1000,
            },
        )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json().get("skipped"))


class A2ADbTokenSaveTests(unittest.IsolatedAsyncioTestCase):
    async def test_save_tokens_writes_db(self):
        from app.a2a import clients as clients_mod

        mock_conn = AsyncMock()
        mock_conn.execute = AsyncMock(side_effect=["INSERT 0 1", "UPDATE 1"])
        mock_conn.close = AsyncMock()

        with (
            patch.dict("os.environ", {"ACCOUNT_DATABASE_URL": "postgresql://x/y"}, clear=False),
            patch.object(clients_mod, "_connect", new=AsyncMock(return_value=mock_conn)),
        ):
            get_settings.cache_clear()
            await clients_mod.save_tokens(
                "worktual-campaign",
                access_token="access-abc",
                refresh_token="refresh-xyz",
                access_ttl_s=3600,
                refresh_ttl_s=7200,
                client_id="worktual-hub-campaign",
                client_secret="secret",
            )
        get_settings.cache_clear()
        self.assertGreaterEqual(mock_conn.execute.await_count, 2)
        # Second call should be the UPDATE of tokens
        update_sql = mock_conn.execute.await_args_list[1].args[0]
        self.assertIn("access_token", update_sql)
        self.assertIn("refresh_token", update_sql)
        mock_conn.close.assert_awaited()


class A2ARpcLogTests(unittest.TestCase):
    def test_log_json_block_pretty_and_redacts(self):
        import tempfile
        from pathlib import Path

        dest = Path(tempfile.mkdtemp()) / "hub-ondemand.log"
        block = log_json_block(
            "A2A REQUEST RECEIVED  method=message/send",
            {
                "jsonrpc": "2.0",
                "id": "d9309cb7-6b5e-4326-909d-1a1c92b71724",
                "method": "message/send",
                "params": {
                    "message": {
                        "role": "user",
                        "parts": [
                            {
                                "kind": "data",
                                "data": {
                                    "skillId": "on-demand-send",
                                    "email": "govindaraajan15@gmail.com",
                                    "access_token": "secret-token",
                                },
                            }
                        ],
                    }
                },
            },
            extra_lines=["error: none"],
            path=dest,
        )
        self.assertIn('"jsonrpc": "2.0"', block)
        self.assertIn('"method": "message/send"', block)
        self.assertIn("govindaraajan15@gmail.com", block)
        self.assertIn("***REDACTED***", block)
        self.assertNotIn("secret-token", block)
        self.assertIn("error: none", dest.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
