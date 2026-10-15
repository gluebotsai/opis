"""Metric MCP server providing vectorless lexical retrieval."""

import re
from pathlib import Path
from typing import Any

import yaml
from mcp.server.fastmcp import FastMCP

from app.mcp.context import get_tool_context


class MetricMCPServer:
    tool_names = (
        "list_metric_domains",
        "get_metrics",
        "get_metric",
        "get_metric_schema",
        "list_active_metrics",
        "remove_metrics",
    )

    def __init__(self, metrics_yaml_path: Path | None = None) -> None:
        if metrics_yaml_path is None:
            metrics_yaml_path = (
                Path(__file__).parent.parent.parent
                / "skills"
                / "packs"
                / "performance-analytics"
                / "references"
                / "metrics.yaml"
            )
        self.metrics_yaml_path = metrics_yaml_path
        self.metrics: list[dict[str, Any]] = []
        self.source_tables: list[str] = []
        self.default_filters: list[str] = []
        self.reload()
        self.mcp = FastMCP("metric")
        descriptions = {
            "list_metric_domains": "List supported metric domains.",
            "get_metrics": "Rank metric definitions with vectorless lexical matching.",
            "get_metric": (
                "Load the written definition of a metric by id. This does not return "
                "the live count. For a dashboard or Reports number, rate, or chart, "
                "including a question that asks what a KPI is, use generate_performance_report."
            ),
            "get_metric_schema": "Load metric definitions and grounded schema.",
            "list_active_metrics": "List metrics active in the current turn.",
            "remove_metrics": "Remove selected or all active metrics.",
        }
        for tool_name in self.tool_names:
            self.mcp.tool(name=tool_name, description=descriptions[tool_name])(
                getattr(self, tool_name)
            )

    def reload(self) -> None:
        self.metrics.clear()
        if not self.metrics_yaml_path.exists():
            return
        try:
            with open(self.metrics_yaml_path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
            if isinstance(data, dict):
                self.source_tables = data.get("source_tables", [])
                self.default_filters = data.get("default_filters", [])
                self.metrics = data.get("metrics", [])
        except Exception:
            pass

    async def list_metric_domains(self) -> list[str]:
        return ["performance", "workforce", "omnichannel"]

    def _normalize(self, text: str) -> list[str]:
        cleaned = re.sub(r"[^\w\s]", " ", text.lower())
        return [w for w in cleaned.split() if len(w) > 1]

    def _catalog_texts(self, metric: dict[str, Any]) -> dict[str, list[str]]:
        aliases = [str(item) for item in metric.get("aliases") or [] if str(item).strip()]
        questions = [str(item) for item in metric.get("example_questions") or []]
        return {
            "id": [str(metric.get("id", ""))],
            "label": [str(metric.get("label", "")), *aliases],
            "description": [str(metric.get("description", ""))],
            "questions": questions,
        }

    def _edit_distance(self, left: str, right: str) -> int:
        if left == right:
            return 0
        if not left:
            return len(right)
        if not right:
            return len(left)
        previous = list(range(len(right) + 1))
        for i, left_ch in enumerate(left, start=1):
            current = [i]
            for j, right_ch in enumerate(right, start=1):
                insert_cost = current[j - 1] + 1
                delete_cost = previous[j] + 1
                replace_cost = previous[j - 1] + (left_ch != right_ch)
                current.append(min(insert_cost, delete_cost, replace_cost))
            previous = current
        return previous[-1]

    def _near_catalog_token(self, token: str, text: str) -> bool:
        if len(token) < 2:
            return False
        for word in re.findall(r"[a-z0-9]+", text.casefold()):
            if token == word:
                return True
            if len(word) >= 3 and self._edit_distance(token, word) == 1:
                return True
        return False

    def _score_metric(self, metric: dict[str, Any], query: str) -> float:
        normalized_query = query.casefold().strip()
        fields = self._catalog_texts(metric)
        metric_id = fields["id"][0]
        label = fields["label"][0]
        score = 0.0
        if normalized_query == metric_id.casefold():
            score += 20.0
        if normalized_query == label.casefold():
            score += 15.0
        for alias in fields["label"][1:]:
            if normalized_query == alias.casefold():
                score += 14.0
        for token in self._normalize(query):
            if token in metric_id.casefold():
                score += 5.0
            label_blob = " ".join(fields["label"]).casefold()
            if token in label_blob:
                score += 4.0
            elif any(self._near_catalog_token(token, text) for text in fields["label"]):
                score += 3.5
            if any(token in text.casefold() for text in fields["description"]):
                score += 2.0
            for question in fields["questions"]:
                if token in question.casefold():
                    score += 3.0
            if not any(token in question.casefold() for question in fields["questions"]):
                if any(self._near_catalog_token(token, question) for question in fields["questions"]):
                    score += 2.5
        return score

    def _matches_feature(self, metric: dict[str, Any], feature: str | None) -> bool:
        if not feature:
            return True
        normalized = feature.casefold().strip()
        values = [
            *metric.get("dimensions", []),
            *metric.get("chart_hints", []),
            str(metric.get("id", "")),
            str(metric.get("label", "")),
        ]
        return any(normalized in str(value).casefold() for value in values)

    async def get_metrics(
        self,
        query: str,
        domain: str | None = None,
        feature: str | None = None,
        limit: int = 8,
    ) -> list[dict[str, Any]]:
        if domain and domain != "performance":
            return []
        scored_metrics: list[tuple[float, dict[str, Any]]] = []
        for metric in self.metrics:
            if not self._matches_feature(metric, feature):
                continue
            score = self._score_metric(metric, query)
            if score > 0:
                scored_metrics.append((score, metric))
        scored_metrics.sort(key=lambda item: (-item[0], str(item[1].get("id", ""))))
        return [
            {
                **metric,
                "score": round(score, 3),
                "canonicalLabel": str(metric.get("label") or metric.get("id") or ""),
            }
            for score, metric in scored_metrics[: max(1, min(limit, 50))]
        ]

    async def get_metric(self, metric_ids: list[str]) -> list[dict[str, Any]]:
        target_ids = set(metric_ids)
        matched = [metric for metric in self.metrics if metric.get("id") in target_ids]
        active_metrics = get_tool_context().active_metrics
        for metric in matched:
            active_metrics[str(metric["id"])] = dict(metric)
        return matched

    async def get_metric_schema(self, metric_ids: list[str]) -> dict[str, Any]:
        matched = await self.get_metric(metric_ids)
        tables = set()
        for metric in matched:
            for table in metric.get("tables", []):
                tables.add(table)
        schema = {
            "source_tables": list(tables or self.source_tables),
            "default_filters": self.default_filters,
            "metrics": matched,
        }
        get_tool_context().active_schema = schema
        return schema

    async def list_active_metrics(self) -> list[str]:
        return sorted(get_tool_context().active_metrics)

    async def remove_metrics(
        self,
        metric_ids: list[str] | None = None,
    ) -> dict[str, Any]:
        context = get_tool_context()
        active_metrics = context.active_metrics
        if not metric_ids:
            active_metrics.clear()
            context.active_schema = None
        else:
            for metric_id in metric_ids:
                active_metrics.pop(metric_id, None)
        return {"status": "updated", "active_metrics": sorted(active_metrics)}
