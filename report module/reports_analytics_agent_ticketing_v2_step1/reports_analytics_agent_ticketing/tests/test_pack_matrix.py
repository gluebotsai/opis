"""Exercise production execute_frame / execute_graph across the catalog, not one failing case."""

from __future__ import annotations

import os
import traceback
import unittest

from reports_analytics_agent_ticketing.core.cypher_compiler import compile_graph_frame
from reports_analytics_agent_ticketing.core.loader import merge_effective
from reports_analytics_agent_ticketing.core.query_frame import Identity, frame_from_dict
from reports_analytics_agent_ticketing.core.run_analytics import compile_frame, execute_frame
from reports_analytics_agent_ticketing.core.run_graph import execute_graph

IDENTITY = Identity(organization_id=1012, user_id=1, role="admin", my_queue_ids=[])
ORG = {"level": "org", "target_mention": None}


def _fail(job: dict, label: str) -> str:
    err = job.get("error") or ""
    if job.get("status") == "error" or err:
        return f"{label}: {err}"
    if "Traceback" in str(job):
        return f"{label}: traceback leaked"
    return ""


class CatalogCompileMatrix(unittest.TestCase):
    """Every allowed dimension on ticket_count SQL, catalog ranking, and KG why."""

    def test_sql_ticket_count_every_dimension_compiles(self) -> None:
        catalog = merge_effective(IDENTITY.organization_id)
        dims = list(catalog["kpis"]["ticket_count"].get("allowed_dimensions") or [])
        self.assertTrue(dims)
        failures: list[str] = []
        for dim in dims:
            frame = {
                "shape": "breakdown",
                "measure": "ticket_count",
                "path": "certified",
                "scope": ORG,
                "group_by": [dim],
                "time": {"date_column": "created_at"},
                "limit": 20,
            }
            try:
                sql, _echo = compile_frame(frame_from_dict(frame), IDENTITY)
            except Exception as exc:
                failures.append(f"certified {dim}: {exc}\n{traceback.format_exc()}")
                continue
            if "Traceback" in sql:
                failures.append(f"certified {dim}: traceback in sql")
            cat_frame = {**frame, "path": "catalog", "shape": "ranking"}
            try:
                compile_frame(frame_from_dict(cat_frame), IDENTITY)
            except Exception as exc:
                failures.append(f"catalog ranking {dim}: {exc}\n{traceback.format_exc()}")
        self.assertFalse(failures, "\n".join(failures))

    def test_sql_other_kpis_allowed_dimensions_compile(self) -> None:
        catalog = merge_effective(IDENTITY.organization_id)
        failures: list[str] = []
        for kpi_id, card in catalog["kpis"].items():
            for dim in card.get("allowed_dimensions") or []:
                frame = {
                    "shape": "kpi",
                    "measure": kpi_id,
                    "path": "certified",
                    "scope": ORG,
                    "group_by": [dim],
                    "time": {"date_column": card.get("default_time_column") or "created_at"},
                    "limit": 10,
                }
                try:
                    compile_frame(frame_from_dict(frame), IDENTITY)
                except Exception as exc:
                    failures.append(f"{kpi_id}/{dim}: {exc}")
        self.assertFalse(failures, "\n".join(failures))

    def test_kg_why_every_allowed_dimension_compiles_without_group_by(self) -> None:
        catalog = merge_effective(IDENTITY.organization_id)
        dims = list(catalog["kg_measures"]["why_breakdown"].get("allowed_dimensions") or [])
        failures: list[str] = []
        for dim in dims:
            frame = {
                "shape": "breakdown",
                "measure": "why_breakdown",
                "path": "certified",
                "scope": ORG,
                "group_by": [dim],
                "limit": 10,
            }
            try:
                cypher, _params, _echo = compile_graph_frame(frame_from_dict(frame), IDENTITY)
            except Exception as exc:
                failures.append(f"why {dim}: {exc}\n{traceback.format_exc()}")
                continue
            if "GROUP BY" in cypher.upper():
                failures.append(f"why {dim}: GROUP BY still present")
        self.assertFalse(failures, "\n".join(failures))

    def test_kg_every_measure_compiles(self) -> None:
        catalog = merge_effective(IDENTITY.organization_id)
        failures: list[str] = []
        for measure_id, card in catalog["kg_measures"].items():
            dims = list(card.get("allowed_dimensions") or [])
            if card.get("requires_group_by") or dims:
                group = [dims[0]] if dims else ["queue"]
            else:
                group = []
            frame = {
                "shape": "breakdown" if group else "find",
                "measure": measure_id,
                "path": "certified",
                "scope": {"level": "org" if "org" in (card.get("allowed_scope_levels") or ["org"]) else (card.get("allowed_scope_levels") or ["org"])[0]},
                "group_by": group,
                "limit": 5,
            }
            try:
                compile_graph_frame(frame_from_dict(frame), IDENTITY)
            except Exception as exc:
                failures.append(f"{measure_id}: {exc}")
        self.assertFalse(failures, "\n".join(failures))


