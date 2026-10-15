"""Domain-facing SQL executor turn. Mock LLM. No Domain prompt."""

from __future__ import annotations

import json
import os
import unittest
from pathlib import Path

PACK = Path(__file__).resolve().parents[1]
import sys

sys.path.insert(0, str(PACK.parent))

from reports_analytics_agent_contact_center_v2.core.context import executor_user_payload
from reports_analytics_agent_contact_center_v2.core.examples import load_sql_examples, pick_sql_examples
from reports_analytics_agent_contact_center_v2.core.sql.executor import execute_sql_task
from reports_analytics_agent_contact_center_v2.core.sql.views import select_view_names, view_cards_for_prompt

ORG = 1012
ADMIN_USER = 1
AGENT_USER = 1
DSN = os.environ.get("DATABASE_URL")


def _load_env() -> None:
    env = Path("/home/vectone/Uday/report module/.env")
    if not env.exists() or os.environ.get("DATABASE_URL"):
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    global DSN
    DSN = os.environ.get("DATABASE_URL")


_load_env()


class ExecutorContextTests(unittest.TestCase):
    def test_views_book_includes_joins_and_is_bounded(self) -> None:
        names = select_view_names("admin", "list conversations for a customer", ["channel"])
        self.assertIn("conversations", names)
        self.assertLessEqual(len(names), 6)
        book = view_cards_for_prompt("admin", names)
        self.assertIn("joins:", book)
        self.assertIn("rpt.queues", book)
        self.assertLess(len(book) // 4, 12000)

    def test_examples_are_similarity_picked_not_whole_file(self) -> None:
        all_ex = load_sql_examples()
        self.assertGreater(len(all_ex), 3)
        picked = pick_sql_examples("who is ready right now", all_ex, top_k=3)
        self.assertEqual(len(picked), 3)
        joined = " ".join(str(x.get("goal") or "") for x in picked)
        self.assertIn("ready", joined.lower())

    def test_transferred_list_example_uses_transferred_at(self) -> None:
        all_ex = load_sql_examples()
        picked = pick_sql_examples("list the conversations that were transferred", all_ex, top_k=3)
        joined = "\n".join(str(x.get("sql") or "") for x in picked).lower()
        self.assertIn("transferred_at", joined)
        self.assertNotIn("resolution_code", joined)
        payload = executor_user_payload(
            task={
                "goal": "List conversations that have transferred_at set. Not resolution_code transferred.",
                "path": "free_sql",
                "time": "all time",
                "slice": [],
                "answer_type": "list",
            },
            role="admin",
            path="free_sql",
            time_echo="all time",
            start=None,
            end=None,
        )
        meaning = payload.get("certified_meaning") or ""
        self.assertIn("transferred_at", meaning.lower())
        self.assertIn("resolution_code", meaning.lower())

    def test_certified_payload_has_no_org_id(self) -> None:
        payload = executor_user_payload(
            task={"goal": "handled this week", "path": "certified_metric", "time": "this week", "slice": ["status"]},
            role="admin",
            path="certified_metric",
            time_echo="this week Monday–Sunday (UTC)",
            start="2026-01-01T00:00:00+00:00",
            end="2026-01-08T00:00:00+00:00",
        )
        blob = json.dumps(payload)
        self.assertNotIn(":org_id", blob)
        self.assertNotIn("ccass.", blob)
        aliases = payload.get("dimension_aliases") or ""
        self.assertTrue("status" in aliases.lower())
        self.assertIn("metric_cards", payload)
        self.assertNotIn("views", payload)
        self.assertLess(len(payload.get("metric_cards") or ""), 20000)


class ExecutorDenyTests(unittest.TestCase):
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
            dsn=DSN or "postgresql://unused",
            call_llm=boom,
        )
        self.assertEqual(out["error_type"], "DENY")
        self.assertIsNone(out.get("loop"))

    def test_csat_is_unavailable(self) -> None:
        def llm(_m, _t, _n):
            return (
                '{"tool":"unavailable","reason":'
                '"Customer satisfaction surveys are not in Contact Center reports."}'
            )

        out = execute_sql_task(
            {
                "path": "certified_metric",
                "goal": "Show CSAT survey scores by agent",
                "time": "all time",
                "scope": "org",
                "slice": ["agent"],
            },
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            dsn="postgresql://unused",
            call_llm=llm,
        )
        self.assertEqual(out["status"], "unavailable")
        self.assertTrue(out.get("unavailable"))
        self.assertIn("UNAVAILABLE", out.get("facts") or "")
        self.assertEqual(out.get("rows"), [])


