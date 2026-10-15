"""Role-based access on the SQL engine and the Cypher executor. No live Gemma."""

from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

PACK = Path(__file__).resolve().parents[1]
KG_ROOT = PACK / "CCAAS_kg_context_agent"
sys.path.insert(0, str(PACK.parent))
if str(KG_ROOT) not in sys.path:
    sys.path.insert(0, str(KG_ROOT))

from reports_analytics_agent_contact_center_v2.core.access import (
    AccessDenied,
    assert_scope_allowed,
    grant_for,
    normalize_role,
)
from reports_analytics_agent_contact_center_v2.core.kg.role import ROLE_SQL, lookup_cc_role
from reports_analytics_agent_contact_center_v2.core.loader import merge_effective
from reports_analytics_agent_contact_center_v2.core.sql.executor import execute_sql_task
from reports_analytics_agent_contact_center_v2.core.sql.run_kpi import run_kpi
from reports_analytics_agent_contact_center_v2.core.sql.views import P_USER, cte_body, param_token

ORG = 1012
ADMIN_USER = 1
AGENT_USER = 44
USER_TOKEN = param_token(P_USER)


def _access() -> dict:
    return merge_effective()["access"]


def _stub_meili_neo4j() -> None:
    sys.modules.setdefault("meilisearch", MagicMock())
    sys.modules.setdefault("neo4j", MagicMock())


class SqlMatrixTests(unittest.TestCase):
    def test_agent_org_is_denied(self) -> None:
        with self.assertRaises(AccessDenied):
            assert_scope_allowed("agent", "org", _access())
        self.assertEqual(grant_for("agent", "org", _access()), "deny")
        out = run_kpi(
            "total",
            organization_id=ORG,
            user_id=AGENT_USER,
            role="agent",
            scope_level="org",
            time_window="last 7 days",
        )
        self.assertEqual(out["error_type"], "DENY")
        self.assertIn("scope_denied", out["error"])

    def test_agent_own_is_allowed_to_compile(self) -> None:
        assert_scope_allowed("agent", "own", _access())
        out = run_kpi(
            "total",
            organization_id=ORG,
            user_id=AGENT_USER,
            role="agent",
            scope_level="own",
            time_window="last 7 days",
        )
        self.assertNotEqual(out.get("error_type"), "DENY")
        self.assertNotIn("scope_denied", str(out.get("error") or ""))

    def test_admin_org_is_allowed_to_compile(self) -> None:
        assert_scope_allowed("admin", "org", _access())
        out = run_kpi(
            "total",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            scope_level="org",
            time_window="last 7 days",
        )
        self.assertNotEqual(out.get("error_type"), "DENY")
        self.assertIn(out["status"], {"compiled", "ok"})

    def test_agent_queue_without_ids_denied(self) -> None:
        out = run_kpi(
            "total",
            organization_id=ORG,
            user_id=AGENT_USER,
            role="agent",
            scope_level="queue",
            time_window="last 7 days",
        )
        self.assertEqual(out["error_type"], "DENY")
        self.assertIn("queue_ids", out["error"])

    def test_stored_admin_names_normalize(self) -> None:
        access = _access()
        for name in ("administrator", "manager", "supervisor"):
            self.assertEqual(normalize_role(name, access), "admin")
        self.assertEqual(normalize_role("agent", access), "agent")


class SqlScopedCteTests(unittest.TestCase):
    def test_admin_conversations_are_org_wide(self) -> None:
        body = cte_body("conversations", "admin")
        self.assertIn("WHERE TRUE", body)
        self.assertNotIn(USER_TOKEN, body)
        self.assertNotIn("assigned_user_id =", body)

    def test_agent_conversations_bind_the_user(self) -> None:
        body = cte_body("conversations", "agent")
        self.assertIn(f"assigned_user_id = {USER_TOKEN}", body)
        self.assertIn("assigned_agent_id", body)
        self.assertIn("rpt_agents", body)
        self.assertIn("setup_user_id", body)

    def test_agent_tasks_bind_assigned_user(self) -> None:
        body = cte_body("tasks", "agent")
        self.assertIn(f"assigned_user_id = {USER_TOKEN}", body)

    def test_agent_child_views_follow_conversations(self) -> None:
        for name in ("messages", "missed_contacts"):
            body = cte_body(name, "agent")
            self.assertIn("rpt_conversations", body)


