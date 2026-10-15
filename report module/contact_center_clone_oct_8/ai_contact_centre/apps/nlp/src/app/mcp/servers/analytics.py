"""Analytics MCP server for grounded, read-only performance operations."""

import math
import re
from datetime import date
from typing import Annotated, Any, Literal

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from app.mcp.context import (
    CcCoreHTTPAdapter,
    execute_once,
    get_tool_context,
    get_trusted_context,
)
from app.services.ontology_layer import (
    ask_ontology_layer_gateway,
    ontology_layer_configured,
)
from app.services.semantic_layer import (
    ask_semantic_layer_gateway,
    enrich_query_with_period,
    format_duration_seconds,
    interpret_semantic_response,
    log_semantic_layer_call,
    semantic_layer_configured,
)
from app.skills.registry import get_skill_registry

PerformanceMetricId = Literal[
    "conversations_handled",
    "resolution_rate",
    "avg_handle_time",
    "avg_first_response",
    "response_sla_60s",
    "transfers",
    "channel_mix",
    "daily_handled_trend",
    "disposition_mix",
]

FORBIDDEN_SQL = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|"
    r"EXECUTE|EXEC|COPY|REINDEX|VACUUM|MERGE|UPSERT|CALL|SET|RESET|LOCK|"
    r"BEGIN|COMMIT|ROLLBACK|SAVEPOINT|COMMENT|DO|PREPARE|DEALLOCATE)\b",
    re.IGNORECASE,
)

FOCUS_ALIASES = {
    "handled": "handled",
    "conversations_handled": "handled",
    "resolution": "resolutionRate",
    "resolution_rate": "resolutionRate",
    "first_response": "avgFirstResponseSeconds",
    "avg_first_response": "avgFirstResponseSeconds",
    "handle_time": "avgHandleSeconds",
    "avg_handle_time": "avgHandleSeconds",
    "aht": "avgHandleSeconds",
    "sla": "slaRate",
    "response_sla": "slaRate",
    "response_sla_60s": "slaRate",
    "transferred": "transferred",
    "transfers": "transferred",
}

# Cube / semantic metric ids that are the same Reports tiles. Do not map
# email policy SLAs or custom dimensional queries.
REPORTS_KPI_OVERLAP: dict[str, PerformanceMetricId] = {
    "response_sla": "response_sla_60s",
    "response_sla_60s": "response_sla_60s",
    "response_sla_pct": "response_sla_60s",
    "first_reply_sla": "response_sla_60s",
    "first_response_sla": "response_sla_60s",
    "avg_first_response": "avg_first_response",
    "average_first_response": "avg_first_response",
    "avg_first_response_seconds": "avg_first_response",
    "resolution_rate": "resolution_rate",
    "avg_handle_time": "avg_handle_time",
    "average_handle_time": "avg_handle_time",
    "average_handle": "avg_handle_time",
}

_REPORTS_KPI_LABEL_HINTS: tuple[tuple[str, PerformanceMetricId], ...] = (
    ("first-reply sla", "response_sla_60s"),
    ("first reply sla", "response_sla_60s"),
    ("response sla", "response_sla_60s"),
    ("average first response", "avg_first_response"),
    ("first response", "avg_first_response"),
    ("resolution rate", "resolution_rate"),
    ("handle time", "avg_handle_time"),
    ("average handle", "avg_handle_time"),
)

CANONICAL_PLOT_TITLES = {
    "first-reply sla": "First-Reply SLA",
    "ai channel mix": "AI Channel Mix",
    "support agent channel mix": "Support Agent Channel Mix",
    "channel mix": "Channel Mix",
}

MISSED_CONTACT_RATE_CONTRACT = {
    "formula": "uniqueMissedConversations / agentDemandConversations × 100",
    "canExceed100": True,
    "interpretation": (
        "Share of queued (agent-demand) conversations that missed at least once. "
        "One conversation can miss several times; unique count is the numerator. "
        "Rates above 100% are valid when unique missed conversations exceed demand."
    ),
}

ANALYTICS_INCIDENT_CATALOG = {
    "live": [
        {
            "code": "missed_contact_spike",
            "name": "Missed-contact spike (15-minute)",
        },
        {
            "code": "weekly_missed_contact_spike",
            "name": "Missed-contact spike (week over week)",
        },
    ],
    "planned": [
        {"code": "volume_spike_or_drop", "name": "Inbound / handled-volume spike or drop"},
        {"code": "queue_wait_increase", "name": "Queue-wait increase and live backlog"},
        {"code": "routing_failure_increase", "name": "Routing-failure increase"},
        {"code": "assignment_reject_expiry", "name": "Assignment rejection / expiry increase"},
        {"code": "ready_coverage_decline", "name": "Ready-agent coverage decline"},
        {"code": "handle_time_increase", "name": "AHT or first-response-time increase"},
        {"code": "callback_backlog", "name": "Callback backlog and unrecovered missed contacts"},
    ],
    "outOfV1": ["configured_sla_breach"],
}


def _normalize_metric_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").casefold()).strip("_")


def _edit_distance(left: str, right: str) -> int:
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


def _fold_title(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().casefold())


def prefer_canonical_title(title: str | None, canonical: str) -> str:
    """Keep custom titles; fold near-miss catalog names to the canonical label."""
    if not canonical:
        return str(title or "").strip()
    if not title or not str(title).strip():
        return canonical
    folded = _fold_title(title)
    mapped = CANONICAL_PLOT_TITLES.get(folded)
    if mapped:
        return mapped
    folded_canonical = _fold_title(canonical)
    if folded == folded_canonical:
        return canonical
    if abs(len(folded) - len(folded_canonical)) <= 2 and _edit_distance(folded, folded_canonical) <= 2:
        return canonical
    return str(title).strip()


def _reports_overlap_from_key(value: str) -> PerformanceMetricId | None:
    key = _normalize_metric_key(value)
    if not key or "email" in key:
        return None
    mapped = REPORTS_KPI_OVERLAP.get(key)
    if mapped:
        return mapped
    if "response_sla" in key or key.endswith("_first_reply_sla"):
        return "response_sla_60s"
    return None


def _semantic_metric_keys(result: dict[str, Any]) -> list[str]:
    keys: list[str] = []
    metric_id = result.get("metric_id")
    if metric_id:
        keys.append(str(metric_id))
    for item in result.get("metrics") or []:
        if isinstance(item, dict) and item.get("metric_id"):
            keys.append(str(item["metric_id"]))
    return keys


def _semantic_kpi_labels(result: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for row in list(result.get("kpis") or []) + list(result.get("data") or []):
        if isinstance(row, dict) and row.get("label"):
            labels.append(str(row["label"]))
    title = result.get("title")
    if title:
        labels.append(str(title))
    return labels


def semantic_reports_kpi_id(
    result: dict[str, Any],
    *,
    chart_type: str | None = None,
) -> PerformanceMetricId | None:
    """Return a Reports metric id when Cube answered a panel KPI as a scalar card.

    Line/pie/bar Cube answers and mixed metric payloads stay on the semantic path.
    """
    if not result.get("ok"):
        return None
    if result.get("plots"):
        return None
    chart = str(result.get("chartType") or chart_type or "kpi").strip().lower()
    if chart != "kpi":
        return None
    mapped: list[PerformanceMetricId] = []
    keys = _semantic_metric_keys(result)
    if keys:
        for key in keys:
            overlap = _reports_overlap_from_key(key)
            if overlap is None:
                return None
            mapped.append(overlap)
    else:
        for label in _semantic_kpi_labels(result):
            folded = _fold_title(label)
            for hint, metric_id in _REPORTS_KPI_LABEL_HINTS:
                if hint in folded:
                    mapped.append(metric_id)
                    break
    unique = list(dict.fromkeys(mapped))
    if len(unique) != 1:
        return None
    return unique[0]

KPI_LABELS = {
    "handled": "Handled",
    "resolutionRate": "Resolution rate",
    "avgFirstResponseSeconds": "First response",
    "avgHandleSeconds": "Handle time",
    "slaRate": "First-Reply SLA",
    "transferred": "Transferred",
}

CHANNEL_DISPLAY = {
    "webchat": "Webchat",
    "whatsapp": "WhatsApp",
    "email": "Email",
    "instagram": "Instagram",
    "facebook": "Facebook",
    "voice": "Voice",
    "sms": "SMS",
}

HANDLER_FOCUS = {
    "ai": "ai",
    "ai_channel_mix": "ai",
    "ai_handled": "ai",
    "agent": "agent",
    "support_agent": "agent",
    "support_agent_channel_mix": "agent",
    "agent_channel_mix": "agent",
}

_DURATION_HINT_RE = re.compile(
    r"handle\s*time|\baht\b|first\s*response|duration|seconds?|minutes?|hours?",
    re.IGNORECASE,
)
_DISPLAY_UNIT_RE = re.compile(
    r"\d\s*(?:h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b|%",
    re.IGNORECASE,
)
_MINUTES_HINT_RE = re.compile(r"minute", re.IGNORECASE)

_TIME_COLUMN_HINTS = frozenset(
    {"day", "date", "dt", "bucket", "conversation__created_at__day"}
)
_SERIES_COLUMN_HINTS = frozenset({"channel", "conversation__channel"})


def _is_time_column(key: str) -> bool:
    lowered = str(key).strip().lower()
    return lowered in _TIME_COLUMN_HINTS or lowered.endswith("__day") or lowered.endswith("_date")


def _is_series_column(key: str) -> bool:
    lowered = str(key).strip().lower()
    return lowered in _SERIES_COLUMN_HINTS or lowered.endswith("__channel")


def _looks_like_time_value(value: Any) -> bool:
    text = str(value or "").strip()
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}", text))


