"""Auto visualization dashboard generator."""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from app.util.format import format_duration_seconds

_DURATION_METRIC_COLUMNS = frozenset({
    "avg_session_duration_seconds",
    "duration_seconds",
    "total_session_duration_sec",
})


def _is_numeric(value: Any) -> bool:
    return isinstance(value, (int, float, Decimal)) and not isinstance(value, bool)


def _is_temporal(name: str, value: Any) -> bool:
    if isinstance(value, (datetime, date)):
        return True
    lowered = name.lower()
    return any(token in lowered for token in ("date", "time", "day", "week", "month", "started", "created"))


def _format_datetime(value: datetime) -> str:
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc)
    return value.strftime("%d %b %Y, %H:%M UTC")


def _looks_iso_datetime(text: str) -> bool:
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}", text))


def _format_cell(column: str, value: Any) -> Any:
    if value is None:
        return value
    col = column.lower()
    if isinstance(value, datetime):
        return _format_datetime(value)
    if isinstance(value, date):
        return value.strftime("%d %b %Y")
    if isinstance(value, str) and _looks_iso_datetime(value):
        try:
            normalized = value.replace("Z", "+00:00")
            return _format_datetime(datetime.fromisoformat(normalized))
        except ValueError:
            return value
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, float) and "minute" in col:
        return round(value, 1)
    return value


def _serialize(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return _format_datetime(value) if isinstance(value, datetime) else value.strftime("%d %b %Y")
    if isinstance(value, Decimal):
        return float(value)
    return value


def _format_metric_value(column: str, value: Any) -> Any:
    col = column.lower()
    if col in _DURATION_METRIC_COLUMNS and _is_numeric(value):
        return format_duration_seconds(value)
    return _serialize(value)


class DashboardGenerator:
    def build(
        self,
        columns: list[str],
        rows: list[list[Any]],
        *,
        title: str | None = None,
        hint: str | None = None,
    ) -> dict[str, Any]:
        if not columns:
            return {"widgets": []}

        serialized_rows = [
            [_format_cell(columns[j], v) for j, v in enumerate(row)]
            for row in rows
        ]
        widgets: list[dict[str, Any]] = []
        lowered_cols = [c.lower() for c in columns]

        # Single-value / single-row answers: prose (+ optional inline markdown table) only.
        if len(rows) == 1:
            return {"widgets": []}

        if hint == "table" or _needs_table(lowered_cols, len(columns)):
            widgets.append({
                "type": "table",
                "title": title or "Results",
                "columns": columns,
                "rows": serialized_rows,
            })
            return {"widgets": widgets}

        if hint == "line_chart" or self._looks_like_timeseries(columns, rows):
            x_idx, y_idx = self._pick_xy(columns, rows, prefer_time=True)
            widgets.append({
                "type": "line_chart",
                "title": title or "Trend",
                "x": [_serialize(r[x_idx]) for r in rows],
                "y": [_serialize(r[y_idx]) for r in rows],
            })
            return {"widgets": widgets}

        if hint == "pie_chart" or self._looks_like_pie(columns, rows):
            label_idx, value_idx = self._pick_xy(columns, rows, prefer_time=False)
            widgets.append({
                "type": "pie_chart",
                "title": title or "Distribution",
                "labels": [str(r[label_idx]) for r in rows],
                "values": [_serialize(r[value_idx]) for r in rows],
            })
            return {"widgets": widgets}

        if hint == "bar_chart" or (len(columns) == 2 and len(rows) <= 20):
            x_idx, y_idx = self._pick_xy(columns, rows, prefer_time=False)
            widgets.append({
                "type": "bar_chart",
                "title": title or "Top Results",
                "x": [str(r[x_idx]) for r in rows],
                "y": [_serialize(r[y_idx]) for r in rows],
            })
            return {"widgets": widgets}

        widgets.append({
            "type": "table",
            "title": title or "Results",
            "columns": columns,
            "rows": serialized_rows,
        })
        return {"widgets": widgets}

    def _pick_xy(
        self,
        columns: list[str],
        rows: list[list[Any]],
        *,
        prefer_time: bool,
    ) -> tuple[int, int]:
        numeric_idx = next(
            (i for i, col in enumerate(columns) if rows and _is_numeric(rows[0][i])),
            len(columns) - 1,
        )
        if prefer_time:
            for i, col in enumerate(columns):
                if rows and _is_temporal(col, rows[0][i]):
                    return i, numeric_idx if numeric_idx != i else (numeric_idx + 1) % len(columns)
        label_idx = 0 if numeric_idx != 0 else 1
        return label_idx, numeric_idx

    def _looks_like_timeseries(self, columns: list[str], rows: list[list[Any]]) -> bool:
        if len(columns) < 2 or not rows:
            return False
        return any(_is_temporal(col, rows[0][i]) for i, col in enumerate(columns))

    def _looks_like_pie(self, columns: list[str], rows: list[list[Any]]) -> bool:
        if len(columns) != 2 or len(rows) > 8:
            return False
        total = sum(float(r[1]) for r in rows if _is_numeric(r[1]))
        return 90 <= total <= 110 or "percent" in columns[1].lower() or "share" in columns[1].lower()


def _needs_table(lowered_cols: list[str], col_count: int) -> bool:
    """Multi-column detail rows (visitors, traffic+page, etc.) need a full table."""
    if col_count > 2:
        return True
    if "visitor_id" in lowered_cols:
        return True
    if any(k in lowered_cols for k in ("traffic_source", "landing_page", "entry_page")):
        return True
    return False


dashboard_generator = DashboardGenerator()
