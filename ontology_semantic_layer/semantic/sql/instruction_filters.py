"""Parse natural-language instructions into SqlFilter rows for ticketing SQL."""

from __future__ import annotations

import re
from typing import Any

from semantic.sql.job import SqlFilter

_STATUS_OPEN = re.compile(r"\bopen\b", re.I)
_STATUS_RESOLVED = re.compile(r"\b(resolved|closed)\b", re.I)
_STATUS_PENDING = re.compile(r"\b(pending|in[- ]progress)\b", re.I)
_HIGH_PRIORITY = re.compile(r"\b(high[- ]?priority|urgent)\b", re.I)
_QUEUE = re.compile(r"queue\s+([a-zA-Z0-9 _&-]+)", re.I)


def parse_ticketing_filters(
    instruction: str,
    raw_filters: list[dict[str, Any]] | None,
    *,
    product: str,
) -> list[SqlFilter]:
    """Build SqlFilter list from explicit filters + instruction phrases."""
    if product != "ticketing":
        return _from_raw(raw_filters)

    filters = _from_raw(raw_filters)
    text = instruction or ""
    if not text.strip():
        return filters

    if _STATUS_OPEN.search(text) and not _has_column(filters, "status"):
        filters.append(SqlFilter(column="status", op="eq", values=["open"]))
    elif _STATUS_RESOLVED.search(text) and not _has_column(filters, "status"):
        filters.append(SqlFilter(column="status", op="eq", values=["Resolved"]))
    elif _STATUS_PENDING.search(text) and not _has_column(filters, "status"):
        filters.append(SqlFilter(column="status", op="eq", values=["Pending"]))

    m = _QUEUE.search(text)
    if m and not _has_column(filters, "queue_name"):
        qname = m.group(1).strip().rstrip(".")
        filters.append(SqlFilter(column="queue_name", op="contains", values=[qname]))

    if _HIGH_PRIORITY.search(text) and not _has_column(filters, "priority"):
        filters.append(
            SqlFilter(column="priority", op="in", values=["high", "urgent", "High", "Urgent"])
        )

    return filters


def instruction_names_high_priority(instruction: str) -> bool:
    return bool(_HIGH_PRIORITY.search(instruction or ""))


def _from_raw(raw_filters: list[dict[str, Any]] | None) -> list[SqlFilter]:
    filters: list[SqlFilter] = []
    for raw in raw_filters or []:
        col = str(raw.get("dimension") or raw.get("column") or "").strip()
        if not col:
            continue
        op = str(raw.get("op") or raw.get("operator") or "eq").lower()
        vals = raw.get("values") or []
        if not vals and raw.get("value") is not None:
            vals = [raw["value"]]
        filters.append(SqlFilter(column=col, op=op, values=list(vals)))
    return filters


def _has_column(filters: list[SqlFilter], column: str) -> bool:
    return any(f.column == column for f in filters)


def filters_to_sql_fragments(filters: list[SqlFilter]) -> list[str]:
    """Return SQL AND fragments (literal values) for mart column filters."""
    parts: list[str] = []
    for flt in filters:
        col = flt.column
        op = flt.op.lower()
        if op in ("eq", "=") and flt.values:
            val = str(flt.values[0]).replace("'", "''")
            if isinstance(flt.values[0], bool):
                parts.append(f"{col} IS {'TRUE' if flt.values[0] else 'FALSE'}")
            else:
                parts.append(f"lower({col}) = lower('{val}')")
        elif op in ("neq", "!=") and flt.values:
            val = str(flt.values[0]).replace("'", "''")
            parts.append(f"lower({col}) != lower('{val}')")
        elif op in ("in",) and flt.values:
            quoted = ", ".join(
                f"lower('{str(v).replace(chr(39), chr(39)+chr(39))}')" for v in flt.values
            )
            parts.append(f"lower({col}) IN ({quoted})")
        elif op in ("contains", "ilike", "like") and flt.values:
            needle = str(flt.values[0]).replace("'", "''")
            parts.append(f"{col} ILIKE '%{needle}%'")
    return parts
