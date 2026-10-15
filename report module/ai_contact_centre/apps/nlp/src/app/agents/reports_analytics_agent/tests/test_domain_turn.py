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


KG_ROOT = Path(__file__).resolve().parents[1] / "CCAAS_kg_context_agent"
_GONE = (
    "app.py",
    "CHANGES.md",
    "kg_agent_v2_architecture.md",
    "src/emitter.py",
    "scripts/generate_ontology.py",
    "scripts/test_two_queries.py",
)


class DomainTurnTests(unittest.TestCase):
    def test_kg_leftovers_removed(self) -> None:
        for rel in _GONE:
            self.assertFalse((KG_ROOT / rel).exists(), rel)

    def test_compose_requirement_uses_domain_goal(self) -> None:
        sys.path.insert(0, str(KG_ROOT))
        from src.task_payload import compose_requirement

        text = compose_requirement(
            {
                "query": "abandonment is a mess",
                "understanding": "They want why abandoned rose",
                "goal": "Why abandoned rose. Follow end_actor.",
                "time": "last 7 days",
                "sql_facts": "abandoned=42",
            }
        )
        self.assertIn("Why abandoned rose", text)
        self.assertNotIn("abandonment is a mess", text)
        self.assertIn("sql_facts_present", text)

    def test_domain_packet_is_not_user_html(self) -> None:
        sys.path.insert(0, str(KG_ROOT))
        from src.task_payload import format_domain_packet

        packet = format_domain_packet(
            {"goal": "Why abandoned rose"},
            [{"end_actor": "customer", "n": 18}],
            {
                "aligned_to_task": "yes",
                "checked": "knowledge_graph rows",
                "not_checked": "readiness",
                "hypothesis": "none",
                "conflict_with_sql": "none",
            },
            "last 7 days",
        )
        self.assertIn("store: kg", packet)
        self.assertIn("kind=observed", packet)
        self.assertNotIn("<p>", packet)
        self.assertNotIn("Executive Summary", packet)
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

    def test_plan_allows_kg_executor(self) -> None:
        plan = {
            "kind": "plan",
            "understanding": "Why abandoned rose",
            "tasks": [
                {
                    "id": "t1",
                    "executor": "sql",
                    "path": "certified_metric",
                    "goal": "Abandoned last 7 days",
                    "time": "last 7 days",
                },
                {
                    "id": "t2",
                    "executor": "kg",
                    "path": "why_links",
                    "goal": "Why abandoned rose. Follow end_actor and missed reason. Do not recount.",
                    "time": "last 7 days",
                    "cypher": "MATCH (c) RETURN c",
                },
            ],
        }
        self.assertIsNone(validate_plan(plan))
        self.assertEqual(plan["tasks"][1]["executor"], "kg")
        self.assertNotIn("cypher", plan["tasks"][1])

    def test_kg_task_receives_domain_goal_not_user_chat(self) -> None:
        seen: dict = {}

        def llm(messages, temperature, max_tokens):
            user = messages[-1]["content"]
            if '"mode": "plan"' in user or '"mode":"plan"' in user:
                return json.dumps(
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
                    }
                )
            return (
                "<p><strong>Why abandoned rose</strong></p>"
                "<p>Customer ended <strong>18</strong> sessions.</p>"
                "<p>Want this by queue?</p>\ncard: none"
            )

        def kg_runner(task, **kwargs):
            seen["task"] = dict(task)
            seen["kwargs"] = kwargs
            return {
                "status": "ok",
                "store": "kg",
                "rows": [{"end_actor": "customer", "n": 18}],
                "reasoning": {
                    "aligned_to_task": "yes",
                    "observed": [{"end_actor": "customer", "n": 18}],
                    "hypothesis": "none",
                },
                "facts": (
                    "store: kg\nwindow: last 7 days\n"
                    "task_goal: Why abandoned rose last 7 days. Follow end_actor.\n"
                    "row 1: kind=observed; end_actor=customer; n=18\n"
                    "reasoning:\n- aligned_to_task: yes\n- observed: customer ended 18\n"
                    "- derived: none\n- hypothesis: none\n- conflict_with_sql: none"
                ),
                "time_echo": "last 7 days",
            }

        out = run_turn(
            question="abandonment is a mess what's going on",
            organization_id=1003,
            user_id=1016,
            role="admin",
            dsn="postgres://unused",
            call_llm=llm,
            kg_runner=kg_runner,
        )
        self.assertEqual(seen["task"]["goal"], "Why abandoned rose last 7 days. Follow end_actor.")
        self.assertNotEqual(seen["task"]["goal"], "abandonment is a mess what's going on")
        self.assertEqual(seen["kwargs"]["understanding"], "They want why abandoned rose")
        self.assertIn("kg", out["trace"])
        self.assertIn("18", out["answer"])
        self.assertNotIn("<p><strong>Executive Summary", out["trace"]["kg"][0].get("facts") or "")

    def test_sql_then_kg_passes_sql_facts(self) -> None:
        seen: dict = {}

        def llm(messages, temperature, max_tokens):
            user = messages[-1]["content"]
            if '"mode": "plan"' in user or '"mode":"plan"' in user:
                return json.dumps(
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
                            },
                            {
                                "id": "t2",
                                "executor": "kg",
                                "path": "why_links",
                                "goal": "Why abandoned rose. Do not recount.",
                                "time": "last 7 days",
                            },
                        ],
                    }
                )
            return (
                "<p><strong>Abandoned rose</strong></p>"
                "<p>Abandoned is <strong>42</strong>.</p>"
                "<p>Want the queue split?</p>\ncard: kpi r1"
            )

        def sql_runner(task, **kwargs):
            return {
                "status": "ok",
                "certified": True,
                "rows": [{"abandoned": 42}],
                "facts": "window: last 7 days\nkpi: abandoned\nrow 1: abandoned=42",
            }

        def kg_runner(task, **kwargs):
            seen["sql_facts"] = kwargs.get("sql_facts") or ""
            return {
                "status": "ok",
                "store": "kg",
                "rows": [{"end_actor": "customer", "n": 18}],
                "facts": "store: kg\nrow 1: kind=observed; end_actor=customer; n=18",
            }

        run_turn(
            question="why did abandoned rise",
            organization_id=1003,
            user_id=1016,
            role="admin",
            dsn="postgres://unused",
            call_llm=llm,
            sql_runner=sql_runner,
            kg_runner=kg_runner,
        )
        self.assertIn("abandoned=42", seen["sql_facts"])

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
