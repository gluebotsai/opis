"""Template answers for speed — optional LLM polish in turn.py."""

from __future__ import annotations

from typing import Any

from app.util.format import format_duration_seconds
from shared.semantic_time import REALTIME_METRICS, dashboard_period_label


def format_scalar_answer(metric_id: str, value: Any, *, period_hint: str | None) -> str:
    label = metric_id.replace("_", " ")
    if metric_id in REALTIME_METRICS:
        return f"There are {value} visitors online right now."
    when = f" {period_hint}" if period_hint else ""
    if "duration" in metric_id.lower():
        return f"The {label}{when} is {format_duration_seconds(value)}."
    if "rate" in metric_id.lower():
        try:
            num = float(value)
            if num <= 1.0:
                num *= 100.0
            return f"The {label}{when} is {num:.1f}%."
        except (TypeError, ValueError):
            pass
    return f"The {label}{when} is {value}."


def format_table_intro(columns: list[str], row_count: int) -> str:
    if row_count == 0:
        return "No data matched that question for the selected period."
    return f"Here are {row_count} rows for your question."


def format_traffic_sources_intro(row_count: int, *, period_hint: str | None) -> str:
    when = f" {period_hint}" if period_hint else ""
    if row_count == 0:
        return f"No traffic source data{when}."
    return f"Here are your top traffic sources{when} ({row_count} channels)."


def format_product_visit_answer(
    product_name: str,
    count: Any,
    *,
    period_hint: str | None,
) -> str:
    when = f" {period_hint}" if period_hint else ""
    return f"**{product_name}** had **{count}** product visits{when}."


def format_ranking_answer(
    columns: list[str],
    rows: list[list[Any]],
    *,
    metric_id: str,
    period_hint: str | None,
    sort_direction: str | None,
) -> str:
    if not rows:
        return "No data matched that question for the selected period."
    if len(columns) == 1:
        return format_scalar_answer(columns[0], rows[0][0], period_hint=period_hint)
    when = f" {period_hint}" if period_hint else ""
    row = rows[0]
    label_col = None
    for candidate in ("product_name", "product_id", "page_path", "visitor_id", "country"):
        if candidate in columns:
            label_col = candidate
            break
    if label_col is None and len(columns) >= 2:
        label_col = columns[0] if columns[0] != metric_id else columns[1]
    try:
        metric_idx = columns.index(metric_id)
    except ValueError:
        metric_idx = len(columns) - 1
    label = row[columns.index(label_col)] if label_col else "Item"
    value = row[metric_idx]
    verb = "least" if sort_direction == "asc" else "most"
    if "product" in (label_col or "").lower() or "product" in metric_id:
        return f"The product with the {verb} interactions{when} is {label} ({value} interactions)."
    return f"The {verb} {label_col or 'value'}{when} is {label} ({value})."


def period_hint_for_answer(
    metric_id: str,
    *,
    dashboard_period: str | None,
    time: dict[str, Any] | None,
) -> str | None:
    if metric_id in REALTIME_METRICS:
        return None
    pill = dashboard_period_label(dashboard_period)
    if pill:
        return pill
    return period_hint_from_time(time)


def period_hint_from_time(time: dict[str, Any] | None) -> str | None:
    if not time:
        return None
    period = time.get("period")
    if not period:
        return None
    labels = {
        "today": "today",
        "yesterday": "yesterday",
        "last_7_days": "in the last 7 days",
        "last_30_days": "in the last 30 days",
        "overall": "overall",
        "this_week": "this week",
        "this_month": "this month",
    }
    return labels.get(str(period), str(period).replace("_", " "))


def _humanize_column(col: str) -> str:
    return col.replace("_", " ").strip().title()


def enrich_answer_with_table(
    answer: str,
    columns: list[str],
    rows: list[list[Any]],
    *,
    max_rows: int = 12,
) -> str:
    """Append a markdown table for multi-row results (co-worker UI renders inline tables)."""
    if not columns or len(rows) <= 1:
        return answer
    if "| ---" in answer or "\n|---" in answer:
        return answer
    headers = [_humanize_column(c) for c in columns]
    sep = "| " + " | ".join("---" for _ in headers) + " |"
    body_lines = [
        "",
        "| " + " | ".join(headers) + " |",
        sep,
    ]
    for row in rows[:max_rows]:
        cells = [str(v) if v is not None and v != "" else "—" for v in row]
        body_lines.append("| " + " | ".join(cells) + " |")
    if len(rows) > max_rows:
        body_lines.append("")
        body_lines.append(f"_Showing {max_rows} of {len(rows)} rows._")
    return answer.rstrip() + "\n" + "\n".join(body_lines)
