"""MCP-shaped tool adapters for the experiment (graduate into analytics MCP later)."""

from __future__ import annotations

import json
from typing import Any

from sql_agent.catalog import Catalog, load_catalog
from sql_agent.compile import compile_metric, fill_sql, named_window
from sql_agent.context import QueryContext
from sql_agent.joins import join_path
from sql_agent.planner import SqlPlanner
from sql_agent.scope import apply_scope
from sql_agent.search import search_catalog
from sql_agent.warehouse import execute_dql, live_enabled
from sql_agent.wrap import summarize_rows

OPENAI_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_catalog",
            "description": (
                "Lexical search over certified metrics, table cards, and gold examples. "
                "Glossary and spelling expansion happen inside the tool."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Natural-language analytics question"},
                    "limit": {
                        "type": "integer",
                        "description": "Max table cards to return",
                        "default": 8,
                    },
                },
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_metric",
            "description": "Return one certified KPI card including SQL, tables, and caveats.",
            "parameters": {
                "type": "object",
                "properties": {
                    "metric_id": {"type": "string"},
                },
                "required": ["metric_id"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_table_details",
            "description": "Fetch column cards, enums, and sample grain for named catalog tables.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tables": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Fully qualified table names, e.g. ccass.conversations",
                    },
                },
                "required": ["tables"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_join_path",
            "description": "Certified join graph between tables. Do not invent FKs if ok is false.",
            "parameters": {
                "type": "object",
                "properties": {
                    "tables": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["tables"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "plan_query",
            "description": (
                "Deterministic catalog planner. Call this after lock_period when the user "
                "named yesterday, today, last week, or last month. When live, certified or "
                "generated SQL is executed with the trusted period. Do not pass dates."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "period_start": {"type": "string"},
                    "period_end": {"type": "string"},
                    "surface": {
                        "type": "string",
                        "enum": ["dashboard", "performance"],
                        "default": "dashboard",
                    },
                },
                "required": ["question"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lock_period",
            "description": (
                "Lock the trusted time window from a named period the user asked for. "
                "Call this before plan_query when they say yesterday, today, this week, "
                "last 7 days, or last month. The executor computes the timestamps."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "window": {
                        "type": "string",
                        "enum": [
                            "yesterday",
                            "today",
                            "this_week",
                            "last_7_days",
                            "last_month",
                        ],
                    },
                },
                "required": ["window"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "sql_analytics",
            "description": (
                "Validate DQL and run tenant-scoped Postgres. Period and organization_id "
                "are injected by the executor. If plan_query already compiled SQL, that SQL is used. "
                "Use headline and preview only. Do not invent counts."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "sql": {"type": "string", "description": "SELECT/WITH statement"},
                    "preview_limit": {"type": "integer", "default": 50},
                },
                "required": ["sql"],
                "additionalProperties": False,
            },
        },
    },
]


def as_str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.replace(";", ",").split(",") if part.strip()]
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()]


