from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .query_frame import QueryFrame


@dataclass(frozen=True)
class Dimension:
    """One product grouping. Compilers read this table; they do not special-case names."""

    column: str | None = None
    sql_label: str | None = None
    kg_return: str | None = None
    kg_hop: str | None = None
    calendar: str | None = None


DIMENSIONS: dict[str, Dimension] = {
    "queue": Dimension(
        column="queue_id",
        sql_label="t.queue_name",
        kg_return="coalesce(q.queue_name, t.queue_name) AS queue,",
        kg_hop="OPTIONAL MATCH (t)-[:in_queue]->(q:Queue)",
    ),
    "agent": Dimension(
        column="assignee_id",
        sql_label="t.assignee_name",
        kg_return="t.assignee_name AS agent,",
        kg_hop="OPTIONAL MATCH (t)-[:assigned_to]->(a:Agent)",
    ),
    "resolver": Dimension(
        column="resolver_id",
        sql_label="t.resolver_name",
        kg_return="t.resolver_name AS resolver,",
        kg_hop="OPTIONAL MATCH (t)-[:resolved_by]->(r:Agent)",
    ),
    "status": Dimension(column="status", sql_label="t.status", kg_return="t.status AS status,"),
    "priority": Dimension(column="priority", sql_label="t.priority", kg_return="t.priority AS priority,"),
    "channel": Dimension(column="channel", sql_label="t.channel", kg_return="t.channel AS channel,"),
    "category": Dimension(column="category", sql_label="t.category", kg_return="t.category AS category,"),
    "customer": Dimension(
        column="customer_id",
        sql_label="t.customer_name",
        kg_return="t.customer_name AS customer,",
    ),
    "created_by": Dimension(
        column="created_by_id",
        sql_label="t.created_by_name",
        kg_return="t.created_by_id AS created_by,",
    ),
    "month": Dimension(calendar="month"),
    "week": Dimension(calendar="week"),
    "day": Dimension(calendar="day"),
}

DIM_COLUMNS = {name: dim.column for name, dim in DIMENSIONS.items() if dim.column}
CALENDAR_DIMS = frozenset(name for name, dim in DIMENSIONS.items() if dim.calendar)
KG_HOPS = {name: dim.kg_hop for name, dim in DIMENSIONS.items() if dim.kg_hop}
KG_RETURN = {name: dim.kg_return for name, dim in DIMENSIONS.items() if dim.kg_return}

READING_TO_SEGMENT = {
    "generic_pending": "pending_generic",
    "literal": "pending_literal",
    "open": "open",
    "reopened": "reopened",
    "overdue": "overdue",
    "resolved": "resolved",
}
READING_SQL_KEYS = {
    "generic_pending": "generic_pending",
    "literal": "literal_pending",
    "open": "open",
    "reopened": "reopened",
    "overdue": "overdue",
    "resolved": "resolved",
}
STATUS_READINGS = {
    "pending_generic": "generic_pending",
    "generic": "generic_pending",
    "generic_pending": "generic_pending",
    "pending_literal": "literal",
    "literal_pending": "literal",
    "literal": "literal",
    "open": "open",
    "reopened": "reopened",
    "overdue": "overdue",
    "resolved": "resolved",
    "pending": "literal",
    "pending tickets": "literal",
    "generic pending": "generic_pending",
    "still open": "generic_pending",
    "outstanding": "generic_pending",
    "not closed": "generic_pending",
}


def calendar_sql(name: str, date_col: str) -> str:
    unit = DIMENSIONS[name].calendar
    if not unit:
        raise ValueError(f"unknown dimension {name}")
    return f"date_trunc('{unit}', {date_col} AT TIME ZONE 'UTC')"


def certified_group_sql(name: str, date_col: str) -> str:
    """Group expression on base_ticket (no t. prefix). Prefer display names over ids."""
    dim = DIMENSIONS.get(name)
    if dim is None:
        raise ValueError(f"unknown dimension {name}")
    if dim.calendar:
        return calendar_sql(name, date_col)
    if dim.sql_label:
        return dim.sql_label.removeprefix("t.")
    if dim.column:
        return dim.column
    raise ValueError(f"unknown dimension {name}")