class SqlEarlyDenyTests(unittest.TestCase):
    def test_agent_org_denied_before_llm(self) -> None:
        def boom(*_a, **_k):
            raise AssertionError("LLM must not run on deny")

        out = execute_sql_task(
            {
                "path": "certified_metric",
                "goal": "how many conversations started",
                "time": "last 7 days",
                "scope": "org",
                "slice": [],
            },
            organization_id=ORG,
            user_id=AGENT_USER,
            role="agent",
            dsn="postgresql://unused",
            call_llm=boom,
        )
        self.assertEqual(out["error_type"], "DENY")
        self.assertIsNone(out.get("loop"))

    def test_agent_queue_without_ids_denied_before_llm(self) -> None:
        def boom(*_a, **_k):
            raise AssertionError("LLM must not run on deny")

        out = execute_sql_task(
            {
                "path": "certified_metric",
                "goal": "queue volume",
                "time": "last 7 days",
                "scope": "queue",
                "slice": [],
            },
            organization_id=ORG,
            user_id=AGENT_USER,
            role="agent",
            dsn="postgresql://unused",
            call_llm=boom,
        )
        self.assertEqual(out["error_type"], "DENY")
        self.assertIn("queue_ids", out["error"])


class KgDbRoleLookupTests(unittest.TestCase):
    def test_lookup_maps_stored_admin_names(self) -> None:
        for stored in ("administrator", "manager", "supervisor", "admin"):
            role = lookup_cc_role(
                "postgresql://unused",
                ORG,
                ADMIN_USER,
                fetch=lambda *_a, **_k: [{"role_name": stored}],
            )
            self.assertEqual(role, "admin", stored)

    def test_lookup_maps_agent(self) -> None:
        role = lookup_cc_role(
            "postgresql://unused",
            ORG,
            AGENT_USER,
            fetch=lambda *_a, **_k: [{"role_name": "agent"}],
        )
        self.assertEqual(role, "agent")

    def test_lookup_query_binds_contact_center_product(self) -> None:
        seen: dict = {}

        def fetch(dsn, sql, params):
            seen["sql"] = sql
            seen["params"] = params
            return [{"role_name": "agent"}]

        lookup_cc_role("postgresql://unused", 1003, 99, fetch=fetch)
        self.assertIn("setup_user_product_access", seen["sql"])
        self.assertIn("setup_roles", seen["sql"])
        self.assertEqual(seen["params"], (99, 1003, "contact-center"))
        self.assertIn("product_id", ROLE_SQL)

    def test_lookup_empty_row_denies(self) -> None:
        with self.assertRaises(AccessDenied):
            lookup_cc_role(
                "postgresql://unused",
                ORG,
                AGENT_USER,
                fetch=lambda *_a, **_k: [],
            )

    def test_lookup_db_error_denies(self) -> None:
        def boom(*_a, **_k):
            raise RuntimeError("down")

        with self.assertRaises(AccessDenied):
            lookup_cc_role("postgresql://unused", ORG, ADMIN_USER, fetch=boom)

    def test_lookup_empty_dsn_denies(self) -> None:
        with self.assertRaises(AccessDenied):
            lookup_cc_role("", ORG, ADMIN_USER, fetch=lambda *_a, **_k: [{"role_name": "admin"}])


class KgRoleWireTests(unittest.TestCase):
    def _run(self, *, role: str, looked_up: str | AccessDenied):
        from reports_analytics_agent_contact_center_v2.core.kg.executor import execute_kg_task

        seen: list[str] = []

        def fake_generate(request, role="operator", llm=None, **_kw):
            seen.append(role)
            return {
                "content": "store: kg\nrow 1: kind=observed; n=1",
                "rows": [{"n": 1}],
                "reasoning": {"aligned_to_task": "yes"},
            }

        def role_lookup(_dsn, _org, _user):
            if isinstance(looked_up, AccessDenied):
                raise looked_up
            return looked_up

        fake = types.ModuleType("src.response")

        class ChatRequest:
            def __init__(self, **kwargs):
                for key, value in kwargs.items():
                    setattr(self, key, value)

        fake.ChatRequest = ChatRequest
        fake.Generate_response = fake_generate
        with patch.dict(sys.modules, {"src.response": fake}):
            out = execute_kg_task(
                {"goal": "Why abandoned rose", "time": "last 7 days", "scope": "org"},
                organization_id=ORG,
                user_id=ADMIN_USER,
                role=role,
                dsn="postgresql://unused",
                llm=object(),
                role_lookup=role_lookup,
            )
        return out, seen

    def test_execute_kg_task_uses_looked_up_admin_and_agent(self) -> None:
        admin, seen_admin = self._run(role="agent", looked_up="admin")
        agent, seen_agent = self._run(role="admin", looked_up="agent")
        self.assertEqual(seen_admin, ["admin"])
        self.assertEqual(seen_agent, ["agent"])
        self.assertEqual(admin["status"], "ok")
        self.assertEqual(agent["store"], "kg")

    def test_ui_admin_cannot_elevate_when_db_says_agent(self) -> None:
        out, seen = self._run(role="admin", looked_up="agent")
        self.assertEqual(seen, ["agent"])
        self.assertEqual(out["status"], "ok")

    def test_missing_product_access_denies_before_cypher(self) -> None:
        out, seen = self._run(
            role="admin",
            looked_up=AccessDenied("scope_denied: no contact-center product access for this user."),
        )
        self.assertEqual(seen, [])
        self.assertEqual(out["error_type"], "DENY")
        self.assertEqual(out["store"], "kg")
        self.assertIn("scope_denied", out["error"])

    def test_db_error_denies_before_cypher(self) -> None:
        out, seen = self._run(
            role="admin",
            looked_up=AccessDenied("scope_denied: contact-center role could not be resolved."),
        )
        self.assertEqual(seen, [])
        self.assertEqual(out["error_type"], "DENY")


