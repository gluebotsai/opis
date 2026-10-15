"""Iterative vector-less planner: certified metric, else gold SQL, else retrieval pack."""

from __future__ import annotations

import re
from typing import Any

from sql_agent.catalog import Catalog, Metric, load_catalog
from sql_agent.compile import compile_example, compile_metric
from sql_agent.dql import DqlError, mentions_select_star, validate_dql
from sql_agent.joins import join_path
from sql_agent.repair import repair_sql
from sql_agent.search import search_catalog
from sql_agent.textutil import tokenize
from sql_agent.wrap import wrap_preview_and_summary

CERTIFIED_MARGIN = 1.25
CERTIFIED_MIN = 8.0
EXAMPLE_MIN = 8.0
_GROUP_BY_RE = re.compile(r"\bgroup\s+by\b([\s\S]+)$", re.IGNORECASE)


class SqlPlanner:
    def __init__(self, catalog: Catalog | None = None) -> None:
        self.catalog = catalog or load_catalog()

    def plan(
        self,
        question: str,
        *,
        period_start: str | None = None,
        period_end: str | None = None,
        surface: str = "dashboard",
        preview_limit: int = 50,
    ) -> dict[str, Any]:
        iterations: list[dict[str, Any]] = []
        search = search_catalog(question, self.catalog)
        iterations.append(
            {
                "step": "search_catalog",
                "metrics": search["metrics"][:3],
                "tables": [item["name"] for item in search["tables"][:6]],
                "examples": [item["id"] for item in search["examples"][:3]],
                "glossary_hits": search["expansion"]["glossary_hits"],
                "fuzzy_hits": search["expansion"]["fuzzy_hits"],
            }
        )

        top_metric = search["metrics"][0] if search["metrics"] else None
        top_table_score = search["tables"][0]["score"] if search["tables"] else 0.0
        top_example = search["examples"][0] if search["examples"] else None
        example_beats_metric = (
            top_example is not None
            and top_metric is not None
            and top_example["score"] > top_metric["score"]
        )
        extra_dimension_tables = False
        if top_metric is not None:
            metric_obj = next(item for item in self.catalog.metrics if item.id == top_metric["id"])
            metric_tables = set(metric_obj.tables)
            strong_examples = [
                next(item for item in self.catalog.examples if item.id == entry["id"])
                for entry in search["examples"][:3]
                if entry["score"] >= EXAMPLE_MIN
            ]
            extra_dimension_tables = any(
                item["score"] >= 8
                and item["name"] not in metric_tables
                and any(item["name"] in (example.tables or []) for example in strong_examples)
                for item in search["tables"][:6]
            )
        missing_breakdown = False
        if top_metric is not None:
            missing_breakdown = _missing_breakdowns(question, metric_obj)
        certified = (
            top_metric is not None
            and not example_beats_metric
            and not extra_dimension_tables
            and not missing_breakdown
            and top_metric["score"] >= CERTIFIED_MIN
            and top_metric["score"] >= top_table_score * CERTIFIED_MARGIN
        )

        if certified:
            metric = next(item for item in self.catalog.metrics if item.id == top_metric["id"])
            table_names = metric.tables or ["ccass.conversations"]
            details = [self._table_summary(name) for name in table_names]
            path = join_path(table_names, self.catalog)
            iterations.append({"step": "get_metric", "metric_id": metric.id})
            iterations.append({"step": "get_table_details", "tables": table_names})
            iterations.append({"step": "get_join_path", "ok": path["ok"], "steps": path.get("steps")})
            sql = compile_metric(
                metric,
                self.catalog,
                period_start=period_start,
                period_end=period_end,
                surface=surface,
            )
            return self._finish(
                question,
                trust="certified",
                sql=sql,
                metric=top_metric,
                tables=details,
                join=path,
                examples=[],
                search=search,
                iterations=iterations,
                preview_limit=preview_limit,
                reason=f"Certified metric '{metric.id}' matched the question.",
            )

        use_example = top_example is not None and top_example["score"] >= EXAMPLE_MIN
        table_names = [item["name"] for item in search["tables"][:5]]
        if use_example:
            example = next(item for item in self.catalog.examples if item.id == top_example["id"])
            table_names = example.tables or table_names
            iterations.append({"step": "get_example", "example_id": example.id})

        details = [self._table_summary(name) for name in table_names]
        iterations.append({"step": "get_table_details", "tables": table_names})
        path = join_path(table_names, self.catalog) if table_names else {"ok": True, "tables": [], "steps": []}
        iterations.append({"step": "get_join_path", "ok": path.get("ok"), "steps": path.get("steps")})

        if use_example:
            example = next(item for item in self.catalog.examples if item.id == top_example["id"])
            sql = compile_example(
                example,
                self.catalog,
                period_start=period_start,
                period_end=period_end,
                surface=surface,
            )
            return self._finish(
                question,
                trust="generated",
                sql=sql,
                metric=top_metric,
                tables=details,
                join=path,
                examples=search["examples"][:2],
                search=search,
                iterations=iterations,
                preview_limit=preview_limit,
                reason=f"No certified KPI. Using gold example '{example.id}'.",
            )

        return self._finish(
            question,
            trust="review",
            sql=None,
            metric=top_metric,
            tables=details,
            join=path,
            examples=search["examples"][:2],
            search=search,
            iterations=iterations,
            preview_limit=preview_limit,
            reason=(
                "No certified metric or gold example scored high enough. "
                "Use the retrieved table cards and join path to write DQL."
            ),
        )

    def prepare_sql(self, sql: str, *, preview_limit: int = 50) -> dict[str, Any]:
        repaired = repair_sql(sql, self.catalog)
        candidate = repaired["repaired"]
        try:
            validate_dql(candidate, self.catalog)
        except DqlError as error:
            return {
                "ok": False,
                "error": str(error),
                "repair": repaired,
            }
        wrapped = wrap_preview_and_summary(candidate, self.catalog, limit=preview_limit)
        return {
            "ok": True,
            "repair": repaired,
            "select_star": mentions_select_star(candidate),
            **wrapped,
        }

    def _table_summary(self, name: str) -> dict[str, Any]:
        card = self.catalog.table(name)
        return {
            "name": card.name,
            "purpose": card.purpose,
            "grain": card.grain,
            "alias": card.alias,
            "columns": [
                {
                    "name": column.name,
                    "type": column.type,
                    "description": column.description,
                    "values": column.values,
                }
                for column in card.columns
            ],
            "sample_rows": card.sample_rows[:3],
            "blocked_select": card.blocked_select,
            "time_columns": card.time_columns,
        }

    def _finish(
        self,
        question: str,
        *,
        trust: str,
        sql: str | None,
        metric: dict[str, Any] | None,
        tables: list[dict[str, Any]],
        join: dict[str, Any],
        examples: list[dict[str, Any]],
        search: dict[str, Any],
        iterations: list[dict[str, Any]],
        preview_limit: int,
        reason: str,
    ) -> dict[str, Any]:
        prepared = None
        if sql:
            prepared = self.prepare_sql(sql, preview_limit=preview_limit)
            if prepared.get("ok"):
                sql = str(prepared["inner_sql"])
        return {
            "question": question,
            "trust": trust,
            "reason": reason,
            "metric": metric,
            "tables": tables,
            "join_path": join,
            "examples": examples,
            "sql": sql,
            "execute": prepared,
            "expansion": search["expansion"],
            "iterations": iterations,
        }


