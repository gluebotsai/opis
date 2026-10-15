"""Semantic layer gateway client and row → plot/KPI adapter.

Standard gateway contract (POST {SEMANTIC_LAYER_URL}/ask):

Request::
    {"query": "...", "tenant_id": "...", "product": "aiccaas"}

Success response — JSON array of per-metric results::
    [
      {"ok": true, "metric_id": "total_conversations", "rows": [{"total_conversations": 48}]},
      {"ok": true, "metric_id": "missed_contact_rate", "rows": [{"missed_contact_rate": 0.58}]},
      {"ok": false, "metric_id": "total_transfers", "error": {"code": "NO_DATA", "message": "..."}}
    ]

Each ``rows`` entry uses cube-style keys (``conversation__channel``,
``conversation__created_at__day``) for dimensions and snake_case measures.
Rates are fractions in ``0..1``. Legacy single-object ``{"rows": [...]}`` responses
are still accepted.
"""

from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any, Literal

import httpx

from app.config import Settings, get_settings
from app.logging import get_logger

logger = get_logger("nlp.semantic_layer")

ChartType = Literal["kpi", "pie", "bar", "line"]

TIME_KEY_HINTS = ("__day", "__week", "__month", "__hour", "_at__", "metric_time")
CHANNEL_LABELS = {
    "webchat": "Web Chat",
    "whatsapp": "WhatsApp",
    "email": "Email",
    "voice": "Voice",
    "instagram": "Instagram",
    "facebook": "Facebook",
    "sms": "SMS",
}

RATE_KEY_RE = re.compile(r"(^|_)rate$|_rate$|_percentage$|_pct$", re.IGNORECASE)
ACRONYM_LABELS = {
    "sla": "SLA",
    "ai": "AI",
    "aht": "AHT",
    "kpi": "KPI",
    "sms": "SMS",
    "sql": "SQL",
}
MEASURE_KEY_HINTS = (
    "total",
    "count",
    "average",
    "avg",
    "unique",
    "sum",
    "rate",
    "handled",
    "seconds",
    "duration",
)


class SemanticLayerError(RuntimeError):
    """Safe semantic-layer error suitable for tool responses."""


def _summarize_raw_response(payload: Any) -> dict[str, Any]:
    if isinstance(payload, list):
        ok_count = sum(1 for item in payload if isinstance(item, dict) and item.get("ok"))
        return {
            "response_type": "metric_array",
            "metric_count": len(payload),
            "ok_count": ok_count,
            "metric_ids": [
                item.get("metric_id")
                for item in payload
                if isinstance(item, dict) and item.get("metric_id")
            ][:10],
        }
    if not isinstance(payload, dict):
        return {"response_type": "unknown", "value_type": type(payload).__name__}
    if "rows" in payload:
        rows = payload.get("rows")
        preview = rows[:5] if isinstance(rows, list) else rows
        return {
            "response_type": "rows",
            "row_count": len(rows) if isinstance(rows, list) else 0,
            "rows_preview": preview,
        }
    if "answer" in payload:
        return {
            "response_type": "answer",
            "answer_preview": str(payload.get("answer") or "")[:500],
        }
    if "error" in payload:
        return {
            "response_type": "error",
            "error_preview": str(payload.get("error") or "")[:500],
        }
    if payload.get("ok") is False:
        return {
            "response_type": "client_error",
            "reason": payload.get("reason"),
            "error_preview": str(payload.get("error") or "")[:500],
        }
    return {"response_type": "unknown", "keys": list(payload.keys())}


def _summarize_adapted_result(result: dict[str, Any]) -> dict[str, Any]:
    data = result.get("data")
    rows = result.get("rows")
    return {
        "ok": result.get("ok"),
        "fallback": result.get("fallback"),
        "reason": (str(result.get("reason") or "")[:500] or None),
        "chart_type": result.get("chartType"),
        "title": result.get("title"),
        "data_point_count": len(data) if isinstance(data, list) else 0,
        "data_preview": data[:5] if isinstance(data, list) else data,
        "row_count": len(rows) if isinstance(rows, list) else 0,
        "rows_preview": rows[:5] if isinstance(rows, list) else rows,
    }