@unittest.skipUnless(DSN, "DATABASE_URL not set")
class ExecutorLlmTests(unittest.TestCase):
    def test_certified_goal_runs_kpi_without_domain_id(self) -> None:
        def llm(messages, _t, _n):
            self.assertEqual(len(messages), 2)
            self.assertIn("# Metric skill", messages[0]["content"])
            self.assertNotIn("# Views skill", messages[0]["content"])
            return '{"tool":"run_kpi","kpi":"total","dimensions":["channel"],"filters":{}}'

        out = execute_sql_task(
            {
                "path": "certified_metric",
                "goal": "how many conversations started this week by channel",
                "time": "last 7 days",
                "scope": "org",
                "slice": ["channel"],
            },
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            dsn=DSN,
            call_llm=llm,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))
        self.assertTrue(out.get("certified"))
        self.assertEqual(out.get("kpi_id"), "total")
        self.assertIn("certified: true", out.get("facts") or "")
        if out["rows"]:
            self.assertIn("channel", out["rows"][0])

    def test_slice_status_maps_on_run_kpi(self) -> None:
        def llm(_m, _t, _n):
            return '{"tool":"run_kpi","kpi":"total","dimensions":["status"],"filters":{}}'

        out = execute_sql_task(
            {
                "path": "certified_metric",
                "goal": "conversation volume by status",
                "time": "last 7 days",
                "scope": "org",
                "slice": ["status"],
            },
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            dsn=DSN,
            call_llm=llm,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))
        if out["rows"]:
            self.assertIn("conversation_status", out["rows"][0])

    def test_needs_free_sql_runs_views_once_uncertified(self) -> None:
        calls = []

        def llm(messages, _t, _n):
            calls.append(messages[0]["content"])
            if len(calls) == 1:
                self.assertIn("contact_center-kpi-meaning", messages[0]["content"])
                return '{"tool":"needs_free_sql","reason":"handled does not filter free-text subject."}'
            self.assertIn("contact_center-sql-views", messages[0]["content"])
            self.assertNotIn("contact_center-kpi-meaning", messages[0]["content"])
            return (
                '{"tool":"run_sql","sql":"SELECT subject, channel, status, queue_name '
                'FROM rpt.conversations WHERE subject ILIKE \'%billing%\' LIMIT 5"}'
            )

        out = execute_sql_task(
            {
                "path": "certified_metric",
                "goal": "handled conversations whose subject mentions billing",
                "time": "last 7 days",
                "scope": "org",
            },
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            dsn=DSN,
            call_llm=llm,
        )
        self.assertEqual(len(calls), 2)
        self.assertEqual(out["status"], "ok", out.get("error"))
        self.assertIs(out.get("certified"), False)
        self.assertIn("certified: false", out.get("facts") or "")
        self.assertIn("subject", out.get("needs_free_sql_reason") or "")

    def test_one_repair_then_replan(self) -> None:
        calls = []

        def llm(_messages, _t, _n):
            calls.append(1)
            if len(calls) == 1:
                return '{"tool":"run_sql","sql":"SELECT 1"}'
            return '{"tool":"run_kpi","kpi":"not_a_kpi","dimensions":[],"filters":{}}'

        out = execute_sql_task(
            {
                "path": "certified_metric",
                "goal": "how many conversations started",
                "time": "last 7 days",
                "scope": "org",
            },
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            dsn=DSN,
            call_llm=llm,
        )
        self.assertEqual(len(calls), 2)
        self.assertEqual(out["status"], "error")
        self.assertEqual(out["error_type"], "REPLAN")

    def test_clarify_does_not_run_sql(self) -> None:
        def llm(_m, _t, _n):
            return '{"tool":"clarify","question":"Do you mean started conversations or finished ones?"}'

        out = execute_sql_task(
            {
                "path": "certified_metric",
                "goal": "how many conversations",
                "time": "last 7 days",
                "scope": "org",
            },
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            dsn=DSN,
            call_llm=llm,
        )
        self.assertEqual(out["status"], "clarify")
        self.assertIn("started", (out.get("question") or "").lower())

    def test_strips_leaked_kpi_id(self) -> None:
        def llm(messages, _t, _n):
            user = json.loads(messages[1]["content"])
            self.assertNotIn("kpi", user.get("task") or {})
            self.assertNotIn("kpi_id", user.get("task") or {})
            return '{"tool":"run_kpi","kpi":"handled","dimensions":[],"filters":{}}'

        out = execute_sql_task(
            {
                "path": "certified_metric",
                "goal": "finished conversations this week",
                "time": "last 7 days",
                "scope": "org",
                "kpi": "total",
            },
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            dsn=DSN,
            call_llm=llm,
        )
        self.assertEqual(out["status"], "ok", out.get("error"))
        self.assertEqual(out.get("kpi_id"), "handled")


if __name__ == "__main__":
    unittest.main(verbosity=2)