def catalog_label(name: str, date_col: str) -> tuple[str, str]:
    dim = DIMENSIONS.get(name)
    if dim is None:
        raise ValueError(f"unknown dimension {name}")
    if dim.calendar:
        return calendar_sql(name, f"t.{date_col}"), name
    if dim.sql_label:
        return dim.sql_label, name
    raise ValueError(f"unknown dimension {name}")


def in_list(column: str, ids: list[int]) -> str:
    inner = ", ".join(str(int(i)) for i in ids)
    return f"{column} IN ({inner})"


def row_limit(frame: QueryFrame, *, default: int = 200, cap: int = 500) -> int:
    raw = frame.limit
    n = default if raw is None else int(raw)
    if n < 1:
        n = default
    return min(n, cap)


def shape_row_limit(frame: QueryFrame, *, cap: int = 500) -> int:
    """Ranking is top-N. Breakdown/list keep a higher cap unless the frame set limit."""
    if frame.limit is not None:
        return row_limit(frame, default=int(frame.limit), cap=cap)
    if frame.shape == "ranking":
        return min(10, cap)
    if frame.shape == "breakdown":
        return min(50, cap)
    return min(200, cap)


def _ilike_sql(column: str, mention: str) -> str:
    from .resolve import escape_like, escape_literal

    pattern = escape_literal(escape_like(mention.strip()))
    return f"{column} ILIKE '%{pattern}%' ESCAPE '\\'"


def _contains_cypher(prop: str, mention: str) -> str:
    from .resolve import escape_literal

    needle = escape_literal(mention.strip()).replace("\\", "\\\\")
    return f"toLower({prop}) CONTAINS toLower('{needle}')"


def parse_compare_number(mention: str) -> float:
    raw = (mention or "").strip().replace(",", "")
    token = raw.split()[0] if raw else ""
    try:
        return float(token)
    except ValueError:
        chars: list[str] = []
        started = False
        for ch in raw:
            if ch.isdigit() or (ch in ".-" and not started):
                chars.append(ch)
                started = True
            elif started and ch == ".":
                chars.append(ch)
            elif started:
                break
        if not chars:
            raise ValueError(f"compare filter needs a number, got {mention!r}")
        return float("".join(chars))