def log_semantic_layer_call(
    *,
    event: str,
    tenant_id: str | None = None,
    query: str | None = None,
    enriched_query: str | None = None,
    product: str | None = None,
    gateway_url: str | None = None,
    elapsed_ms: float | None = None,
    raw: dict[str, Any] | None = None,
    adapted: dict[str, Any] | None = None,
    surface: str | None = None,
) -> None:
    payload: dict[str, Any] = {"event": event}
    if tenant_id:
        payload["tenant_id"] = tenant_id
    if query:
        payload["query"] = query
    if enriched_query and enriched_query != query:
        payload["enriched_query"] = enriched_query
    if product:
        payload["product"] = product
    if gateway_url:
        payload["gateway_url"] = gateway_url
    if elapsed_ms is not None:
        payload["elapsed_ms"] = round(elapsed_ms, 2)
    if surface:
        payload["surface"] = surface
    if raw is not None:
        payload["raw"] = _summarize_raw_response(raw)
    if adapted is not None:
        payload["adapted"] = _summarize_adapted_result(adapted)
    logger.info(event.replace("_", " "), extra={"semantic_layer": payload})


def semantic_layer_configured(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    return bool(settings.semantic_layer_url.strip())


def enrich_query_with_period(
    query: str,
    *,
    period_range: str | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
) -> str:
    cleaned = query.strip()
    if period_start and period_end:
        return f"{cleaned} (period: {period_start} to {period_end})"
    if period_range:
        return f"{cleaned} (period: last {period_range})"
    return cleaned


def _humanize_key(key: str) -> str:
    text = key.split("__")[-1].replace("_", " ").strip()
    if not text:
        return key
    parts: list[str] = []
    for part in text.split():
        mapped = ACRONYM_LABELS.get(part.lower())
        if mapped:
            parts.append(mapped)
        else:
            parts.append(part[:1].upper() + part[1:].lower() if part else part)
    return " ".join(parts)


def _is_time_key(key: str) -> bool:
    lowered = key.lower()
    return any(hint in lowered for hint in TIME_KEY_HINTS)


def _is_measure_key(key: str, value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return True
    if value is None:
        return any(hint in key.lower() for hint in MEASURE_KEY_HINTS)
    return False


def _pick_time_and_series_keys(row: dict[str, Any]) -> tuple[str | None, str | None]:
    time_key: str | None = None
    series_key: str | None = None
    for key, value in row.items():
        if _is_time_key(key):
            time_key = key
        elif "channel" in key.lower() and not _is_measure_key(key, value):
            series_key = key
    return time_key, series_key


def _pick_dimension_and_measure(row: dict[str, Any]) -> tuple[str | None, str | None]:
    measure_key: str | None = None
    dimension_key: str | None = None
    measure_score = -1

    for key, value in row.items():
        if _is_measure_key(key, value):
            score = 0
            lowered = key.lower()
            if RATE_KEY_RE.search(lowered):
                score += 4
            if lowered.startswith("total_") or lowered.startswith("unique_"):
                score += 3
            if lowered.startswith("average_") or lowered.startswith("avg_"):
                score += 3
            if score > measure_score:
                measure_key = key
                measure_score = score
        elif dimension_key is None and isinstance(value, str):
            dimension_key = key

    return dimension_key, measure_key


def format_duration_seconds(seconds: float) -> str:
    """Format a duration in seconds as Reports does: 45s, 12m, 1h 57m."""
    if seconds is None:
        return "—"
    try:
        number = float(seconds)
    except (TypeError, ValueError):
        return "—"
    if number != number or number in {float("inf"), float("-inf")}:
        return "—"
    rounded = int(round(number))
    if rounded < 60:
        return f"{rounded}s"
    minutes, remaining = divmod(rounded, 60)
    if minutes < 60:
        return f"{minutes}m {remaining}s" if remaining else f"{minutes}m"
    hours, minute_remainder = divmod(minutes, 60)
    return f"{hours}h {minute_remainder}m" if minute_remainder else f"{hours}h"


def _format_seconds(seconds: float) -> str:
    return format_duration_seconds(seconds)


def _format_measure_value(key: str, value: Any) -> str:
    if value is None:
        return "—"
    if not isinstance(value, (int, float)):
        return str(value)
    number = float(value)
    lowered = key.lower()
    if RATE_KEY_RE.search(lowered) and 0 <= number <= 1:
        rounded = round(number * 100, 1)
        return f"{int(rounded) if rounded.is_integer() else rounded}%"
    if "second" in lowered or lowered.endswith("_time") or lowered.startswith("average_handle"):
        return _format_seconds(number)
    if number.is_integer():
        return str(int(number))
    rounded = round(number, 1)
    return str(int(rounded) if rounded.is_integer() else rounded)


def _duration_kpi_annotation(measure_key: str, label: str, value: Any) -> dict[str, Any]:
    del label
    text = str(measure_key or "").lower()
    is_first_response = "first_response" in text or "first-response" in text
    is_handle = "handle" in text and "time" in text
    if not is_first_response and not is_handle:
        return {}
    if value is None:
        metric = "assignment and first-reply" if is_first_response else "assignment and end"
        return {
            "value": "—",
            "note": (
                f"Empty average: no conversations in this period have both {metric} "
                "timestamps. That is not proof of missing logging or a recording failure."
            ),
        }
    if isinstance(value, (int, float)) and int(round(float(value))) == 0:
        return {
            "note": (
                "A 0s duration is either no qualifying sample or a rounded mean under "
                "0.5 seconds. Do not claim timestamps are missing or incorrectly recorded "
                "without a sample count from generate_performance_report."
            ),
        }
    return {}


def _format_dimension_label(key: str, value: Any) -> str:
    if value is None:
        return "Unknown"
    text = str(value).strip()
    if _is_time_key(key):
        try:
            normalized = text.replace("Z", "+00:00")
            return datetime.fromisoformat(normalized).strftime("%d %b")
        except ValueError:
            return text[:10]
    if "channel" in key.lower():
        return CHANNEL_LABELS.get(text.lower(), _humanize_key(text))
    return text or "Unknown"


def infer_chart_type(
    query: str,
    rows: list[dict[str, Any]],
    dimension_key: str | None,
    *,
    requested: ChartType | None = None,
) -> ChartType:
    del query
    if requested and requested != "kpi":
        return requested
    if len(rows) <= 1 and not dimension_key:
        return "kpi"
    if dimension_key and _is_time_key(dimension_key):
        return "line"
    if dimension_key and "channel" in dimension_key.lower():
        return "pie"
    if requested:
        return requested
    return "bar" if len(rows) > 1 else "kpi"


def rows_have_values(rows: list[dict[str, Any]]) -> bool:
    if not rows:
        return False
    for row in rows:
        for value in row.values():
            if value is not None:
                return True
    return False


def adapt_semantic_rows(
    rows: list[dict[str, Any]],
    *,
    query: str,
    title: str | None = None,
    chart_type: ChartType | None = None,
) -> dict[str, Any]:
    if not rows:
        return {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": "Semantic layer returned no rows.",
        }

    sample = rows[0]
    dimension_key, measure_key = _pick_dimension_and_measure(sample)
    time_key, series_key = _pick_time_and_series_keys(sample)
    if measure_key is None:
        return {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": "Semantic layer rows did not include a numeric measure.",
            "rows": rows,
        }

    resolved_chart = infer_chart_type(query, rows, dimension_key, requested=chart_type)
    if time_key and series_key and measure_key and chart_type != "pie":
        points: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            raw_value = row.get(measure_key)
            if raw_value is None:
                continue
            channel = row.get(series_key)
            points.append(
                {
                    "label": _format_dimension_label(time_key, row.get(time_key)),
                    "value": raw_value if isinstance(raw_value, (int, float)) else raw_value,
                    "series": CHANNEL_LABELS.get(
                        str(channel or "").strip().lower(),
                        _humanize_key(str(channel or "Unknown")),
                    ),
                }
            )
        if points:
            return {
                "ok": True,
                "source": "semantic_layer",
                "type": "plot",
                "title": title or _humanize_key(measure_key),
                "chartType": "line",
                "description": query,
                "data": points,
                "kpis": [],
                "rows": rows,
                "grounded": True,
            }

    if resolved_chart == "kpi" or (len(rows) == 1 and dimension_key is None):
        value = sample.get(measure_key)
        label = title or _humanize_key(measure_key)
        card = {"label": label, "value": _format_measure_value(measure_key, value)}
        card.update(_duration_kpi_annotation(measure_key, label, value))
        return {
            "ok": True,
            "source": "semantic_layer",
            "type": "plot",
            "title": label,
            "chartType": "kpi",
            "description": query,
            "data": [card],
            "kpis": [card],
            "rows": rows,
            "grounded": True,
        }

    points: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        label_source = row.get(dimension_key) if dimension_key else None
        label = (
            _format_dimension_label(dimension_key or "label", label_source)
            if dimension_key
            else _humanize_key(measure_key)
        )
        raw_value = row.get(measure_key)
        if raw_value is None:
            continue
        points.append(
            {
                "label": label,
                "value": raw_value if isinstance(raw_value, (int, float)) else raw_value,
            }
        )

    if not points:
        return {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": "Semantic layer rows contained only null measures.",
            "rows": rows,
        }

    display_points = [
        {
            "label": point["label"],
            "value": _format_measure_value(measure_key, point["value"]),
        }
        for point in points
    ]
    chart_title = title or _humanize_key(measure_key)

    return {
        "ok": True,
        "source": "semantic_layer",
        "type": "plot",
        "title": chart_title,
        "chartType": resolved_chart,
        "description": query,
        "data": display_points,
        "kpis": display_points if resolved_chart == "kpi" else [],
        "rows": rows,
        "grounded": True,
    }


def _metric_result_title(metric_id: str | None, rows: list[dict[str, Any]]) -> str | None:
    if metric_id:
        return _humanize_key(metric_id)
    if rows and isinstance(rows[0], dict):
        _, measure_key = _pick_dimension_and_measure(rows[0])
        if measure_key:
            return _humanize_key(measure_key)
    return None


def _adapt_metric_result_item(
    item: dict[str, Any],
    *,
    query: str,
    chart_type: ChartType | None = None,
) -> dict[str, Any] | None:
    if not item.get("ok"):
        return None
    rows = item.get("rows")
    if not isinstance(rows, list) or not rows_have_values(rows):
        return None
    metric_id = str(item.get("metric_id") or "").strip() or None
    adapted = adapt_semantic_rows(
        rows,
        query=query,
        title=_metric_result_title(metric_id, rows),
        chart_type=chart_type,
    )
    if not adapted.get("ok"):
        return None
    if metric_id:
        adapted["metric_id"] = metric_id
    return adapted


def _pick_primary_chart(charts: list[dict[str, Any]]) -> dict[str, Any]:
    for preferred in ("line", "bar", "pie"):
        for chart in charts:
            if chart.get("chartType") == preferred:
                return chart
    return charts[0]


def _combine_semantic_plots(
    plots: list[dict[str, Any]],
    *,
    query: str,
    title: str | None = None,
) -> dict[str, Any]:
    scalars = [
        plot
        for plot in plots
        if plot.get("chartType") == "kpi" and len(plot.get("data") or []) == 1
    ]
    charts = [plot for plot in plots if plot.get("chartType") != "kpi"]
    scalar_cards: list[dict[str, Any]] = []
    for plot in scalars:
        scalar_cards.extend(point for point in (plot.get("data") or []) if isinstance(point, dict))

    metrics = [
        {"metric_id": plot.get("metric_id"), "rows": plot.get("rows")}
        for plot in plots
        if plot.get("metric_id") or plot.get("rows")
    ]

    if not charts:
        if not scalar_cards:
            return {
                "ok": False,
                "source": "semantic_layer",
                "fallback": "sql_analytics",
                "reason": "Semantic layer returned no usable metrics.",
            }
        card_title = title or ("Performance KPI" if len(scalar_cards) == 1 else "Performance KPIs")
        return {
            "ok": True,
            "source": "semantic_layer",
            "type": "plot",
            "title": card_title,
            "chartType": "kpi",
            "description": query,
            "data": scalar_cards,
            "kpis": scalar_cards,
            "metrics": metrics,
            "grounded": True,
        }

    primary = _pick_primary_chart(charts)
    result = dict(primary)
    result["ok"] = True
    result["source"] = "semantic_layer"
    result["type"] = "plot"
    if scalar_cards:
        result["kpis"] = scalar_cards
    if len(charts) > 1:
        result["plots"] = charts
    if metrics:
        result["metrics"] = metrics
    if title and len(charts) == 1 and not scalar_cards:
        result["title"] = title
    return result


def interpret_semantic_metric_array(
    items: list[Any],
    *,
    query: str,
    title: str | None = None,
    chart_type: ChartType | None = None,
) -> dict[str, Any]:
    if not items:
        return {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": "Semantic layer returned an empty metric list.",
        }

    if len(items) == 1 and isinstance(items[0], dict) and not items[0].get("ok"):
        lone = items[0]
        error = lone.get("error")
        if isinstance(error, dict):
            message = str(error.get("message") or error.get("code") or error)
        else:
            message = str(error or "Semantic layer could not answer this question.")
        return {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": message[:500],
        }

    adapted_plots = [
        plot
        for item in items
        if isinstance(item, dict)
        for plot in [_adapt_metric_result_item(item, query=query, chart_type=chart_type)]
        if plot
    ]
    if not adapted_plots:
        return {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": "Semantic layer returned no data for this question.",
        }
    if len(adapted_plots) == 1:
        return adapted_plots[0]
    return _combine_semantic_plots(adapted_plots, query=query, title=title)


def interpret_semantic_response(
    payload: dict[str, Any] | list[Any],
    *,
    query: str,
    title: str | None = None,
    chart_type: ChartType | None = None,
) -> dict[str, Any]:
    if isinstance(payload, list):
        return interpret_semantic_metric_array(
            payload,
            query=query,
            title=title,
            chart_type=chart_type,
        )

    if not isinstance(payload, dict):
        return {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": "Semantic layer returned an invalid payload.",
        }

    if payload.get("error"):
        error = payload["error"]
        message = (
            str(error.get("message") or error.get("code") or error)
            if isinstance(error, dict)
            else str(error)
        )
        return {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": message[:500],
        }

    if payload.get("answer"):
        return {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": str(payload["answer"])[:500],
            "answer": str(payload["answer"]),
        }

    rows = payload.get("rows")
    if not isinstance(rows, list):
        return {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": "Semantic layer response did not include rows.",
        }

    if not rows_have_values(rows):
        return {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": "Semantic layer returned no data for this metric.",
            "rows": rows,
        }

    return adapt_semantic_rows(rows, query=query, title=title, chart_type=chart_type)


async def ask_semantic_layer_gateway(
    query: str,
    *,
    tenant_id: str,
    product: str | None = None,
    settings: Settings | None = None,
    client: httpx.AsyncClient | None = None,
    surface: str | None = None,
    period_start: str | None = None,
    period_end: str | None = None,
    period_range: str | None = None,
) -> dict[str, Any]:
    settings = settings or get_settings()
    base_url = settings.semantic_layer_url.strip().rstrip("/")
    resolved_product = product or settings.semantic_layer_product
    if not base_url:
        result = {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": "Semantic layer URL is not configured.",
        }
        log_semantic_layer_call(
            event="semantic_layer_skipped",
            tenant_id=tenant_id,
            query=query,
            product=resolved_product,
            surface=surface,
            raw=result,
        )
        return result

    payload = {
        "query": query,
        "tenant_id": tenant_id,
        "organization_id": tenant_id,
        "product": resolved_product,
    }
    if period_start and period_end:
        payload["start"] = period_start
        payload["end"] = period_end
        payload["period_start"] = period_start
        payload["period_end"] = period_end
    elif period_range:
        payload["range"] = period_range
    owns_client = client is None
    http = client or httpx.AsyncClient(timeout=settings.semantic_layer_timeout_seconds)
    started = time.perf_counter()
    log_semantic_layer_call(
        event="semantic_layer_request",
        tenant_id=tenant_id,
        query=query,
        product=resolved_product,
        gateway_url=base_url,
        surface=surface,
    )
    try:
        response = await http.post(f"{base_url}/ask", json=payload)
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, (dict, list)):
            raise SemanticLayerError("Semantic layer returned an invalid JSON response.")
        elapsed_ms = (time.perf_counter() - started) * 1000
        log_semantic_layer_call(
            event="semantic_layer_response",
            tenant_id=tenant_id,
            query=query,
            product=resolved_product,
            gateway_url=base_url,
            elapsed_ms=elapsed_ms,
            surface=surface,
            raw=body,
        )
        return body
    except httpx.TimeoutException as error:
        result = {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": "Semantic layer request timed out.",
            "error": str(error),
        }
        log_semantic_layer_call(
            event="semantic_layer_response",
            tenant_id=tenant_id,
            query=query,
            product=resolved_product,
            gateway_url=base_url,
            elapsed_ms=(time.perf_counter() - started) * 1000,
            surface=surface,
            raw=result,
        )
        return result
    except httpx.HTTPStatusError as error:
        detail = error.response.text[:500]
        result = {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": f"Semantic layer returned {error.response.status_code}.",
            "error": detail,
        }
        log_semantic_layer_call(
            event="semantic_layer_response",
            tenant_id=tenant_id,
            query=query,
            product=resolved_product,
            gateway_url=base_url,
            elapsed_ms=(time.perf_counter() - started) * 1000,
            surface=surface,
            raw=result,
        )
        return result
    except (httpx.NetworkError, SemanticLayerError) as error:
        result = {
            "ok": False,
            "source": "semantic_layer",
            "fallback": "sql_analytics",
            "reason": "Semantic layer is temporarily unavailable.",
            "error": str(error),
        }
        log_semantic_layer_call(
            event="semantic_layer_response",
            tenant_id=tenant_id,
            query=query,
            product=resolved_product,
            gateway_url=base_url,
            elapsed_ms=(time.perf_counter() - started) * 1000,
            surface=surface,
            raw=result,
        )
        return result
    finally:
        if owns_client:
            await http.aclose()
