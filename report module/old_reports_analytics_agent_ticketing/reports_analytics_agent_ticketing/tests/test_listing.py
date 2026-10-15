"""Listing, name ILIKE, CSAT compare, and factual present. Production execute_frame."""

from __future__ import annotations

import os
import unittest

from reports_analytics_agent_ticketing.core.compiler import compile_catalog
from reports_analytics_agent_ticketing.core.present import looks_like_tool_call, present_job
from reports_analytics_agent_ticketing.core.query_frame import Identity, frame_from_dict
from reports_analytics_agent_ticketing.core.run_analytics import compile_frame, execute_frame

IDENTITY = Identity(organization_id=1012, user_id=1, role="admin")


class FilterCompileTests(unittest.TestCase):
    def test_resolution_hours_compare_on_count(self) -> None:
        sql, _ = compile_frame(
            frame_from_dict(
                {
                    "shape": "kpi",
                    "measure": "ticket_count",
                    "path": "certified",
                    "scope": {"level": "org"},
                    "filters": [{"field": "resolution_hours", "mention": "20", "reading": "<"}],
                }
            ),
            IDENTITY,
        )
        self.assertIn("EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0 < 20", sql)
        self.assertIn("resolved_at IS NOT NULL", sql)

    def test_agent_roster_is_agents_table(self) -> None:
        sql, _ = compile_frame(
            frame_from_dict(
                {
                    "shape": "list",
                    "measure": "agents",
                    "path": "catalog",
                    "scope": {"level": "org"},
                }
            ),
            IDENTITY,
        )
        self.assertIn("FROM ticketing.agents", sql)
        self.assertIn("a.organization_id", sql)

    def test_name_filter_is_ilike_not_id(self) -> None:
        sql, _ = compile_frame(
            frame_from_dict(
                {
                    "shape": "kpi",
                    "measure": "ticket_count",
                    "path": "certified",
                    "scope": {"level": "org"},
                    "filters": [{"field": "agent", "mention": "Fazil"}],
                }
            ),
            IDENTITY,
        )
        self.assertIn("assignee_name ILIKE '%Fazil%'", sql)
        self.assertNotIn("assignee_id IN", sql)

    def test_csat_gt_kept_on_list(self) -> None:
        sql, _ = compile_catalog(
            frame_from_dict(
                {
                    "shape": "list",
                    "measure": "ticket_count",
                    "path": "catalog",
                    "scope": {"level": "org"},
                    "filters": [{"field": "csat_score", "mention": "4", "reading": ">"}],
                    "select": ["customer_name", "csat_score"],
                    "limit": 200,
                }
            ),
            IDENTITY,
        )
        self.assertIn("t.csat_score > 4", sql)
        self.assertIn("t.customer_name", sql)

    def test_person_list_is_distinct(self) -> None:
        sql, _ = compile_catalog(
            frame_from_dict(
                {
                    "shape": "list",
                    "path": "catalog",
                    "measure": "ticket_count",
                    "scope": {"level": "org"},
                    "select": ["customer_name"],
                }
            ),
            IDENTITY,
        )
        self.assertIn("SELECT DISTINCT t.customer_name", sql)
        self.assertIn("LIMIT 200", sql)

    def test_ranking_defaults_to_top_10(self) -> None:
        sql, _ = compile_catalog(
            frame_from_dict(
                {
                    "shape": "ranking",
                    "path": "catalog",
                    "measure": "ticket_count",
                    "scope": {"level": "org"},
                    "group_by": ["agent"],
                }
            ),
            IDENTITY,
        )
        self.assertIn("ORDER BY COUNT(*) DESC", sql)
        self.assertIn("LIMIT 10", sql)

    def test_top_n_limit_is_honored(self) -> None:
        sql, _ = compile_catalog(
            frame_from_dict(
                {
                    "shape": "ranking",
                    "path": "catalog",
                    "measure": "ticket_count",
                    "scope": {"level": "org"},
                    "group_by": ["agent"],
                    "limit": 5,
                }
            ),
            IDENTITY,
        )
        self.assertIn("LIMIT 5", sql)
        self.assertNotIn("LIMIT 10", sql)

    def test_kg_choose_answer_uses_prose_not_tool_call(self) -> None:
        from reports_analytics_agent_ticketing.core.present import choose_answer
        from reports_analytics_agent_ticketing.core.query_frame import QueryFrame, ScopeSpec, TimeSpec

        frame = QueryFrame(
            shape="breakdown",
            measure="why_breakdown",
            path="certified",
            scope=ScopeSpec(level="org"),
            time=TimeSpec(),
            group_by=["status"],
        )
        job = {
            "store": "kg",
            "executor": "kg",
            "rows": [{"status": "Overdue", "ticket_count": 814}],
        }
        prose = (
            "Narrative: Overdue is the largest status on this graph why. "
            "Analysis: Overdue is 814 tickets on this result. "
            "Prescription: inspect Overdue tickets in that status next; the graph did not return a cause hop."
        )
        self.assertIn("Prescription", choose_answer(prose, job, frame))
        facts = choose_answer("call:ticketing:execute_graph({})", job, frame)
        self.assertIn("Graph facts", facts)
        self.assertNotIn("call:ticketing", facts)

    def test_present_rejects_tool_call_text(self) -> None:
        self.assertTrue(
            looks_like_tool_call(
                'call:ticketing:execute_frame({ "shape": "list" })'
            )
        )
        frame = frame_from_dict(
            {
                "shape": "list",
                "measure": "ticket_count",
                "path": "catalog",
                "scope": {"level": "org"},
            }
        )
        text = present_job(
            {"store": "sql", "rows": [{"customer_name": "Acme", "csat_score": 5}]},
            frame,
        )
        self.assertIn("Acme", text)
        self.assertNotIn("execute_frame", text)