def _compare_map(compare_fields: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    fields = compare_fields or {
        "csat_score": {"sql": "{a}csat_score", "aliases": ["csat"]},
        "resolution_hours": {
            "sql": "EXTRACT(EPOCH FROM ({a}resolved_at - {a}created_at)) / 3600.0",
            "extra": "{a}resolved_at IS NOT NULL",
            "aliases": ["resolution_time", "resolve_time", "resolution"],
        },
        "first_response_hours": {
            "sql": "EXTRACT(EPOCH FROM ({a}first_response_at - {a}created_at)) / 3600.0",
            "extra": "{a}first_response_at IS NOT NULL",
            "aliases": ["first_response_time", "response_time"],
        },
        "open_age_hours": {
            "sql": "EXTRACT(EPOCH FROM (NOW() - {a}created_at)) / 3600.0",
            "aliases": ["age_hours", "ticket_age"],
        },
        "overdue_hours": {
            "sql": "EXTRACT(EPOCH FROM (COALESCE({a}resolved_at, NOW()) - {a}due_at)) / 3600.0",
            "extra": "{a}due_at IS NOT NULL",
            "aliases": ["overdue"],
        },
    }
    out: dict[str, dict[str, Any]] = {}
    for name, spec in fields.items():
        out[name] = spec
        for alias in spec.get("aliases") or []:
            out[str(alias)] = spec
    return out


def extra_filters_sql(
    frame: QueryFrame,
    filter_ids: dict[str, list[int]] | None,
    *,
    alias: str = "",
    compare_fields: dict[str, Any] | None = None,
) -> str:
    from .prepare import TIME_FILTER_FIELDS
    from .query_frame import COMPARE_OPS
    from .resolve import NAME_COLUMNS, NAME_FIELDS, escape_literal

    prefix = f"{alias}." if alias and not alias.endswith(".") else alias
    compares = _compare_map(compare_fields)
    parts: list[str] = []
    seen: set[str] = set()
    for flt in frame.filters:
        if flt.field in {"status", "priority", "bucket"} or flt.field in TIME_FILTER_FIELDS:
            continue
        if flt.field in NAME_FIELDS:
            col = NAME_COLUMNS[flt.field]
            parts.append(_ilike_sql(f"{prefix}{col}" if prefix else col, flt.mention))
            seen.add(flt.field)
        elif flt.field in {"channel", "category"}:
            col = f"{prefix}{flt.field}" if prefix else flt.field
            parts.append(f"{col} = '{escape_literal(flt.mention)}'")
        elif flt.field in compares:
            spec = compares[flt.field]
            op = COMPARE_OPS.get((flt.reading or "=").lower(), "=")
            expr = str(spec["sql"]).format(a=prefix)
            clause = f"{expr} {op} {parse_compare_number(flt.mention)}"
            extra = spec.get("extra")
            if extra:
                clause = f"({str(extra).format(a=prefix)} AND {clause})"
            parts.append(clause)
        else:
            raise ValueError(f"unknown filter field {flt.field}")
    parked = frame.scope.target_mention if frame.scope.level == "org" else None
    if parked and not seen:
        cols = [f"{prefix}{c}" if prefix else c for c in NAME_COLUMNS.values()]
        parts.append("(" + " OR ".join(_ilike_sql(col, parked) for col in cols) + ")")
    return " AND ".join(parts) if parts else "TRUE"


def extra_filters_cypher(frame: QueryFrame, alias: str = "t") -> str:
    from .prepare import TIME_FILTER_FIELDS
    from .resolve import NAME_COLUMNS, NAME_FIELDS

    parts: list[str] = []
    seen: set[str] = set()
    for flt in frame.filters:
        if flt.field in {"status", "priority", "bucket"} or flt.field in TIME_FILTER_FIELDS:
            continue
        if flt.field in NAME_FIELDS:
            parts.append(_contains_cypher(f"{alias}.{NAME_COLUMNS[flt.field]}", flt.mention))
            seen.add(flt.field)
        elif flt.field in {"channel", "category"}:
            from .resolve import escape_literal

            parts.append(f"toLower({alias}.{flt.field}) = toLower('{escape_literal(flt.mention)}')")
    parked = frame.scope.target_mention if frame.scope.level == "org" else None
    if parked and not seen:
        parts.append(
            "("
            + " OR ".join(_contains_cypher(f"{alias}.{col}", parked) for col in NAME_COLUMNS.values())
            + ")"
        )
    return " AND ".join(parts) if parts else "true"


def _status_reading(flt) -> str | None:
    raw = (flt.reading or "").strip().lower()
    if raw:
        return STATUS_READINGS.get(raw) or (raw if raw in READING_TO_SEGMENT else None)
    mention = (flt.mention or "").strip().lower()
    return STATUS_READINGS.get(mention)


def segment_sql(card: dict[str, Any], catalog: dict[str, Any], frame: QueryFrame) -> str:
    readings = catalog.get("status_readings") or {}
    parts: list[str] = []
    segments = card.get("segments") or {}
    for flt in frame.filters:
        if flt.field == "status":
            reading = _status_reading(flt)
            if not reading:
                parts.append(f"status = '{escape_status(flt.mention)}'")
                continue
            key = READING_TO_SEGMENT.get(reading, reading)
            catalog_key = READING_SQL_KEYS.get(reading, reading)
            raw = segments.get(key) or (readings.get(catalog_key) or readings.get(reading) or {}).get("sql")
            if raw and not str(raw).lower().startswith("no extra"):
                parts.append(str(raw))
            elif catalog_key in readings:
                parts.append(readings[catalog_key]["sql"])
        elif flt.field == "priority":
            raw = segments.get("high_priority") if flt.mention.lower() == "high" else None
            if raw:
                parts.append(str(raw))
            else:
                from .resolve import escape_literal

                parts.append(f"priority = '{escape_literal(flt.mention)}'")
        elif flt.mention in segments:
            raw = segments[flt.mention]
            if raw and not str(raw).lower().startswith("no extra"):
                parts.append(str(raw))
    return " AND ".join(parts) if parts else "TRUE"


def escape_status(mention: str) -> str:
    from .resolve import escape_literal

    return escape_literal(mention)
