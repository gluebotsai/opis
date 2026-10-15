"""Pack compile contracts. No Streamlit. Live DB is optional."""

from __future__ import annotations

import os
import unittest

from reports_analytics_agent_ticketing.core.cypher_compiler import compile_graph_frame
from reports_analytics_agent_ticketing.core.prepare import lift_time_filters, month_year_bounds
from reports_analytics_agent_ticketing.core.query_frame import Identity, QueryFrame, ScopeSpec, TimeSpec, frame_from_dict
from reports_analytics_agent_ticketing.core.resolve import decide_rows
from reports_analytics_agent_ticketing.core.run_analytics import compile_frame, execute_frame
from reports_analytics_agent_ticketing.core.run_graph import execute_graph

IDENTITY = Identity(organization_id=1012, user_id=1, role="admin", my_queue_ids=[])


class PrepareTests(unittest.TestCase):
    def test_august_2026_bounds(self) -> None:
        start, end = month_year_bounds("August 2026")
        self.assertEqual(start, "2026-08-01T00:00:00+00:00")
        self.assertEqual(end, "2026-09-01T00:00:00+00:00")

    def test_date_status_filter_lifted(self) -> None:
        frame = frame_from_dict(
            {
                "shape": "kpi",
                "measure": "ticket_count",
                "path": "certified",
                "scope": {"level": "org"},
                "filters": [{"field": "status", "mention": "August 2026"}],
                "time": {},
            }
        )
        out = lift_time_filters(frame)
        self.assertEqual(out.filters, [])
        self.assertEqual(out.time.start, "2026-08-01T00:00:00+00:00")
        self.assertEqual(out.time.end, "2026-09-01T00:00:00+00:00")


class NameTests(unittest.TestCase):
    def test_like_tokens_skip_single_letters(self) -> None:
        from reports_analytics_agent_ticketing.core.resolve import like_tokens

        self.assertEqual(like_tokens("a"), [])
        self.assertEqual(like_tokens("Lokesh B"), ["Lokesh"])

    def test_same_label_multi_id(self) -> None:
        rows = [{"id": 1, "label": "Fazil"}, {"id": 2, "label": "Fazil"}]
        result = decide_rows("Fazil", [], rows)
        self.assertEqual(result.ids, [1, 2])


class SqlCompileTests(unittest.TestCase):
    def test_month_uses_date_trunc(self) -> None:
        frame = QueryFrame(
            shape="breakdown",
            measure="ticket_count",
            path="certified",
            scope=ScopeSpec(level="org"),
            time=TimeSpec(date_column="created_at"),
            group_by=["month"],
        )
        sql, _echo = compile_frame(frame, IDENTITY)
        self.assertIn("date_trunc('month'", sql)
        self.assertIn("GROUP BY", sql)

    def test_cypher_has_no_group_by(self) -> None:
        frame = QueryFrame(
            shape="breakdown",
            measure="why_breakdown",
            path="certified",
            scope=ScopeSpec(level="org"),
            group_by=["queue"],
        )
        cypher, _params, _echo = compile_graph_frame(frame, IDENTITY)
        self.assertNotIn("GROUP BY", cypher.upper())
        self.assertIn("count(t)", cypher)

    def test_kg_month_is_user_error(self) -> None:
        job = execute_graph(
            {
                "shape": "breakdown",
                "measure": "why_breakdown",
                "path": "certified",
                "scope": {"level": "org"},
                "group_by": ["month"],
            },
            IDENTITY,
        )
        self.assertEqual(job["status"], "error")
        self.assertIn("SQL", job["error"])
        self.assertNotIn("Traceback", job["error"])


@unittest.skipUnless(os.getenv("DATABASE_URL"), "DATABASE_URL not set")
class LiveSqlTests(unittest.TestCase):
    def test_month_runs(self) -> None:
        dsn = os.environ["DATABASE_URL"]
        job = execute_frame(
            {
                "shape": "breakdown",
                "measure": "ticket_count",
                "path": "certified",
                "scope": {"level": "org"},
                "group_by": ["month"],
                "time": {"date_column": "created_at"},
            },
            IDENTITY,
            dsn=dsn,
            run=True,
        )
        self.assertEqual(job.get("status"), "ok", job.get("error"))
        self.assertTrue(job.get("rows"))
        self.assertNotIn("Traceback", str(job.get("error") or ""))


@unittest.skipUnless(os.getenv("NEO4J_URI") and os.getenv("NEO4J_PASSWORD"), "Neo4j not set")
class LiveKgTests(unittest.TestCase):
    def test_why_queue_runs(self) -> None:
        from reports_analytics_agent_ticketing.core.kg_client import apply_runtime

        apply_runtime(os.environ["NEO4J_URI"], os.getenv("NEO4J_USER"), os.environ["NEO4J_PASSWORD"])
        job = execute_graph(
            {
                "shape": "breakdown",
                "measure": "why_breakdown",
                "path": "certified",
                "scope": {"level": "org"},
                "group_by": ["queue"],
                "limit": 10,
            },
            IDENTITY,
            execute=True,
        )
        self.assertNotIn("GROUP BY", (job.get("cypher") or "").upper())
        self.assertEqual(job.get("status"), "ok", job.get("error"))
        self.assertNotIn("Traceback", str(job.get("error") or ""))


if __name__ == "__main__":
    unittest.main()
