"""Domain turn without a live model or database."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from reports_analytics_agent_contact_center_v2.core.turn import (
    public_facts,
    run_turn,
    split_brief,
    validate_plan,
)


def _plan_sql() -> str:
    return json.dumps(
        {
            "kind": "plan",
            "tasks": [
                {
                    "id": "t1",
                    "executor": "sql",
                    "path": "certified_metric",
                    "kpi": "handled",
                    "goal": "Handled conversations last 7 days",
                    "time": "last 7 days",
                    "scope": "org",
                    "slice": [],
                    "answer_type": "number",
                }
            ],
        }
    )


class DomainTurnTests(unittest.TestCase):
    def test_plan_drops_metric_id(self) -> None:
        plan = json.loads(_plan_sql())
        self.assertIsNone(validate_plan(plan))
        self.assertNotIn("kpi", plan["tasks"][0])

    def test_public_facts_hide_catalog_miss(self) -> None:
        text = public_facts("EXECUTION_ERROR\nmessage: kpi_not_found: handled is not in the certified KPI index.")
        self.assertNotIn("kpi_not_found", text.lower())
        self.assertNotIn("catalog", text.lower())

    def test_split_brief_keeps_card_off_html(self) -> None:
        html, card = split_brief(
            "<p><strong>Handled</strong></p>\n<p>Handled volume is <strong>12</strong>.</p>\n<p>Want this by queue?</p>\ncard: kpi r1"
        )
        self.assertEqual(card, "card: kpi r1")
        self.assertNotIn("card:", html)

    def test_chat_is_html(self) -> None:
        def llm(messages, temperature, max_tokens):
            return json.dumps({"kind": "chat", "reply": "<p>Ask about handled conversations.</p>"})

        out = run_turn(
            question="hi",
            organization_id=1012,
            user_id=1,
            role="admin",
            dsn="postgres://unused",
            call_llm=llm,
        )
        self.assertIn("<p>", out["answer"])
        self.assertNotIn("tasks", out["trace"]["plan"])

    def test_all_time_is_allowed(self) -> None:
        plan = {
            "kind": "plan",
            "tasks": [
                {
                    "executor": "sql",
                    "path": "certified_metric",
                    "goal": "Count every conversation that started",
                    "time": "all time",
                }
            ],
        }
        self.assertIsNone(validate_plan(plan))

    def test_missing_measure_does_not_invent_free_sql(self) -> None:
        calls = {"sql": 0}

        def llm(messages, temperature, max_tokens):
            user = messages[-1]["content"]
            if "mode\": \"plan" in user or '"mode": "plan"' in user:
                return json.dumps(
                    {
                        "kind": "plan",
                        "tasks": [
                            {
                                "id": "t1",
                                "executor": "sql",
                                "path": "certified_metric",
                                "goal": "Show CSAT survey scores by agent",
                                "time": "all time",
                                "scope": "org",
                                "slice": ["agent"],
                                "answer_type": "number",
                            }
                        ],
                    }
                )
            return (
                "<p><strong>That measure is not available</strong></p>"
                "<p>Customer satisfaction surveys are not in Contact Center reports.</p>"
                "<p>Would you like conversation volume instead?</p>\ncard: none"
            )

        def sql_runner(task, **kwargs):
            calls["sql"] += 1
            return {
                "status": "unavailable",
                "unavailable": True,
                "reason": "Customer satisfaction surveys are not in Contact Center reports.",
                "certified": False,
                "rows": [],
                "facts": "UNAVAILABLE\nreason: Customer satisfaction surveys are not in Contact Center reports.",
            }

        out = run_turn(
            question="what is the csat for the agents",
            organization_id=1012,
            user_id=1,
            role="admin",
            dsn="postgres://unused",
            call_llm=llm,
            sql_runner=sql_runner,
        )
        self.assertEqual(calls["sql"], 1)
        self.assertTrue(out["trace"].get("unavailable"))
        self.assertFalse(out["trace"].get("free_sql_fallback"))
        self.assertIn("not available", out["answer"].lower())
        self.assertNotIn("52.05", out["answer"])
        self.assertNotIn("kg", out["trace"])

    def test_kpi_not_found_does_not_invent_a_score(self) -> None:
        calls = {"sql": 0}

        def llm(messages, temperature, max_tokens):
            user = messages[-1]["content"]
            if "mode\": \"plan" in user or '"mode": "plan"' in user:
                return _plan_sql()
            return (
                "<p><strong>That measure is not available</strong></p>"
                "<p>That measure is not in Contact Center reports.</p>"
                "<p>Would you like conversation volume instead?</p>\ncard: none"
            )

        def sql_runner(task, **kwargs):
            calls["sql"] += 1
            return {
                "status": "error",
                "error_type": "REPLAN",
                "error": "kpi_not_found: missing",
                "rows": [],
                "facts": "message: kpi_not_found: missing",
            }

        out = run_turn(
            question="How many were handled in the last 7 days?",
            organization_id=1012,
            user_id=1,
            role="admin",
            dsn="postgres://unused",
            call_llm=llm,
            sql_runner=sql_runner,
        )
        self.assertEqual(calls["sql"], 1)
        self.assertTrue(out["trace"].get("unavailable"))
        self.assertFalse(out["trace"].get("free_sql_fallback"))
        self.assertIn("not available", out["answer"].lower())
        self.assertNotIn("kpi_not_found", out["answer"].lower())

    def test_unknown_filter_still_may_use_free_sql(self) -> None:
        calls = {"sql": 0}

        def llm(messages, temperature, max_tokens):
            user = messages[-1]["content"]
            if "mode\": \"plan" in user or '"mode": "plan"' in user:
                return _plan_sql()
            return (
                "<p><strong>Conversations that finished</strong></p>"
                "<p>Finished conversations are <strong>4</strong>.</p>"
                "<p>Want this by channel?</p>\ncard: kpi r1"
            )

        def sql_runner(task, **kwargs):
            calls["sql"] += 1
            if task.get("path") == "certified_metric":
                return {
                    "status": "error",
                    "error_type": "REPAIR",
                    "error": "unknown filter: subject is not a declared slot",
                    "rows": [],
                }
            return {
                "status": "ok",
                "certified": False,
                "rows": [{"handled": 4}],
                "facts": "certified: false\nrow 1: handled=4",
                "kpi_id": None,
            }

        out = run_turn(
            question="handled with subject billing",
            organization_id=1012,
            user_id=1,
            role="admin",
            dsn="postgres://unused",
            call_llm=llm,
            sql_runner=sql_runner,
        )
        self.assertEqual(calls["sql"], 2)
        self.assertTrue(out["trace"].get("free_sql_fallback"))


if __name__ == "__main__":
    unittest.main()