@unittest.skipUnless(os.getenv("DATABASE_URL"), "DATABASE_URL not set")
class LiveListingTests(unittest.TestCase):
    def test_fazil_and_csat_and_customers(self) -> None:
        dsn = os.environ["DATABASE_URL"]
        fazil = execute_frame(
            {
                "shape": "kpi",
                "measure": "ticket_count",
                "path": "certified",
                "scope": {"level": "org"},
                "filters": [{"field": "agent", "mention": "Fazil"}],
            },
            IDENTITY,
            dsn=dsn,
            run=True,
        )
        self.assertEqual(fazil.get("status"), "ok", fazil.get("error"))
        n = fazil["rows"][0]["ticket_count"]
        self.assertGreater(n, 1)

        csat = execute_frame(
            {
                "shape": "list",
                "measure": "ticket_count",
                "path": "catalog",
                "scope": {"level": "org"},
                "filters": [{"field": "csat_score", "mention": "4", "reading": ">"}],
                "select": ["customer_name", "csat_score"],
                "limit": 200,
            },
            IDENTITY,
            dsn=dsn,
            run=True,
        )
        self.assertEqual(csat.get("status"), "ok", csat.get("error"))
        self.assertGreater(len(csat["rows"]), 1)
        self.assertTrue(all(int(r["csat_score"]) > 4 for r in csat["rows"]))

        people = execute_frame(
            {
                "shape": "ranking",
                "measure": "ticket_count",
                "path": "catalog",
                "scope": {"level": "org"},
                "group_by": ["customer"],
            },
            IDENTITY,
            dsn=dsn,
            run=True,
        )
        self.assertEqual(people.get("status"), "ok", people.get("error"))
        self.assertGreater(len(people["rows"]), 1)

        total = execute_frame(
            {
                "shape": "kpi",
                "measure": "ticket_count",
                "path": "certified",
                "scope": {"level": "org"},
            },
            IDENTITY,
            dsn=dsn,
            run=True,
        )
        from reports_analytics_agent_ticketing.core import db as pg

        warehouse = pg.fetchall(
            dsn,
            "SELECT COUNT(*)::bigint AS n FROM ticketing.tickets WHERE organization_id = 1012",
            (),
        )[0]["n"]
        self.assertEqual(total["rows"][0]["ticket_count"], warehouse)


if __name__ == "__main__":
    unittest.main()