def parse_tool_arguments(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        return {}
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {"_parse_error": text[:800]}
    if isinstance(data, dict):
        return data
    return {"value": data}


def compact_plan(plan: dict[str, Any]) -> dict[str, Any]:
    execute = plan.get("execute") or {}
    compact_execute = None
    if execute:
        compact_execute = {
            "ok": execute.get("ok"),
            "error": execute.get("error"),
            "preview_limit": execute.get("preview_limit"),
            "select_star": execute.get("select_star"),
            "repair": execute.get("repair"),
        }
    tables = []
    for table in plan.get("tables") or []:
        tables.append(
            {
                "name": table.get("name"),
                "purpose": table.get("purpose"),
                "grain": table.get("grain"),
                "columns": [
                    {
                        "name": column.get("name"),
                        "type": column.get("type"),
                        "values": column.get("values") or [],
                    }
                    for column in table.get("columns") or []
                ],
                "sample_rows": (table.get("sample_rows") or [])[:2],
                "blocked_select": table.get("blocked_select") or [],
            }
        )
    join = plan.get("join_path") or {}
    expansion = plan.get("expansion") or {}
    return {
        "question": plan.get("question"),
        "trust": plan.get("trust"),
        "reason": plan.get("reason"),
        "metric": plan.get("metric"),
        "sql": plan.get("sql"),
        "execute": compact_execute,
        "tables": tables,
        "join_path": {
            "ok": join.get("ok"),
            "sql_from": join.get("sql_from"),
            "steps": join.get("steps"),
            "missing": join.get("missing"),
        },
        "examples": plan.get("examples") or [],
        "expansion": {
            "glossary_hits": expansion.get("glossary_hits"),
            "fuzzy_hits": expansion.get("fuzzy_hits"),
        },
        "iterations": plan.get("iterations") or [],
    }


class SqlAgentTools:
    def __init__(
        self,
        catalog: Catalog | None = None,
        *,
        live: bool | None = None,
        ctx: QueryContext | None = None,
    ) -> None:
        self.catalog = catalog or load_catalog()
        self.planner = SqlPlanner(self.catalog)
        self.live = live_enabled() if live is None else live
        self.ctx = ctx or QueryContext.resolve()
        self.last_plan: dict[str, Any] | None = None
        self.last_result: dict[str, Any] | None = None

    def reset(self) -> None:
        self.last_plan = None
        self.last_result = None

    def bind(self, ctx: QueryContext) -> None:
        self.ctx = ctx
        self.reset()

    def search_catalog(self, query: str, limit: int = 8) -> dict[str, Any]:
        result = search_catalog(query, self.catalog, table_limit=limit)
        expansion = result.get("expansion") or {}
        return {
            "question": result.get("question"),
            "metrics": result.get("metrics") or [],
            "tables": result.get("tables") or [],
            "examples": result.get("examples") or [],
            "expansion": {
                "glossary_hits": expansion.get("glossary_hits"),
                "fuzzy_hits": expansion.get("fuzzy_hits"),
            },
        }

    def get_metric(self, metric_id: str) -> dict[str, Any]:
        metric = next((item for item in self.catalog.metrics if item.id == metric_id), None)
        if metric is None:
            return {"error": f"Unknown metric {metric_id}"}
        compiled = compile_metric(
            metric,
            self.catalog,
            period_start=self.ctx.period_start,
            period_end=self.ctx.period_end,
            surface=self.ctx.surface,
        )
        return {
            "id": metric.id,
            "label": metric.label,
            "description": metric.description,
            "tables": metric.tables,
            "join_path": metric.join_path,
            "sql": compiled,
            "formula": metric.formula,
            "caveats": metric.caveats,
            "dimensions": metric.dimensions,
            "chart_hints": metric.chart_hints,
            "period_start": self.ctx.period_start,
            "period_end": self.ctx.period_end,
        }

    def get_table_details(self, tables: list[str]) -> dict[str, Any]:
        cards = []
        missing = []
        for name in tables:
            try:
                cards.append(self.planner._table_summary(name))
            except KeyError:
                missing.append(name)
        return {"tables": cards, "missing": missing}

    def get_join_path(self, tables: list[str]) -> dict[str, Any]:
        return join_path(tables, self.catalog)

    def plan_query(
        self,
        question: str,
        period_start: str | None = None,
        period_end: str | None = None,
        surface: str = "dashboard",
    ) -> dict[str, Any]:
        del period_start, period_end
        plan = self.planner.plan(
            question,
            period_start=self.ctx.period_start,
            period_end=self.ctx.period_end,
            surface=surface or self.ctx.surface,
        )
        compact = compact_plan(plan)
        compact["period_start"] = self.ctx.period_start
        compact["period_end"] = self.ctx.period_end
        compact["organization_id"] = self.ctx.organization_id
        self.last_plan = compact
        execute = plan.get("execute") or {}
        if self.live and execute.get("ok") and execute.get("execute_sql"):
            warehouse = self._warehouse_execute(str(execute["execute_sql"]))
            compact["warehouse"] = {
                "ok": warehouse.get("ok"),
                "dry_run": warehouse.get("dry_run"),
                "headline": warehouse.get("headline"),
                "preview": warehouse.get("preview"),
                "error": warehouse.get("error"),
            }
            compact["headline"] = warehouse.get("headline")
            compact["preview"] = warehouse.get("preview")
            compact["numbers_locked"] = warehouse.get("ok") is True
        return compact

    def lock_period(self, window: str) -> dict[str, Any]:
        try:
            start, end = named_window(window)
        except ValueError as error:
            return {"ok": False, "error": str(error)}
        self.bind(
            QueryContext(
                organization_id=self.ctx.organization_id,
                period_start=start,
                period_end=end,
                surface=self.ctx.surface,
            )
        )
        return {
            "ok": True,
            "window": window,
            "period_start": self.ctx.period_start,
            "period_end": self.ctx.period_end,
            "period_label": self.ctx.period_label,
            "note": "Trusted period updated. Call plan_query next. Name this window in the answer.",
        }

    def prepare_sql(self, sql: str, preview_limit: int = 50) -> dict[str, Any]:
        return self.planner.prepare_sql(sql, preview_limit=preview_limit)

    def _warehouse_execute(self, execute_sql: str, *, preview_limit: int = 50) -> dict[str, Any]:
        scoped = apply_scope(execute_sql, self.ctx, self.catalog)
        executed = execute_dql(scoped, organization_id=self.ctx.organization_id)
        if not executed.get("ok"):
            payload = {
                "ok": False,
                "dry_run": False,
                "warehouse": executed.get("warehouse"),
                "error": executed.get("error"),
                "period_start": self.ctx.period_start,
                "period_end": self.ctx.period_end,
                "organization_id": self.ctx.organization_id,
            }
            self.last_result = payload
            return payload
        summary = summarize_rows(executed.get("rows") or [], preview_limit=preview_limit)
        preview = executed.get("preview") or summary.get("preview") or []
        payload = {
            "ok": True,
            "dry_run": False,
            "warehouse": "postgres",
            "organization_id": executed.get("organization_id"),
            "period_start": self.ctx.period_start,
            "period_end": self.ctx.period_end,
            "note": (
                "headline and preview are live tenant-scoped warehouse results "
                f"for {self.ctx.period_label}. The user-visible answer must use only these values."
            ),
            "headline": _headline(preview),
            "preview_limit": preview_limit,
            "total_matched_rows": summary.get("total_matched_rows"),
            "truncated": summary.get("truncated"),
            "preview": preview,
        }
        self.last_result = payload
        return payload

    def sql_analytics(self, sql: str, preview_limit: int = 50) -> dict[str, Any]:
        candidate = sql
        locked = self.last_plan or {}
        if locked.get("trust") in {"certified", "generated"} and locked.get("sql"):
            candidate = str(locked["sql"])
        if "{{" in candidate:
            candidate = fill_sql(
                candidate,
                period_start=self.ctx.period_start,
                period_end=self.ctx.period_end,
                time_expr="COALESCE(assigned_at, resolved_at, ended_at, created_at)",
                catalog=self.catalog,
                table_for_time="ccass.conversations",
            )
        prepared = self.prepare_sql(candidate, preview_limit=preview_limit)
        if not prepared.get("ok"):
            return {
                "ok": False,
                "dry_run": not self.live,
                "warehouse": "unavailable",
                "error": prepared.get("error"),
                "repair": prepared.get("repair"),
                "period_start": self.ctx.period_start,
                "period_end": self.ctx.period_end,
            }
        inner = str(prepared.get("inner_sql") or candidate)
        if not self.live:
            mentioned = [
                name
                for name in self.catalog.tables
                if name.casefold() in inner.casefold()
                or name.split(".")[-1].casefold() in inner.casefold()
            ]
            samples = {
                name: (self.catalog.table(name).sample_rows or [])[:3] for name in mentioned[:6]
            }
            return {
                "ok": True,
                "dry_run": True,
                "warehouse": "unavailable",
                "note": (
                    "SQL passed DQL validation. Live warehouse is off. "
                    "Do not invent organisation counts."
                ),
                "preview_limit": prepared.get("preview_limit", preview_limit),
                "repair": prepared.get("repair"),
                "inner_sql": prepared.get("inner_sql"),
                "sample_rows": samples,
                "period_start": self.ctx.period_start,
                "period_end": self.ctx.period_end,
            }
        result = self._warehouse_execute(
            str(prepared.get("execute_sql") or inner),
            preview_limit=preview_limit,
        )
        result["repair"] = prepared.get("repair")
        return result

    def dispatch(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if arguments.get("_parse_error"):
            return {
                "error": "Could not parse tool arguments as JSON.",
                "raw": arguments["_parse_error"],
            }
        if name == "search_catalog":
            query = str(arguments.get("query") or arguments.get("question") or "")
            limit = int(arguments.get("limit") or 8)
            return self.search_catalog(query, limit=limit)
        if name == "get_metric":
            return self.get_metric(str(arguments.get("metric_id") or ""))
        if name == "get_table_details":
            return self.get_table_details(as_str_list(arguments.get("tables")))
        if name == "get_join_path":
            return self.get_join_path(as_str_list(arguments.get("tables")))
        if name == "plan_query":
            return self.plan_query(
                str(arguments.get("question") or arguments.get("query") or ""),
                surface=str(arguments.get("surface") or self.ctx.surface),
            )
        if name == "lock_period":
            return self.lock_period(str(arguments.get("window") or ""))
        if name == "sql_analytics":
            sql = str(arguments.get("sql") or "")
            preview_limit = int(arguments.get("preview_limit") or 50)
            return self.sql_analytics(sql, preview_limit=preview_limit)
        if name == "prepare_sql":
            return self.prepare_sql(
                str(arguments.get("sql") or ""),
                preview_limit=int(arguments.get("preview_limit") or 50),
            )
        return {"error": f"Unknown tool {name}"}


def _headline(preview: list[dict[str, Any]]) -> str:
    if not preview:
        return "No matching rows in the warehouse for this period."
    values = [value for row in preview for value in row.values()]
    if values and all(value in {None, "n/a"} for value in values):
        return "No matching values in the warehouse for this period."
    if len(preview) == 1:
        return "; ".join(f"{key}={value}" for key, value in preview[0].items())
    parts = []
    for row in preview[:8]:
        parts.append(", ".join(f"{key}={value}" for key, value in row.items()))
    return f"{len(preview)} groups: " + "; ".join(parts)
