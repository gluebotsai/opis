"""Domain run_turn delegates sql/kg and still answers when SQL denies the role."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

PACK = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACK.parent))

from reports_analytics_agent_contact_center_v2.core.turn import run_turn

ORG = 1003
ADMIN_USER = 1016
AGENT_USER = 44


def _plan_then_brief(plan: dict, brief: str):
    def llm(messages, temperature, max_tokens):
        user = messages[-1]["content"]
        if '"mode": "plan"' in user or '"mode":"plan"' in user:
            return json.dumps(plan)
        return brief

    return llm


class DomainFlowTests(unittest.TestCase):
    def test_sql_task_is_delegated_and_briefed(self) -> None:
        calls: list[dict] = []

        def sql_runner(task, **kwargs):
            calls.append({"task": dict(task), "kwargs": kwargs})
            return {
                "status": "ok",
                "certified": True,
                "rows": [{"handled": 12}],
                "facts": "window: last 7 days\nkpi: handled\nrow 1: handled=12",
            }

        out = run_turn(
            question="How many were handled in the last 7 days?",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            dsn="postgres://unused",
            call_llm=_plan_then_brief(
                {
                    "kind": "plan",
                    "understanding": "They want handled volume",
                    "tasks": [
                        {
                            "id": "t1",
                            "executor": "sql",
                            "path": "certified_metric",
                            "goal": "Handled conversations last 7 days",
                            "time": "last 7 days",
                            "scope": "org",
                            "slice": [],
                            "answer_type": "number",
                        }
                    ],
                },
                (
                    "<p><strong>Handled</strong></p>"
                    "<p>Handled volume is <strong>12</strong>.</p>"
                    "<p>Want this by queue?</p>\ncard: kpi r1"
                ),
            ),
            sql_runner=sql_runner,
        )
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["kwargs"]["organization_id"], ORG)
        self.assertEqual(calls[0]["kwargs"]["user_id"], ADMIN_USER)
        self.assertEqual(calls[0]["kwargs"]["role"], "admin")
        self.assertEqual(calls[0]["task"]["executor"], "sql")
        self.assertIn("sql", out["trace"])
        self.assertNotIn("kg", out["trace"])
        self.assertIn("<p>", out["answer"])
        self.assertIn("12", out["answer"])

    def test_kg_task_is_delegated_and_briefed(self) -> None:
        seen: dict = {}

        def kg_runner(task, **kwargs):
            seen["task"] = dict(task)
            seen["kwargs"] = kwargs
            return {
                "status": "ok",
                "store": "kg",
                "rows": [{"end_actor": "customer", "n": 18}],
                "facts": (
                    "store: kg\nwindow: last 7 days\n"
                    "task_goal: Why abandoned rose. Follow end_actor.\n"
                    "row 1: kind=observed; end_actor=customer; n=18"
                ),
            }

        question = "abandonment is a mess what's going on"
        out = run_turn(
            question=question,
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            dsn="postgres://unused",
            call_llm=_plan_then_brief(
                {
                    "kind": "plan",
                    "understanding": "They want why abandoned rose",
                    "tasks": [
                        {
                            "id": "t1",
                            "executor": "kg",
                            "path": "why_links",
                            "goal": "Why abandoned rose last 7 days. Follow end_actor.",
                            "time": "last 7 days",
                            "scope": "org",
                            "slice": [],
                            "answer_type": "diagnosis",
                        }
                    ],
                },
                (
                    "<p><strong>Why abandoned rose</strong></p>"
                    "<p>Customer ended <strong>18</strong> sessions.</p>"
                    "<p>Want this by queue?</p>\ncard: none"
                ),
            ),
            kg_runner=kg_runner,
        )
        self.assertEqual(
            seen["task"]["goal"],
            "Why abandoned rose last 7 days. Follow end_actor.",
        )
        self.assertNotEqual(seen["task"]["goal"], question)
        self.assertEqual(seen["kwargs"]["role"], "admin")
        self.assertEqual(seen["kwargs"]["organization_id"], ORG)
        self.assertIn("kg", out["trace"])
        self.assertNotIn("sql", out["trace"])
        self.assertIn("<p>", out["answer"])
        self.assertIn("18", out["answer"])

    def test_sql_then_kg_forwards_sql_facts(self) -> None:
        order: list[str] = []
        seen: dict = {}

        def sql_runner(task, **kwargs):
            order.append("sql")
            return {
                "status": "ok",
                "certified": True,
                "rows": [{"abandoned": 42}],
                "facts": "window: last 7 days\nkpi: abandoned\nrow 1: abandoned=42",
            }

        def kg_runner(task, **kwargs):
            order.append("kg")
            seen["sql_facts"] = kwargs.get("sql_facts") or ""
            seen["role"] = kwargs.get("role")
            return {
                "status": "ok",
                "store": "kg",
                "rows": [{"end_actor": "customer", "n": 18}],
                "facts": "store: kg\nrow 1: kind=observed; end_actor=customer; n=18",
            }

        out = run_turn(
            question="why did abandoned rise",
            organization_id=ORG,
            user_id=ADMIN_USER,
            role="admin",
            dsn="postgres://unused",
            call_llm=_plan_then_brief(
                {
                    "kind": "plan",
                    "understanding": "Headline then why",
                    "tasks": [
                        {
                            "id": "t1",
                            "executor": "sql",
                            "path": "certified_metric",
                            "goal": "Abandoned last 7 days",
                            "time": "last 7 days",
                            "scope": "org",
                        },
                        {
                            "id": "t2",
                            "executor": "kg",
                            "path": "why_links",
                            "goal": "Why abandoned rose. Do not recount.",
                            "time": "last 7 days",
                            "scope": "org",
                        },
                    ],
                },
                (
                    "<p><strong>Abandoned rose</strong></p>"
                    "<p>Abandoned is <strong>42</strong>.</p>"
                    "<p>Want the queue split?</p>\ncard: kpi r1"
                ),
            ),
            sql_runner=sql_runner,
            kg_runner=kg_runner,
        )
        self.assertEqual(order, ["sql", "kg"])
        self.assertIn("abandoned=42", seen["sql_facts"])
        self.assertEqual(seen["role"], "admin")
        self.assertIn("sql", out["trace"])
        self.assertIn("kg", out["trace"])
        self.assertIn("42", out["answer"])

    def test_agent_org_sql_deny_still_returns_html(self) -> None:
        def plan_then_brief(messages, temperature, max_tokens):
            user = messages[-1]["content"]
            if '"mode": "plan"' in user or '"mode":"plan"' in user:
                return json.dumps(
                    {
                        "kind": "plan",
                        "understanding": "They asked for org volume",
                        "tasks": [
                            {
                                "id": "t1",
                                "executor": "sql",
                                "path": "certified_metric",
                                "goal": "How many conversations started last 7 days",
                                "time": "last 7 days",
                                "scope": "org",
                                "slice": [],
                                "answer_type": "number",
                            }
                        ],
                    }
                )
            if '"mode": "brief"' in user or '"mode":"brief"' in user:
                return (
                    "<p><strong>This scope is not allowed</strong></p>"
                    "<p>Your role cannot see organization-wide figures.</p>"
                    "<p>Ask about your own conversations?</p>\ncard: none"
                )
            raise AssertionError("SQL executor LLM must not run on deny")

        out = run_turn(
            question="How many conversations started last 7 days for the company?",
            organization_id=ORG,
            user_id=AGENT_USER,
            role="agent",
            dsn="postgres://unused",
            call_llm=plan_then_brief,
        )
        sql = (out["trace"].get("sql") or [{}])[0]
        self.assertEqual(sql.get("error_type"), "DENY")
        self.assertIn("<p>", out["answer"])
        self.assertTrue(out["answer"].strip())
        self.assertNotIn("kg", out["trace"])
        self.assertIn("scope_denied", (out.get("facts") or "").lower())


if __name__ == "__main__":
    unittest.main()