class KgProductScopeTests(unittest.TestCase):
    def test_apply_product_scope_excludes_other_products(self) -> None:
        _stub_meili_neo4j()
        from src.tools import apply_product_scope

        ok, scoped = apply_product_scope("MATCH (c:Conversation) RETURN c")
        self.assertTrue(ok)
        self.assertIn("!Marketing", scoped)
        self.assertIn("!Sales", scoped)
        self.assertIn("!Support", scoped)


def _import_generate() -> tuple[object, object] | None:
    _stub_meili_neo4j()
    try:
        from src.response import ChatRequest, Generate_response
    except Exception:
        return None
    return ChatRequest, Generate_response


class KgPromptScopeTests(unittest.TestCase):
    def test_generate_response_injects_data_scope(self) -> None:
        imported = _import_generate()
        if imported is None:
            self.skipTest("Cypher agent extras (pydantic) are not importable")
        ChatRequest, Generate_response = imported

        class StubLlm:
            def __init__(self) -> None:
                self.system = ""

            def run(self, messages=None, tools=None, tool_choice=None):
                self.system = str((messages or [{}])[0].get("content") or "")
                return {"content": "store: kg\nRESULT: 0 rows", "tool_calls": None}

        def _run(role: str) -> str:
            llm = StubLlm()
            req = ChatRequest(
                sessionID=f"rbac-{role}",
                query="",
                organization_id=str(ORG),
                user_id=str(AGENT_USER if role != "admin" else ADMIN_USER),
                goal="Follow end_actor for abandoned",
                time="last 7 days",
            )
            with (
                patch("src.response.search_business_concepts", return_value={"hits": []}),
                patch("src.response.maybe_compact_context", return_value=None),
                patch("src.response.build_tool_handlers", return_value={}),
            ):
                Generate_response(req, role=role, llm=llm)
            return llm.system

        admin_prompt = _run("admin")
        agent_prompt = _run("agent")
        self.assertIn("data_scope: org", admin_prompt)
        self.assertNotIn("data_scope: mine", admin_prompt)
        self.assertIn("data_scope: mine", agent_prompt)
        self.assertIn("assigned_user_id", agent_prompt)
        self.assertIn("assigned_agent_id", agent_prompt)


class KgPromptTemplateTests(unittest.TestCase):
    def test_system_prompt_states_org_and_mine_rules(self) -> None:
        from src.prompt import system_prompt

        admin = system_prompt.replace("<data_scope>", "org")
        agent = system_prompt.replace("<data_scope>", "mine")
        self.assertIn("data_scope: org", admin)
        self.assertIn("full access to all data", admin)
        self.assertIn("data_scope: mine", agent)
        self.assertIn("assigned_user_id", agent)
        self.assertIn("assigned_agent_id", agent)
        self.assertIn("<user_id>", agent)


class KgHttpRoleTests(unittest.TestCase):
    def test_chat_passes_looked_up_role(self) -> None:
        _stub_meili_neo4j()
        try:
            from fastapi.testclient import TestClient
            from fastapi_service.main import app
        except Exception:
            self.skipTest("FastAPI TestClient is not importable")

        seen: list[str] = []

        def fake_generate(request, role="operator", llm=None, **_kw):
            seen.append(role)
            return {"content": "store: kg\nRESULT: 0 rows", "rows": [], "tool_calls": []}

        payload = {
            "sessionID": "rbac-chat",
            "query": "why abandoned",
            "organization_id": "1003",
            "user_id": "1016",
            "goal": "Follow end_actor",
        }
        with (
            patch("fastapi_service.main.get_user_role", return_value="admin"),
            patch("fastapi_service.main.Generate_response", fake_generate),
            patch("src.llm.LOWLLM", MagicMock),
            patch("fastapi_service.main.build_tool_handlers", return_value={}),
        ):
            client = TestClient(app)
            resp = client.post("/chat", json=payload)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(seen, ["admin"])


if __name__ == "__main__":
    unittest.main()