def _first_matching_column(row: dict[str, Any], predicate) -> str | None:
    for key in row:
        if predicate(str(key)):
            return str(key)
    return None


def _pick_value_column(row: dict[str, Any], excluded: set[str]) -> str | None:
    for key, value in row.items():
        if str(key) in excluded or isinstance(value, bool):
            continue
        if isinstance(value, (int, float)):
            return str(key)
    return None


def _resolve_plot_columns(
    rows: list[Any],
    presentation: dict[str, Any],
) -> tuple[str, str]:
    sample = next((row for row in rows if isinstance(row, dict)), None)
    requested_label = str(presentation.get("label_column") or "").strip()
    requested_value = str(presentation.get("value_column") or "").strip()
    if not isinstance(sample, dict):
        return requested_label or "label", requested_value or "value"

    time_key = _first_matching_column(sample, _is_time_column)
    series_key = _first_matching_column(sample, _is_series_column)
    chart_type = str(presentation.get("chart_type") or "").strip().lower()
    label_column = requested_label
    if not label_column or label_column not in sample:
        label_column = time_key or next(iter(sample), "label")
    if (
        chart_type == "line"
        and time_key
        and series_key
        and (not requested_label or requested_label == series_key or requested_label not in sample)
    ):
        label_column = time_key

    value_column = requested_value
    if not value_column or value_column not in sample:
        excluded = {label_column}
        if series_key:
            excluded.add(series_key)
        value_column = _pick_value_column(sample, excluded) or "value"
    return label_column, value_column


def _infer_series_column(
    rows: list[Any],
    presentation: dict[str, Any],
    label_column: str,
) -> str | None:
    sample = next((row for row in rows if isinstance(row, dict)), None)
    if not isinstance(sample, dict):
        return None
    explicit = presentation.get("series_column")
    if isinstance(explicit, str) and explicit.strip() and explicit.strip() in sample:
        return explicit.strip()
    chart_type = str(presentation.get("chart_type") or "").strip().lower()
    if chart_type != "line":
        return None
    label_is_time = _is_time_column(label_column) or _looks_like_time_value(
        sample.get(label_column)
    )
    if not label_is_time:
        return None
    for key in sample:
        if key == label_column:
            continue
        if _is_series_column(str(key)):
            return str(key)
    return None