@unittest.skipUnless(os.getenv("DATABASE_URL"), "DATABASE_URL not set")
class LiveSqlMatrix(unittest.TestCase):
    def test_ticket_count_every_dimension_executes(self) -> None:
        dsn = os.environ["DATABASE_URL"]
        catalog = merge_effective(IDENTITY.organization_id)
        dims = list(catalog["kpis"]["ticket_count"].get("allowed_dimensions") or [])
        failures: list[str] = []
        for dim in dims:
            job = execute_frame(
                {
                    "shape": "breakdown",
                    "measure": "ticket_count",
                    "path": "certified",
                    "scope": ORG,
                    "group_by": [dim],
                    "time": {"date_column": "created_at"},
                    "limit": 20,
                },
                IDENTITY,
                dsn=dsn,
                run=True,
            )
            msg = _fail(job, f"sql dim {dim}")
            if msg:
                failures.append(msg)
                continue
            if not job.get("rows"):
                failures.append(f"sql dim {dim}: empty rows")
        self.assertFalse(failures, "\n".join(failures))

    def test_status_readings_and_name_lookups(self) -> None:
        dsn = os.environ["DATABASE_URL"]
        from reports_analytics_agent_ticketing.core import db as pg

        failures: list[str] = []
        readings = [
            ("Pending", "literal"),
            ("generic pending", "generic_pending"),
            ("Open", "open"),
            ("Overdue", "overdue"),
            ("Resolved", "resolved"),
            ("Reopened", "reopened"),
        ]
        for mention, reading in readings:
            job = execute_frame(
                {
                    "shape": "kpi",
                    "measure": "ticket_count",
                    "path": "certified",
                    "scope": ORG,
                    "filters": [{"field": "status", "mention": mention, "reading": reading}],
                },
                IDENTITY,
                dsn=dsn,
                run=True,
            )
            msg = _fail(job, f"reading {reading}")
            if msg:
                failures.append(msg)
        samples = {
            "agent": ("assignee_name", "assignee_id"),
            "queue": ("queue_name", "queue_id"),
            "customer": ("customer_name", "customer_id"),
            "resolver": ("resolver_name", "resolver_id"),
            "created_by": ("created_by_name", "created_by_id"),
        }
        for field, (column, id_col) in samples.items():
            rows = pg.fetchall(
                dsn,
                (
                    f"SELECT {column} AS label FROM ticketing.tickets "
                    f"WHERE organization_id = %s AND {column} IS NOT NULL AND {id_col} IS NOT NULL "
                    f"GROUP BY 1 HAVING COUNT(*) > 0 AND length({column}) >= 4 "
                    f"ORDER BY length({column}) DESC LIMIT 1"
                ),
                (1012,),
            )
            if not rows:
                continue
            mention = rows[0]["label"]
            try:
                job = execute_frame(
                    {
                        "shape": "kpi",
                        "measure": "ticket_count",
                        "path": "certified",
                        "scope": ORG,
                        "filters": [{"field": field, "mention": mention}],
                    },
                    IDENTITY,
                    dsn=dsn,
                    run=True,
                )
            except Exception as exc:
                failures.append(f"name {field} '{mention}': {exc}")
                continue
            msg = _fail(job, f"name {field}")
            if msg:
                failures.append(msg)
        list_job = execute_frame(
            {
                "shape": "list",
                "measure": "ticket_count",
                "path": "catalog",
                "scope": ORG,
                "limit": 5,
            },
            IDENTITY,
            dsn=dsn,
            run=True,
        )
        msg = _fail(list_job, "list")
        if msg:
            failures.append(msg)
        self.assertFalse(failures, "\n".join(failures))


@unittest.skipUnless(os.getenv("NEO4J_URI") and os.getenv("NEO4J_PASSWORD"), "Neo4j not set")
class LiveKgMatrix(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        from reports_analytics_agent_ticketing.core.kg_client import apply_runtime

        apply_runtime(os.environ["NEO4J_URI"], os.getenv("NEO4J_USER"), os.environ["NEO4J_PASSWORD"])

    def test_why_every_dimension_and_every_path_measure(self) -> None:
        catalog = merge_effective(IDENTITY.organization_id)
        failures: list[str] = []
        for dim in catalog["kg_measures"]["why_breakdown"].get("allowed_dimensions") or []:
            job = execute_graph(
                {
                    "shape": "breakdown",
                    "measure": "why_breakdown",
                    "path": "certified",
                    "scope": ORG,
                    "group_by": [dim],
                    "limit": 10,
                },
                IDENTITY,
                execute=True,
            )
            if "GROUP BY" in (job.get("cypher") or "").upper():
                failures.append(f"kg why {dim}: GROUP BY")
            msg = _fail(job, f"kg why {dim}")
            if msg:
                failures.append(msg)
        for measure_id, card in catalog["kg_measures"].items():
            if measure_id == "why_breakdown":
                continue
            dims = list(card.get("allowed_dimensions") or [])
            frame = {
                "shape": "find",
                "measure": measure_id,
                "path": "certified",
                "scope": {"level": "org" if "org" in (card.get("allowed_scope_levels") or ["org"]) else (card.get("allowed_scope_levels") or ["org"])[0]},
                "group_by": [dims[0]] if dims else [],
                "limit": 5,
            }
            job = execute_graph(frame, IDENTITY, execute=True)
            msg = _fail(job, f"kg {measure_id}")
            if msg:
                failures.append(msg)
        self.assertFalse(failures, "\n".join(failures))


if __name__ == "__main__":
    unittest.main()