def _dimension_aliases(dimension: str) -> set[str]:
    dim = dimension.casefold()
    names = {dim}
    if dim.endswith("_id"):
        names.add(dim[:-3])
    if dim in {"assigned_agent_id", "agent_id"}:
        names.update({"agent", "agents", "advisor"})
    if dim in {"day", "date"}:
        names.update({"day", "daily", "date"})
    return names


def _question_mentions_dimension(question: str, dimension: str) -> bool:
    tokens = set(tokenize(question))
    return bool(tokens.intersection(_dimension_aliases(dimension)))


def _sql_covers_dimension(sql: str, dimension: str) -> bool:
    folded = re.sub(r"\s+", " ", sql.casefold())
    dim = dimension.casefold()
    if dim in {"day", "date"}:
        return "date_trunc('day'" in folded.replace(" ", "")
    match = _GROUP_BY_RE.search(sql)
    if not match:
        return False
    grouped = match.group(1).casefold()
    return any(re.search(rf"\b{re.escape(name)}\b", grouped) for name in _dimension_aliases(dimension))


def _missing_breakdowns(question: str, metric: Metric) -> bool:
    return any(
        _question_mentions_dimension(question, dimension)
        and not _sql_covers_dimension(metric.sql, dimension)
        for dimension in metric.dimensions or []
    )