def _normalize_generated_point(point: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(point)
    if normalized.get("label") in (None, ""):
        for key, value in point.items():
            if value in (None, ""):
                continue
            if _is_time_column(str(key)) or str(key) in {"name", "x", "date"}:
                normalized["label"] = value
                break
    if normalized.get("value") is None:
        for key in ("y", "count", "handled"):
            if point.get(key) is not None:
                normalized["value"] = point[key]
                break
        if normalized.get("value") is None:
            numeric_key = _pick_value_column(
                point,
                {
                    str(key)
                    for key in point
                    if _is_time_column(str(key)) or _is_series_column(str(key))
                },
            )
            if numeric_key:
                normalized["value"] = point[numeric_key]
    series = normalized.get("series") or normalized.get("channel")
    if series in (None, ""):
        for key, value in point.items():
            if _is_series_column(str(key)) and value not in (None, ""):
                series = value
                break
    if series not in (None, ""):
        normalized["series"] = _series_display_name(series)
    return normalized


def _series_display_name(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return "Unknown"
    return CHANNEL_DISPLAY.get(text.lower(), text)


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

AGENT_ID_COLUMNS = frozenset(
    {
        "assigned_user_id",
        "user_id",
        "agent_id",
        "agentid",
    }
)


class AnalyticsMCPServer:
    tool_names = (
        "ask_ontology_layer",
        "ask_semantic_layer",
        "sql_analytics",
        "generate_plot",
        "generate_performance_report",
        "get_dashboard_analytics_snapshot",
        "get_analytics_hourly_volume",
    )

    def __init__(self) -> None:
        self.http = CcCoreHTTPAdapter()
        self.mcp = FastMCP("analytics")
        descriptions = {
            "ask_ontology_layer": (
                "Ask the ontology / knowledge-graph layer for comparative causal questions "
                "on the admin dashboard only — for example why a metric changed versus another "
                "period, or how two metrics relate. Never use it to explain a rate already on "
                "Reports (First-Reply SLA, resolution rate, and similar). Those use "
                "generate_performance_report so the number matches the panel, then slaBreakdown."
            ),
            "ask_semantic_layer": (
                "Ask the semantic metrics layer a business analytics question in plain language. "
                "Use for questions the Reports overview cannot answer (custom joins, metrics not "
                "on the panel, dimensional cuts). Scalar Reports KPIs (First-Reply SLA, first "
                "response, resolution rate, handle time) are grounded to generate_performance_report "
                "so the number matches the panel. Pass chart_type when the user asked for a "
                "pie, bar, or line. On ok=false, the agent chooses generate_performance_report or "
                "sql_analytics — this tool does not guess chart type from keywords."
            ),
            "sql_analytics": (
                "Run one validated, read-only SELECT/WITH analytics query. "
                "For one line per channel, GROUP BY day and channel and pass presentation "
                "chart_type=line, label_column=day, value_column=the count, series_column=channel."
            ),
            "generate_plot": (
                "Build a plot grounded in prior tool rows from this turn. "
                "For one line per channel, each data point needs label (day), value, and series (channel)."
            ),
            "generate_performance_report": (
                "Fetch live Reports / My Performance overview for the resolved period. "
                "Source of truth for KPIs visible on Reports: handled, resolution, first response, "
                "handle time, First-Reply SLA, transfers, AI channel mix, support agent channel mix, "
                "dispositions, and daily trends. Use this when the user asks why a displayed rate "
                "is X% so the number matches the panel. SLA cards include sampleSize, withinSlaCount, "
                "missedSlaCount, and slaBreakdown (who missed the 60s window). "
                "Pass focus ['ai'] or ['agent'] for those channel-mix donuts. "
                "Duration KPIs: empty averages are — ; 0s with sampleSize>0 is a rounded sub-second mean. "
                "When the user names a period, pass start and end as inclusive YYYY-MM-DD computed "
                "from Today in the system prompt and omit range. range is only 7d, 30d, or 90d. "
                "A two-day window is start and end, not a range value. Do not ask the user to "
                "switch to 7 or 30 days."
            ),
            "get_dashboard_analytics_snapshot": (
                "Load the live Admin Analytics snapshot: diagnostic incidents, selected incident "
                "facts (unique missed, demand, missed-contact rate, drivers), week-over-week "
                "comparison, predictive summary, hourly volume evidence, and recommendations. "
                "Source of truth for the Analytics page. Missed-contact rate is unique/demand × 100 "
                "and can exceed 100%. Never treat that as a reporting error."
            ),
            "get_analytics_hourly_volume": (
                "Load historical and forecast inbound volume by hour of day, including peak-hour "
                "evidence. Use this when the user asks why a peak hour is selected or wants "
                "hourly volume. Do not use daily Reports trends as proof."
            ),
        }
        for tool_name in self.tool_names:
            self.mcp.tool(name=tool_name, description=descriptions[tool_name])(
                getattr(self, tool_name)
            )

    def _validate_sql(self, sql: str) -> str:
        if not sql.strip():
            raise ValueError("SQL query cannot be empty.")
        cleaned = re.sub(r"--.*$", "", sql, flags=re.MULTILINE)
        cleaned = re.sub(r"/\*[\s\S]*?\*/", "", cleaned).strip()
        trimmed = cleaned.rstrip(";").strip()
        if ";" in trimmed:
            raise ValueError("Multi-statement SQL execution is strictly forbidden.")
        forbidden = FORBIDDEN_SQL.search(cleaned)
        if forbidden:
            raise ValueError(f"Operation '{forbidden.group(0).upper()}' is forbidden.")
        first_word = cleaned.split()[0].upper() if cleaned.split() else ""
        if first_word not in {"SELECT", "WITH"}:
            raise ValueError("SQL must begin with SELECT or WITH.")
        return cleaned

    def _loaded_knowledge(self) -> dict[str, Any]:
        context = get_tool_context()
        return {
            "active_skills": list(context.active_skills.values()),
            "active_metrics": list(context.active_metrics.values()),
            "schema": context.active_schema,
            "period": {
                "range": context.period_range,
                "start": context.period_start,
                "end": context.period_end,
            },
        }

    def _sql_error(
        self,
        query_description: str,
        sql_query: str,
        error: str,
        stage: str,
    ) -> dict[str, Any]:
        return {
            "ok": False,
            "stage": stage,
            "query_description": query_description,
            "sql_query": sql_query,
            "error": error,
            "repair_hint": "Repair the SELECT/WITH query using loaded metrics and schema.",
            "loaded_knowledge": self._loaded_knowledge(),
        }

    def _looks_like_uuid(self, value: Any) -> bool:
        return isinstance(value, str) and bool(UUID_RE.match(value.strip()))

    async def _agent_name_map(self, context: Any) -> dict[str, str]:
        cached = context.executed_tool_results.get("__agent_name_map__")
        if isinstance(cached, dict):
            return cached
        try:
            payload = await self.http.request(
                "GET",
                "/api/v1/setup/workforce/agents",
                context,
            )
        except Exception:
            return {}
        agents = payload.get("agents", []) if isinstance(payload, dict) else []
        mapping: dict[str, str] = {}
        for agent in agents:
            if not isinstance(agent, dict):
                continue
            agent_id = str(agent.get("id") or "").strip()
            if not agent_id:
                continue
            parts = [
                str(agent.get("firstName") or "").strip(),
                str(agent.get("lastName") or "").strip(),
            ]
            name = " ".join(part for part in parts if part) or str(agent.get("workEmail") or "Unknown agent")
            mapping[agent_id] = name
        context.executed_tool_results["__agent_name_map__"] = mapping
        return mapping

    def _resolve_display_label(self, label: Any, name_map: dict[str, str]) -> str:
        text = str(label or "").strip()
        if not text:
            return "Unknown"
        if self._looks_like_uuid(text):
            return name_map.get(text, "Unknown agent")
        return text

    async def _build_plot_points(
        self,
        rows: list[Any],
        presentation: dict[str, Any],
        context: Any,
    ) -> list[dict[str, Any]]:
        label_column, value_column = _resolve_plot_columns(rows, presentation)
        series_column = _infer_series_column(rows, presentation, label_column)
        unit = str(presentation.get("unit") or "")
        name_map = await self._agent_name_map(context)
        points: list[dict[str, Any]] = []
        for index, row in enumerate(rows):
            if not isinstance(row, dict) or value_column not in row:
                continue
            label = row.get(label_column)
            if label is None:
                for fallback in ("agent", "agent_name", "name", "channel", "day", "date"):
                    if fallback == series_column:
                        continue
                    if row.get(fallback) not in (None, ""):
                        label = row.get(fallback)
                        break
            if label is None:
                for key, value in row.items():
                    if str(key).lower() in AGENT_ID_COLUMNS and value not in (None, ""):
                        label = value
                        break
            if label is None:
                label = presentation.get("metric_label") or f"Result {index + 1}"
            resolved_label = self._resolve_display_label(label, name_map)
            value = row[value_column]
            title = str(presentation.get("title") or "")
            formatted = self._format_plot_metric_value(
                f"{title} {resolved_label} {value_column} {unit}",
                value,
                unit=unit,
            )
            if formatted is not None and formatted != value:
                value = formatted
            elif unit and value is not None and not _DISPLAY_UNIT_RE.search(str(value)):
                value = f"{value}{unit}"
            point: dict[str, Any] = {
                "label": resolved_label,
                "value": value,
            }
            if series_column and row.get(series_column) not in (None, ""):
                point["series"] = _series_display_name(row.get(series_column))
            points.append(point)
        return points

    def _is_org_analytics_surface(self) -> bool:
        try:
            return get_trusted_context().surface in {"dashboard", "analytics"}
        except RuntimeError:
            return False

    def _is_dashboard_surface(self) -> bool:
        return self._is_org_analytics_surface()

    def _analytics_overview_path(self) -> str:
        return (
            "/api/v1/dashboard/overview"
            if self._is_org_analytics_surface()
            else "/api/v1/performance/me"
        )

    def _analytics_sql_path(self) -> str:
        return (
            "/api/v1/dashboard/overview/sql"
            if self._is_dashboard_surface()
            else "/api/v1/performance/me/sql"
        )

    async def ask_semantic_layer(
        self,
        query: str,
        title: str | None = None,
        chart_type: Literal["kpi", "pie", "bar", "line"] | None = None,
    ) -> dict[str, Any]:
        context = get_tool_context()
        surface = "unknown"
        try:
            surface = get_trusted_context().surface
        except RuntimeError:
            pass

        if not semantic_layer_configured():
            result = {
                "ok": False,
                "source": "semantic_layer",
                "fallback": "sql_analytics",
                "reason": "Semantic layer URL is not configured.",
            }
            return await self._finish_semantic_result(
                result,
                query=query,
                surface=surface,
                tenant_id=context.tenant_id,
            )

        enriched_query = enrich_query_with_period(
            query,
            period_range=context.period_range,
            period_start=context.period_start,
            period_end=context.period_end,
        )
        raw = await ask_semantic_layer_gateway(
            enriched_query,
            tenant_id=context.tenant_id,
            surface=surface,
            period_start=context.period_start,
            period_end=context.period_end,
            period_range=context.period_range,
        )
        if isinstance(raw, dict) and raw.get("ok") is False and raw.get("source") == "semantic_layer":
            return await self._finish_semantic_result(
                raw,
                query=query,
                enriched_query=enriched_query,
                surface=surface,
                tenant_id=context.tenant_id,
                raw=raw,
            )
        result = interpret_semantic_response(
            raw,
            query=enriched_query,
            title=title,
            chart_type=chart_type,
        )
        if result.get("ok"):
            grounded = await self._ground_semantic_to_reports(
                result,
                chart_type=chart_type,
            )
            if grounded:
                result = grounded
            row_sources: list[Any] = [result]
            extra_plots = result.get("plots")
            if isinstance(extra_plots, list):
                row_sources.extend(extra_plots)
            for source in row_sources:
                if not isinstance(source, dict):
                    continue
                for row in source.get("rows", [])[:200]:
                    if isinstance(row, dict):
                        context.recent_tool_data.append(row)
                for point in source.get("data", [])[:200]:
                    if isinstance(point, dict):
                        context.recent_tool_data.append(point)
            for metric in result.get("metrics", [])[:50]:
                if isinstance(metric, dict):
                    for row in metric.get("rows", [])[:200]:
                        if isinstance(row, dict):
                            context.recent_tool_data.append(row)
            result["period"] = {
                "range": context.period_range,
                "start": context.period_start,
                "end": context.period_end,
            }
            result["query"] = enriched_query
        return await self._finish_semantic_result(
            result,
            query=query,
            enriched_query=enriched_query,
            surface=surface,
            tenant_id=context.tenant_id,
            raw=raw if isinstance(raw, dict) else None,
        )

    async def ask_ontology_layer(
        self,
        query: str,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        context = get_tool_context()
        surface = "unknown"
        role = "admin"
        try:
            trusted = get_trusted_context()
            surface = trusted.surface
            role = trusted.role
        except RuntimeError:
            pass

        if surface != "dashboard":
            return {
                "ok": False,
                "source": "ontology_layer",
                "reason": "Ontology layer is only available on the admin dashboard.",
            }
        if role != "admin":
            return {
                "ok": False,
                "source": "ontology_layer",
                "reason": "Ontology layer is only available to admin users.",
            }
        if not ontology_layer_configured():
            return {
                "ok": False,
                "source": "ontology_layer",
                "reason": "Ontology layer URL is not configured.",
            }

        return await ask_ontology_layer_gateway(
            query,
            organization_id=context.tenant_id,
            session_id=session_id or "",
            surface=surface,
        )

    async def _ground_semantic_to_reports(
        self,
        result: dict[str, Any],
        *,
        chart_type: Literal["kpi", "pie", "bar", "line"] | None = None,
    ) -> dict[str, Any] | None:
        metric_id = semantic_reports_kpi_id(result, chart_type=chart_type)
        if metric_id is None:
            return None
        try:
            grounded = await self.generate_performance_report(
                variant="kpi",
                skill_id="performance-analytics",
                metric_ids=[metric_id],
                chart_type="kpi",
            )
        except Exception:
            return None
        if not isinstance(grounded, dict):
            return None
        if not (grounded.get("kpis") or grounded.get("data") or grounded.get("type")):
            return None
        grounded = dict(grounded)
        grounded["replacedSemantic"] = True
        grounded["groundedToReports"] = True
        grounded["source"] = "performance_overview"
        return grounded

    async def sql_analytics(
        self,
        query_description: str,
        sql_query: str,
        presentation: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        context = get_tool_context()
        try:
            validated = self._validate_sql(sql_query)
        except ValueError as error:
            return self._sql_error(query_description, sql_query, str(error), "validate")
        try:
            response = await self.http.request(
                "POST",
                self._analytics_sql_path(),
                context,
                json_body={"sql": validated, "description": query_description},
            )
        except Exception as error:
            return self._sql_error(query_description, validated, str(error), "execute")
        rows = response.get("rows", []) if isinstance(response, dict) else []
        for row in rows[:200]:
            if isinstance(row, dict):
                context.recent_tool_data.append(row)
        result = {
            "ok": True,
            "query_description": query_description,
            "sql_query": validated,
            "rowCount": response.get("rowCount", 0),
            "columns": response.get("columns", []),
            "rows": rows,
            "period": {
                "range": context.period_range,
                "start": context.period_start,
                "end": context.period_end,
            },
        }
        if not presentation:
            return result
        points = await self._build_plot_points(rows, presentation, context)
        if not points:
            return {**result, "presentation_error": "No rows matched the presentation mapping."}
        chart_type = str(presentation.get("chart_type") or "kpi")
        return {
            "type": "plot",
            "title": str(presentation.get("title") or query_description),
            "chartType": chart_type,
            "description": str(presentation.get("description") or query_description),
            "data": points,
            "kpis": points if chart_type == "kpi" else [],
            "grounded": True,
            "query_description": query_description,
            "period": result["period"],
        }

    async def generate_plot(
        self,
        title: str,
        chart_type: Literal["line", "bar", "pie", "kpi"],
        data: list[dict[str, Any]],
        description: str | None = None,
        kpis: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        context = get_tool_context()
        if not title.strip():
            raise ValueError("Plot title is required.")
        if not data and not (chart_type == "kpi" and kpis):
            raise ValueError(f"{chart_type} plots require data.")
        normalized_data: list[dict[str, Any]] = []
        for index, point in enumerate(data):
            if not isinstance(point, dict):
                raise ValueError(f"data[{index}] must include a label and value.")
            item = _normalize_generated_point(point)
            has_label = item.get("label") not in (None, "")
            has_value = item.get("value") is not None
            if not has_label or not has_value:
                raise ValueError(f"data[{index}] must include a label and value.")
            normalized_data.append(item)
        data = normalized_data
        if not context.recent_tool_data:
            raise ValueError("Plot data must be grounded in prior analytics results.")
        context_text = f"{title} {description or ''}"
        formatted_kpis = [
            {
                **item,
                "value": self._format_plot_metric_value(
                    f"{context_text} {item.get('label') or ''}",
                    item.get("value"),
                ),
            }
            if isinstance(item, dict)
            else item
            for item in (kpis or [])
        ]
        formatted_data = data
        if chart_type == "kpi":
            formatted_data = [
                {
                    **point,
                    "value": self._format_plot_metric_value(
                        f"{context_text} {point.get('label') or point.get('name') or ''}",
                        point.get("value", point.get("y", point.get("count", point.get("handled")))),
                    ),
                }
                for point in data
            ]
            if not formatted_kpis:
                formatted_kpis = [
                    {"label": str(point.get("label") or point.get("name") or title), "value": point.get("value")}
                    for point in formatted_data
                ]
        return {
            "type": "plot",
            "title": title,
            "chartType": chart_type,
            "data": formatted_data,
            "description": description or "",
            "kpis": formatted_kpis,
            "grounded": True,
        }

    def _activate_knowledge(
        self,
        skill_id: str,
        metric_ids: list[PerformanceMetricId],
    ) -> None:
        context = get_tool_context()
        registry = get_skill_registry()
        skill = registry.get_skill(skill_id)
        if skill is not None:
            context.active_skills[skill_id] = skill
        pack = registry.get_metrics_pack(skill_id)
        requested = set(metric_ids)
        for metric in pack.get("metrics", []):
            if isinstance(metric, dict) and metric.get("id") in requested:
                context.active_metrics[str(metric["id"])] = metric

    def _format_kpi(self, key: str, value: Any) -> str:
        if value is None:
            return "—"
        if key in {"resolutionRate", "slaRate"} and isinstance(value, (int, float)):
            rounded = round(float(value), 1)
            return f"{int(rounded) if rounded.is_integer() else rounded}%"
        if key in {"avgFirstResponseSeconds", "avgHandleSeconds"} and isinstance(
            value, (int, float)
        ):
            return format_duration_seconds(float(value))
        return str(value)

    def _int_or_none(self, value: Any) -> int | None:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    def _kpi_card(self, key: str, kpis: dict[str, Any]) -> dict[str, Any]:
        card: dict[str, Any] = {
            "label": KPI_LABELS[key],
            "value": self._format_kpi(key, kpis.get(key)),
        }
        if key == "avgFirstResponseSeconds":
            sample_size = self._int_or_none(kpis.get("firstResponseCount"))
            if sample_size is not None:
                card["sampleSize"] = sample_size
            value = kpis.get(key)
            if value is None or sample_size == 0:
                card["value"] = "—"
                card["note"] = (
                    "Empty average: no conversations in this period have both assigned_at "
                    "and first_response_at. That is not proof of missing logging or a "
                    "recording failure. Live monitoring (missed, waiting, agent reached) "
                    "is not this metric."
                )
            elif isinstance(value, (int, float)) and int(round(float(value))) == 0:
                if (sample_size or 0) > 0:
                    card["note"] = (
                        f"Rounded to whole seconds from {sample_size} conversations with "
                        "assignment and first reply. A 0s average means the mean gap was "
                        "under 0.5 seconds, not that timestamps are missing or incorrectly recorded."
                    )
                else:
                    card["note"] = (
                        "A 0s first-response average is either no qualifying sample or a "
                        "rounded mean under 0.5 seconds. Do not claim timestamps are missing "
                        "or incorrectly recorded without a sample count."
                    )
        elif key == "slaRate":
            sample_size = self._int_or_none(kpis.get("firstResponseCount"))
            within = self._int_or_none(kpis.get("withinSlaCount"))
            if sample_size is not None:
                card["sampleSize"] = sample_size
            if within is not None:
                card["withinSlaCount"] = within
                if sample_size is not None:
                    card["missedSlaCount"] = max(0, sample_size - within)
            if sample_size == 0:
                card["value"] = "—"
                card["caption"] = "No first replies in period"
                card["note"] = (
                    "Empty First-Reply SLA: no conversations in this period have a first reply. "
                    "That is not a 0% miss rate and not proof of missing logging. "
                    "Do not invent staffing, presence, or queue causes from this card."
                )
            elif sample_size and within is not None:
                missed = max(0, sample_size - within)
                card["caption"] = f"{within} of {sample_size} first replies"
                card["canonicalLabel"] = KPI_LABELS["slaRate"]
                card["note"] = (
                    f"{within} of {sample_size} first replies were within 60 seconds of assignment "
                    f"({missed} missed). This is the same First-Reply SLA as the Reports panel. "
                    "Use composition and slaBreakdown in this tool result for who missed. "
                    "Do not invent causes and do not quote a different SLA from another tool."
                )
        elif key == "resolutionRate":
            resolved = self._int_or_none(kpis.get("resolved"))
            handled = self._int_or_none(kpis.get("handled"))
            if resolved is not None:
                card["resolvedCount"] = resolved
            if handled is not None:
                card["handledCount"] = handled
            if resolved is not None and handled is not None:
                card["caption"] = f"{resolved} of {handled} handled"
                card["note"] = (
                    f"{resolved} of {handled} handled conversations have resolved_at. "
                    "The percent is resolvedCount / handledCount. "
                    "How many were resolved uses resolvedCount. "
                    "Why the rate is this percent quotes resolvedCount of handledCount. "
                    "Do not answer either question with the percent alone. "
                    "Do not invent why the rest are unresolved."
                )
        elif key == "avgHandleSeconds" and kpis.get(key) is None:
            card["note"] = (
                "Empty average: no conversations in this period have both assigned_at "
                "and an end timestamp (resolved_at or ended_at). That is not proof of "
                "missing logging."
            )
        return card

    def _format_plot_metric_value(
        self,
        label: str,
        value: Any,
        *,
        unit: str = "",
    ) -> Any:
        if value is None:
            return value
        if isinstance(value, str) and _DISPLAY_UNIT_RE.search(value.strip()):
            return value
        if not _DURATION_HINT_RE.search(label):
            return value
        try:
            number = float(value)
        except (TypeError, ValueError):
            return value
        seconds = number * 60 if unit and _MINUTES_HINT_RE.search(unit) else number
        if not unit and _MINUTES_HINT_RE.search(label) and not re.search(r"second", label, re.I):
            if 0 < number < 1000:
                seconds = number * 60
        return format_duration_seconds(seconds)

    async def _finish_semantic_result(
        self,
        result: dict[str, Any],
        *,
        query: str,
        surface: str,
        tenant_id: str | None,
        enriched_query: str | None = None,
        raw: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        adapted = result
        log_semantic_layer_call(
            event="semantic_layer_tool_result",
            tenant_id=tenant_id,
            query=query,
            enriched_query=enriched_query,
            surface=surface,
            raw=raw,
            adapted=adapted,
        )
        return adapted

    def _channel_filter(self, focus: list[str] | None) -> str | None:
        names = self._channel_filters(focus)
        return names[0] if names else None

    def _channel_filters(self, focus: list[str] | None) -> list[str]:
        names: list[str] = []
        for item in focus or []:
            key = str(item).strip().lower()
            if key in CHANNEL_DISPLAY and key not in names:
                names.append(key)
        return names

    def _handler_filters(self, focus: list[str] | None) -> list[str]:
        names: list[str] = []
        for item in focus or []:
            key = str(item).strip().lower().replace(" ", "_").replace("-", "_")
            mapped = HANDLER_FOCUS.get(key)
            if mapped and mapped not in names:
                names.append(mapped)
        return names

    def _calendar_days(self, params: dict[str, Any], overview: dict[str, Any]) -> int:
        daily = [
            row for row in overview.get("daily") or [] if isinstance(row, dict)
        ]
        if daily:
            return max(1, len(daily))
        period = overview.get("period") if isinstance(overview.get("period"), dict) else {}
        # Prefer the inclusive request window. Reports period.end is exclusive
        # (00:00 UTC the day after the last included day).
        start = str(params.get("start") or period.get("start") or "")[:10]
        end = str(params.get("end") or period.get("end") or "")[:10]
        try:
            first = date.fromisoformat(start)
            last = date.fromisoformat(end)
            return max(1, (last - first).days + 1)
        except ValueError:
            return 1

    def _format_per_day(self, total: float, days: int) -> str:
        avg = total / max(1, days)
        rounded = round(avg, 2)
        if rounded == int(rounded):
            return str(int(rounded))
        text = f"{rounded:.2f}".rstrip("0").rstrip(".")
        return text

    def _reports_daily_avg(self, overview: dict[str, Any]) -> int:
        kpis = overview.get("kpis") if isinstance(overview.get("kpis"), dict) else {}
        try:
            handled = float(kpis.get("handled") or 0)
        except (TypeError, ValueError):
            handled = 0
        days_with_volume = 0
        for row in overview.get("daily") or []:
            if not isinstance(row, dict):
                continue
            try:
                if float(row.get("handled") or 0) > 0:
                    days_with_volume += 1
            except (TypeError, ValueError):
                continue
        if days_with_volume <= 0:
            return 0
        return int(round(handled / days_with_volume))

    def _peak_card(self, overview: dict[str, Any]) -> dict[str, Any] | None:
        peak_value = -1
        peak_label = ""
        for row in overview.get("daily") or []:
            if not isinstance(row, dict):
                continue
            try:
                handled = float(row.get("handled") or 0)
            except (TypeError, ValueError):
                continue
            if handled > peak_value:
                peak_value = handled
                peak_label = self._format_day_label(row.get("date") or row.get("day"))
        if peak_value < 0:
            return None
        return {"label": f"Peak · {peak_label}" if peak_label else "Peak day", "value": int(peak_value)}

    def _disposition_cards(
        self,
        overview: dict[str, Any],
        wanted: list[str],
    ) -> list[dict[str, Any]]:
        cards: list[dict[str, Any]] = []
        rows = [
            row
            for row in overview.get("dispositions") or []
            if isinstance(row, dict)
        ]
        for name in wanted:
            needle = name.lower().replace("_", " ")
            match = next(
                (
                    row
                    for row in rows
                    if needle in str(row.get("label") or "").lower()
                ),
                None,
            )
            if match is None:
                continue
            cards.append(
                {
                    "label": str(match.get("label") or name),
                    "value": int(match.get("value") or 0),
                }
            )
        return cards

    def _append_derived_cards(
        self,
        cards: list[dict[str, Any]],
        overview: dict[str, Any],
        params: dict[str, Any],
        focus: list[str] | None,
        *,
        channel_total: int | None = None,
    ) -> list[dict[str, Any]]:
        keys = {str(item).strip().lower() for item in focus or []}
        next_cards = list(cards)
        if "daily_avg" in keys:
            if channel_total is not None:
                next_cards.append(
                    {
                        "label": "Daily average",
                        "value": self._format_per_day(
                            channel_total,
                            self._calendar_days(params, overview),
                        ),
                    }
                )
            else:
                next_cards.append(
                    {
                        "label": "Daily avg handled",
                        "value": self._reports_daily_avg(overview),
                    }
                )
        if "peak_day" in keys:
            peak = self._peak_card(overview)
            if peak:
                next_cards.append(peak)
        return next_cards

    def _aggregate_channels(self, channels: list[Any]) -> list[dict[str, Any]]:
        totals: dict[str, float] = {}
        for row in channels:
            if not isinstance(row, dict):
                continue
            key = str(row.get("channel") or row.get("label") or "").strip().lower()
            if " · " in key:
                key = key.split(" · ", 1)[0].strip()
            if not key:
                continue
            try:
                totals[key] = totals.get(key, 0) + float(row.get("value") or 0)
            except (TypeError, ValueError):
                continue
        return [
            {"label": CHANNEL_DISPLAY.get(key, key), "value": int(value), "channel": key}
            for key, value in sorted(totals.items(), key=lambda item: -item[1])
        ]

    def _channel_handler_points(self, channels: list[Any]) -> list[dict[str, Any]]:
        points: list[dict[str, Any]] = []
        for row in channels:
            if not isinstance(row, dict):
                continue
            channel_key = str(row.get("channel") or "").strip().lower()
            label_text = str(row.get("label") or "").strip()
            if not channel_key and " · " in label_text:
                channel_key = label_text.split(" · ", 1)[0].strip().lower()
            if not channel_key:
                channel_key = label_text.lower()
            if not channel_key:
                continue
            handler = str(row.get("handler") or "").strip().lower()
            handler_label = "AI" if handler == "ai" else "Agent" if handler == "agent" else (
                handler.title() if handler else ""
            )
            channel_label = CHANNEL_DISPLAY.get(channel_key, channel_key)
            label = label_text if " · " in label_text else (
                f"{channel_label} · {handler_label}" if handler_label else channel_label
            )
            try:
                value = int(float(row.get("value") or 0))
            except (TypeError, ValueError):
                continue
            points.append(
                {
                    "label": label,
                    "value": value,
                    "channel": channel_key,
                    "handler": handler or None,
                }
            )
        return sorted(points, key=lambda item: -int(item["value"]))

    def _sla_miss_phrases(self, overview: dict[str, Any]) -> list[str]:
        phrases: list[str] = []
        for row in overview.get("slaBreakdown") or []:
            if not isinstance(row, dict):
                continue
            try:
                missed = int(row.get("missedSlaCount") or 0)
            except (TypeError, ValueError):
                continue
            if missed <= 0:
                continue
            channel_key = str(row.get("channel") or "unknown").strip().lower()
            channel_label = CHANNEL_DISPLAY.get(channel_key, channel_key or "Unknown")
            handler = str(row.get("handler") or "").strip().lower()
            handler_label = "AI" if handler == "ai" else "Agent" if handler == "agent" else ""
            label = f"{channel_label} · {handler_label}" if handler_label else channel_label
            phrases.append(f"{label}: {missed}")
        return phrases

    def _sla_composition_text(self, overview: dict[str, Any]) -> str | None:
        kpis = overview.get("kpis") if isinstance(overview.get("kpis"), dict) else {}
        sample_size = self._int_or_none(kpis.get("firstResponseCount"))
        within = self._int_or_none(kpis.get("withinSlaCount"))
        if not sample_size:
            return (
                "Empty First-Reply SLA: no conversations in this period have a first reply. "
                "Do not invent staffing, presence, or queue causes."
            )
        if within is None:
            return None
        missed = max(0, sample_size - within)
        parts = [
            f"{within} of {sample_size} first replies were within 60 seconds of assignment "
            f"({missed} missed). This is the same First-Reply SLA as the Reports panel."
        ]
        misses = self._sla_miss_phrases(overview)
        if misses:
            parts.append("Misses: " + "; ".join(misses) + ".")
        elif missed > 0:
            parts.append(
                "Channel and handler slices were not returned; do not invent who missed."
            )
        else:
            parts.append("No channel or handler slice missed the 60-second window.")
        parts.append("Do not invent causes and do not quote a different SLA from another tool.")
        return " ".join(parts)

    def _with_answer_rule(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Instruction for the model. The chart card does not render this field."""
        payload["answerRule"] = (
            "State only the numbers in this result. Do not add a cause. "
            "Do not say the organization went live, that calls were longer or more complex, "
            "that the day is partial, or that dispositions disagree with the resolved count. "
            "Do not include an img tag. The chart card is already the picture."
        )
        return payload

    def _with_sla_breakdown(
        self,
        plot: dict[str, Any],
        overview: dict[str, Any],
    ) -> dict[str, Any]:
        breakdown = overview.get("slaBreakdown")
        if isinstance(breakdown, list) and breakdown:
            plot["slaBreakdown"] = breakdown
        composition = self._sla_composition_text(overview)
        if not composition:
            return plot
        sla_visible = "sla" in str(plot.get("title") or "").casefold()
        for card in plot.get("kpis") or []:
            if isinstance(card, dict) and "sla" in str(card.get("label") or "").casefold():
                sla_visible = True
                break
        if not sla_visible:
            return plot
        plot["composition"] = composition
        plot["note"] = composition
        for card in plot.get("kpis") or []:
            if not isinstance(card, dict):
                continue
            if "sla" not in str(card.get("label") or "").casefold():
                continue
            card["note"] = composition
        return plot

    def _format_day_label(self, value: Any) -> str:
        text = str(value or "").strip()
        match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", text)
        if not match:
            return text or "Unknown"
        months = (
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sept",
            "Oct",
            "Nov",
            "Dec",
        )
        return f"{int(match.group(3))} {months[int(match.group(2)) - 1]}"

    def _period_caption(self, overview: dict[str, Any], params: dict[str, Any]) -> str:
        period = overview.get("period") if isinstance(overview.get("period"), dict) else {}
        start = str(period.get("start") or params.get("start") or "")[:10]
        end = str(period.get("end") or params.get("end") or "")[:10]
        if start and end:
            if start == end:
                return start
            return f"{start} to {end}"
        return str(overview.get("range") or params.get("range") or "selected period")

    def _plot_from_overview(
        self,
        overview: dict[str, Any],
        *,
        metric_ids: list[PerformanceMetricId],
        chart_type: Literal["kpi", "pie", "bar", "line"],
        focus: list[str] | None,
        title: str | None,
        params: dict[str, Any],
    ) -> dict[str, Any] | None:
        caption = self._period_caption(overview, params)
        channel_filters = self._channel_filters(focus)
        disposition_wanted = [
            str(item)
            for item in focus or []
            if any(
                name in str(item).lower()
                for name in ("issue resolved", "follow-up", "disconnected")
            )
        ]
        if "disposition_mix" in metric_ids and disposition_wanted and chart_type == "kpi":
            cards = self._disposition_cards(overview, disposition_wanted)
            if not cards:
                return None
            return {
                "type": "plot",
                "title": title or "Disposition comparison",
                "chartType": "kpi",
                "description": f"Disposition counts for {caption}.",
                "data": cards,
                "kpis": cards,
                "period": overview.get("period", {}),
                "range": overview.get("range") or params.get("range") or "custom",
                "grounded": True,
            }
        if "response_sla_60s" in metric_ids and chart_type in {"bar", "pie"}:
            miss_points: list[dict[str, Any]] = []
            for row in overview.get("slaBreakdown") or []:
                if not isinstance(row, dict):
                    continue
                try:
                    missed = int(row.get("missedSlaCount") or 0)
                except (TypeError, ValueError):
                    continue
                if missed <= 0:
                    continue
                channel_key = str(row.get("channel") or "unknown").strip().lower()
                channel_label = CHANNEL_DISPLAY.get(channel_key, channel_key or "Unknown")
                handler = str(row.get("handler") or "").strip().lower()
                handler_label = "AI" if handler == "ai" else "Agent" if handler == "agent" else ""
                label = f"{channel_label} · {handler_label}" if handler_label else channel_label
                miss_points.append({"label": label, "value": missed})
            if miss_points:
                return self._with_sla_breakdown(
                    {
                        "type": "plot",
                        "title": title or "First-Reply SLA misses",
                        "chartType": "bar",
                        "description": (
                            f"First replies that missed the 60-second window for {caption}."
                        ),
                        "data": miss_points,
                        "kpis": [],
                        "period": overview.get("period", {}),
                        "range": overview.get("range") or params.get("range") or "custom",
                        "grounded": True,
                    },
                    overview,
                )
        if ("channel_mix" in metric_ids or channel_filters) and chart_type != "line":
            raw_channels = list(overview.get("channels") or [])
            handler_filters = self._handler_filters(focus)
            has_handler_rows = any(
                isinstance(row, dict) and str(row.get("handler") or "").strip()
                for row in raw_channels
            )
            handler_title: str | None = None
            if has_handler_rows and len(handler_filters) == 1:
                handler = handler_filters[0]
                raw_channels = [
                    row
                    for row in raw_channels
                    if isinstance(row, dict)
                    and str(row.get("handler") or "").strip().lower() == handler
                ]
                handler_title = (
                    "AI Channel Mix" if handler == "ai" else "Support Agent Channel Mix"
                )
            elif has_handler_rows and len(handler_filters) >= 2:
                points = self._channel_handler_points(raw_channels)
                if not points:
                    return None
                return {
                    "type": "plot",
                    "title": prefer_canonical_title(
                        title,
                        "AI vs support agent channel mix",
                    ),
                    "chartType": "bar" if chart_type == "bar" else "pie",
                    "description": (
                        f"AI-handled versus support-agent volume by channel for {caption}."
                    ),
                    "data": points,
                    "kpis": [],
                    "canonicalNames": ["AI channel mix", "support agent channel mix"],
                    "period": overview.get("period", {}),
                    "range": overview.get("range") or params.get("range") or "custom",
                    "grounded": True,
                }
            points = self._aggregate_channels(raw_channels)
            if channel_filters:
                cards: list[dict[str, Any]] = []
                channel_total = 0
                for channel_filter in channel_filters:
                    total = int(
                        sum(
                            float(point["value"])
                            for point in points
                            if point.get("channel") == channel_filter
                        )
                    )
                    channel_total += total
                    label = CHANNEL_DISPLAY.get(channel_filter, channel_filter)
                    cards.append({"label": f"{label} conversations", "value": total})
                avg_total = channel_total if len(channel_filters) == 1 else None
                cards = self._append_derived_cards(
                    cards,
                    overview,
                    params,
                    focus,
                    channel_total=avg_total,
                )
                label = CHANNEL_DISPLAY.get(channel_filters[0], channel_filters[0])
                return {
                    "type": "plot",
                    "title": title or (f"{label} volume" if len(channel_filters) == 1 else "Channel volume"),
                    "chartType": "kpi",
                    "description": f"Channel conversations for {caption}.",
                    "data": cards,
                    "kpis": cards,
                    "period": overview.get("period", {}),
                    "range": overview.get("range") or params.get("range") or "custom",
                    "grounded": True,
                }
            if not points:
                return None
            mix_title = prefer_canonical_title(title, handler_title or "Channel Mix")
            if handler_filters == ["ai"]:
                mix_description = f"AI-handled conversation volume by channel for {caption}."
                canonical_names = ["AI channel mix"]
            elif handler_filters == ["agent"]:
                mix_description = (
                    f"Support-agent conversation volume by channel for {caption}."
                )
                canonical_names = ["support agent channel mix"]
            else:
                mix_description = f"Distribution of conversations by channel for {caption}."
                canonical_names = ["channel mix", "AI channel mix", "support agent channel mix"]
            return {
                "type": "plot",
                "title": mix_title,
                "chartType": "bar" if chart_type == "bar" else "pie",
                "description": mix_description,
                "data": points,
                "kpis": [],
                "canonicalNames": canonical_names,
                "period": overview.get("period", {}),
                "range": overview.get("range") or params.get("range") or "custom",
                "grounded": True,
            }
        if "disposition_mix" in metric_ids and chart_type != "line":
            points = [
                {"label": str(row.get("label") or "Unknown"), "value": int(row.get("value") or 0)}
                for row in overview.get("dispositions") or []
                if isinstance(row, dict)
            ]
            if not points:
                return None
            return {
                "type": "plot",
                "title": title or "Disposition Breakdown",
                "chartType": "pie" if chart_type == "pie" else "bar",
                "description": f"How conversations were closed for {caption}.",
                "data": points,
                "kpis": [],
                "period": overview.get("period", {}),
                "range": overview.get("range") or params.get("range") or "custom",
                "grounded": True,
            }
        if "daily_handled_trend" in metric_ids or chart_type == "line":
            field = "avgHandleSeconds" if "avg_handle_time" in metric_ids else "handled"
            points: list[dict[str, Any]] = []
            for row in overview.get("daily") or []:
                if not isinstance(row, dict):
                    continue
                raw = row.get(field)
                try:
                    number = float(raw or 0)
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(number):
                    number = 0
                points.append(
                    {
                        "label": self._format_day_label(row.get("date") or row.get("day")),
                        "value": int(round(number)),
                    }
                )
            if not points:
                return None
            is_aht = field == "avgHandleSeconds"
            return {
                "type": "plot",
                "title": title
                or ("Daily Handle-Time Trend" if is_aht else "Daily Handled Trend"),
                "chartType": "line",
                "description": (
                    f"Handle time by day for {caption}."
                    if is_aht
                    else f"Conversations handled per day for {caption}."
                ),
                "data": points,
                "kpis": [],
                "period": overview.get("period", {}),
                "range": overview.get("range") or params.get("range") or "custom",
                "grounded": True,
            }
        return None

    def _focus_keys(
        self,
        focus: list[str] | None,
        metric_ids: list[PerformanceMetricId],
    ) -> list[str]:
        keys: list[str] = []
        for item in list(focus or []) + list(metric_ids):
            key = FOCUS_ALIASES.get(str(item).strip().lower().replace(" ", "_"))
            if key and key not in keys:
                keys.append(key)
        return keys

    async def generate_performance_report(
        self,
        variant: Literal["kpi", "report"],
        skill_id: Literal["performance-analytics"],
        metric_ids: list[PerformanceMetricId],
        range: Annotated[
            Literal["7d", "30d", "90d"] | None,
            Field(
                description=(
                    "Page preset only: 7d, 30d, or 90d. Omit when the user names any other "
                    "window and pass start and end instead."
                )
            ),
        ] = None,
        start: Annotated[
            str | None,
            Field(
                description=(
                    "Inclusive start date YYYY-MM-DD, computed from Today in the system prompt. "
                    "Required for a named period such as the last two days. Omit range when set."
                )
            ),
        ] = None,
        end: Annotated[
            str | None,
            Field(
                description=(
                    "Inclusive end date YYYY-MM-DD, computed from Today in the system prompt. "
                    "Required together with start. Omit range when set."
                )
            ),
        ] = None,
        title: str | None = None,
        focus: list[str] | None = None,
        chart_type: Literal["kpi", "pie", "bar", "line"] | None = None,
    ) -> dict[str, Any]:
        context = get_tool_context()
        self._activate_knowledge(skill_id, metric_ids)
        effective_start = start or context.period_start
        effective_end = end or context.period_end
        effective_range = range or context.period_range or "30d"
        params = (
            {"start": effective_start, "end": effective_end}
            if effective_start and effective_end
            else {"range": effective_range}
        )
        overview = await self.http.request(
            "GET",
            self._analytics_overview_path(),
            context,
            params=params,
        )
        if not isinstance(overview, dict):
            overview = {}
        for value in [overview.get("kpis", {})]:
            if isinstance(value, dict):
                context.recent_tool_data.append(value)
        for key in ("daily", "channels", "dispositions", "slaBreakdown"):
            for row in overview.get(key, [])[:100]:
                if isinstance(row, dict):
                    context.recent_tool_data.append(row)
        range_label = str(overview.get("range") or params.get("range") or "custom")
        series_ids = {
            "channel_mix",
            "daily_handled_trend",
            "disposition_mix",
        }
        derived_focus = {str(item).strip().lower() for item in focus or []}
        wants_derived = bool(derived_focus & {"daily_avg", "peak_day"})
        wants_series = (
            chart_type in {"pie", "bar", "line"}
            or bool(series_ids.intersection(metric_ids))
            or bool(self._channel_filters(focus))
            or bool(self._handler_filters(focus))
        )
        if wants_series:
            plot = self._plot_from_overview(
                overview,
                metric_ids=metric_ids,
                chart_type=chart_type or "kpi",
                focus=focus,
                title=title,
                params=params,
            )
            if plot:
                return self._with_answer_rule(plot)
        focus_keys = self._focus_keys(focus, metric_ids)
        selected = [key for key in focus_keys if key in KPI_LABELS]
        if variant == "kpi" or selected or wants_derived:
            if not selected and not wants_derived:
                selected = list(KPI_LABELS)
            kpis = overview.get("kpis", {}) if isinstance(overview.get("kpis"), dict) else {}
            cards = [
                self._kpi_card(key, kpis)
                for key in selected
                if key in KPI_LABELS
            ]
            cards = self._append_derived_cards(cards, overview, params, focus)
            caption = self._period_caption(overview, params)
            if len(selected) == 1:
                canonical = KPI_LABELS[selected[0]]
                heading = (
                    canonical
                    if selected[0] == "slaRate"
                    else prefer_canonical_title(title, canonical)
                )
            elif title:
                heading = title
            else:
                heading = "Performance KPIs"
            return self._with_answer_rule(
                self._with_sla_breakdown(
                    {
                        "type": "plot",
                        "title": heading,
                        "chartType": "kpi",
                        "description": f"Key metrics for {caption}.",
                        "data": cards,
                        "kpis": cards,
                        "period": overview.get("period", {}),
                        "range": range_label,
                        "grounded": True,
                    },
                    overview,
                )
            )
        return self._with_answer_rule(
            {
                "type": "performance_report",
                "title": title or f"Performance Report — {range_label.upper()}",
                "range": range_label,
                "period": overview.get("period", {}),
                "kpis": overview.get("kpis", {}),
                "daily": overview.get("daily", []),
                "channels": overview.get("channels", []),
                "dispositions": overview.get("dispositions", []),
                "slaBreakdown": overview.get("slaBreakdown") or [],
                "recent": overview.get("recent", []),
            }
        )

    def _snapshot_query_params(self, context: Any) -> dict[str, str]:
        params: dict[str, str] = {}
        if context.period_start and context.period_end:
            params["start"] = str(context.period_start)
            params["end"] = str(context.period_end)
        elif context.period_range:
            params["range"] = str(context.period_range)
        else:
            params["range"] = "7d"
        incident_id = getattr(context, "incident_id", None)
        if incident_id:
            params["incidentId"] = str(incident_id)
        return params

    async def _fetch_dashboard_analytics(self) -> dict[str, Any]:
        context = get_tool_context()
        payload = await self.http.request(
            "GET",
            "/api/v1/dashboard/analytics",
            context,
            params=self._snapshot_query_params(context),
        )
        return payload if isinstance(payload, dict) else {}

    @staticmethod
    def _rate_label(value: Any) -> str:
        if value is None:
            return "—"
        try:
            return f"{float(value):.1f}%"
        except (TypeError, ValueError):
            return str(value)

    @staticmethod
    def _count_label(value: Any) -> str:
        try:
            return str(int(value))
        except (TypeError, ValueError):
            return "0"

    def _selected_incident(
        self,
        payload: dict[str, Any],
        incident_id: str | None,
    ) -> dict[str, Any] | None:
        diagnostic = payload.get("diagnostic") if isinstance(payload.get("diagnostic"), dict) else {}
        incidents = diagnostic.get("incidents") if isinstance(diagnostic.get("incidents"), list) else []
        selected_id = incident_id or diagnostic.get("selectedIncidentId")
        typed_incidents = [item for item in incidents if isinstance(item, dict)]
        for item in typed_incidents:
            if str(item.get("id") or "") == str(selected_id or ""):
                return item
        return typed_incidents[0] if typed_incidents else None

    def _incident_kpis(self, incident: dict[str, Any] | None) -> list[dict[str, Any]]:
        facts = incident.get("currentFacts") if isinstance(incident, dict) else None
        if not isinstance(facts, dict):
            return []
        unique = facts.get("uniqueMissedConversations")
        demand = facts.get("agentDemandConversations")
        rate = facts.get("missedContactRate")
        events = facts.get("missedEventCount")
        note = (
            f"{self._count_label(unique)} unique missed / {self._count_label(demand)} agent-demand "
            "conversations. Rates above 100% are valid."
        )
        return [
            {
                "label": "Missed-contact rate",
                "value": self._rate_label(rate),
                "note": note,
            },
            {
                "label": "Unique missed",
                "value": self._count_label(unique),
                "caption": "Distinct conversations that missed at least once",
            },
            {
                "label": "Agent demand",
                "value": self._count_label(demand),
                "caption": "Queued conversations in the same window",
            },
            {
                "label": "Missed events",
                "value": self._count_label(events),
                "caption": "Rows in agent missed contacts",
            },
        ]

    async def get_dashboard_analytics_snapshot(self) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if context.role != "admin":
                return {
                    "ok": False,
                    "reason": "Admin Analytics is available to supervisors and admins only.",
                }
            payload = await self._fetch_dashboard_analytics()
            diagnostic = (
                payload.get("diagnostic") if isinstance(payload.get("diagnostic"), dict) else {}
            )
            predictive = (
                payload.get("predictive") if isinstance(payload.get("predictive"), dict) else {}
            )
            prescriptive = (
                payload.get("prescriptive") if isinstance(payload.get("prescriptive"), dict) else {}
            )
            meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
            selected = self._selected_incident(payload, getattr(context, "incident_id", None))
            weekly = diagnostic.get("weeklyComparison")
            facts = selected.get("currentFacts") if isinstance(selected, dict) else None
            if isinstance(facts, dict):
                context.recent_tool_data.append(facts)
            if isinstance(weekly, dict):
                context.recent_tool_data.append(weekly)
            factors = selected.get("factors") if isinstance(selected, dict) else []
            factor_points = [
                {"label": str(item.get("label") or "Unknown"), "value": float(item.get("value") or 0)}
                for item in factors
                if isinstance(item, dict)
            ]
            kpis = self._incident_kpis(selected)
            weekly_this = weekly.get("thisWeek") if isinstance(weekly, dict) else {}
            weekly_last = weekly.get("lastWeek") if isinstance(weekly, dict) else {}
            if not kpis and isinstance(weekly_this, dict):
                kpis = [
                    {
                        "label": "This week rate",
                        "value": self._rate_label(weekly_this.get("missedContactRate")),
                        "note": MISSED_CONTACT_RATE_CONTRACT["interpretation"],
                    },
                    {
                        "label": "Last week rate",
                        "value": self._rate_label(
                            weekly_last.get("missedContactRate") if isinstance(weekly_last, dict) else None
                        ),
                    },
                ]
            plot: dict[str, Any] = {
                "ok": True,
                "title": (
                    str(selected.get("headline") or "Analytics snapshot")
                    if isinstance(selected, dict)
                    else "Analytics snapshot"
                ),
                "chartType": "bar" if factor_points else "kpi",
                "description": (
                    str(selected.get("summary") or "")
                    if isinstance(selected, dict)
                    else "No active diagnostic incident. Use weekly comparison and forecasts from this snapshot."
                ),
                "data": factor_points or kpis,
                "kpis": kpis,
                "grounded": True,
                "metricContract": {
                    "missedContactRate": MISSED_CONTACT_RATE_CONTRACT,
                },
                "incidentCatalog": ANALYTICS_INCIDENT_CATALOG,
                "selectedIncident": selected,
                "weeklyComparison": weekly,
                "predictiveSummary": predictive.get("summary") if isinstance(predictive, dict) else {},
                "hourlyVolume": predictive.get("hourlyVolume") if isinstance(predictive, dict) else {},
                "recommendations": (
                    prescriptive.get("recommendations") if isinstance(prescriptive, dict) else []
                ),
                "healthy": bool(diagnostic.get("healthy")),
                "dataStatus": meta.get("dataStatus"),
                "period": payload.get("period"),
            }
            return plot

        return await execute_once("get_dashboard_analytics_snapshot", {}, operation)

    async def get_analytics_hourly_volume(self) -> dict[str, Any]:
        async def operation() -> dict[str, Any]:
            context = get_tool_context()
            if context.role != "admin":
                return {
                    "ok": False,
                    "reason": "Admin Analytics is available to supervisors and admins only.",
                }
            payload = await self._fetch_dashboard_analytics()
            predictive = (
                payload.get("predictive") if isinstance(payload.get("predictive"), dict) else {}
            )
            hourly = (
                predictive.get("hourlyVolume") if isinstance(predictive.get("hourlyVolume"), dict) else {}
            )
            points = hourly.get("points") if isinstance(hourly.get("points"), list) else []
            plot_points: list[dict[str, Any]] = []
            for row in points:
                if not isinstance(row, dict):
                    continue
                label = str(row.get("label") or "").strip()
                if not label:
                    continue
                item: dict[str, Any] = {"label": label}
                if row.get("actual") is not None:
                    item["actual"] = float(row["actual"])
                if row.get("forecast") is not None:
                    item["forecast"] = float(row["forecast"])
                if "actual" not in item and "forecast" not in item:
                    continue
                plot_points.append(item)
            if not plot_points:
                return {
                    "ok": False,
                    "reason": "Hourly volume evidence is not available yet.",
                    "hourlyVolume": hourly,
                }
            for point in plot_points:
                context.recent_tool_data.append(point)
            peak_hour = hourly.get("peakHour") or (predictive.get("summary") or {}).get("peakHour")
            observed_peak = hourly.get("observedPeakHour")
            time_zone = hourly.get("timeZone") or "Asia/Kolkata"
            description = (
                f"Last 7 days inbound by hour of day ({time_zone}). "
                f"Peak hour is {peak_hour}."
                if peak_hour
                else f"Last 7 days inbound by hour of day ({time_zone})."
            )
            if (
                peak_hour
                and observed_peak
                and observed_peak != peak_hour
            ):
                description += (
                    f" Last-7-day actuals peaked at {observed_peak}."
                )
            return {
                "ok": True,
                "type": "plot",
                "title": "Inbound volume by hour",
                "chartType": "line",
                "description": description,
                "xAxisLabel": "Hour of day",
                "yAxisLabel": "Inbound conversations",
                "peakHour": peak_hour,
                "data": plot_points,
                "kpis": [],
                "grounded": True,
                "peakHourEvidence": {
                    "peakHour": peak_hour,
                    "observedPeakHour": observed_peak,
                    "timeZone": time_zone,
                    "source": hourly.get("source"),
                    "supportingHours": hourly.get("supportingHours") or [],
                    "windowDays": hourly.get("windowDays"),
                },
                "hourlyVolume": hourly,
                "predictiveSummary": predictive.get("summary") if isinstance(predictive, dict) else {},
            }

        return await execute_once("get_analytics_hourly_volume", {}, operation)
