"""Parse natural-language instructions into SqlFilter rows."""

from __future__ import annotations

import re
from typing import Any

from sql_agent.job import SqlFilter

_STATUS_OPEN = re.compile(r"\bopen\b", re.I)
_STATUS_RESOLVED = re.compile(r"\b(resolved|closed)\b", re.I)
_STATUS_PENDING = re.compile(r"\b(pending|in[- ]progress)\b", re.I)
_HIGH_PRIORITY = re.compile(r"\b(high[- ]?priority|urgent)\b", re.I)
_QUEUE = re.compile(r"queue\s+([a-zA-Z0-9 _&-]+)", re.I)
_CHANNEL = re.compile(r"\b(voice|chat|email|whatsapp|sms)\b", re.I)
_STAGE = re.compile(r"\b(stage|pipeline stage)\s+([a-zA-Z0-9 _-]+)", re.I)
_OWNER = re.compile(r"\b(owner|assigned to)\s+([a-zA-Z0-9 _-]+)", re.I)
_LIFECYCLE = re.compile(r"\b(lifecycle|lead status)\s+([a-zA-Z0-9 _-]+)", re.I)
_CAMPAIGN_STATUS = re.compile(r"\b(active|running|paused|completed|draft)\b", re.I)
_DEVICE = re.compile(r"\b(mobile|desktop|tablet)\b", re.I)
_COUNTRY = re.compile(r"\bcountry\s+([a-zA-Z]{2,})\b", re.I)


def parse_ticketing_filters(
    instruction: str,
    raw_filters: list[dict[str, Any]] | None,
    *,
    product: str,
) -> list[SqlFilter]:
    """Ticketing uses Gemma plan filters only — no regex instruction parsing."""
    if product != "ticketing":
        return _from_raw(raw_filters)
    return _from_raw(raw_filters)


def parse_ccaas_filters(
    instruction: str,
    raw_filters: list[dict[str, Any]] | None,
    *,
    product: str,
) -> list[SqlFilter]:
    filters = _from_raw(raw_filters)
    text = instruction or ""
    if _STATUS_OPEN.search(text) and not _has_column(filters, "status"):
        filters.append(SqlFilter(column="status", op="eq", values=["open"]))
    m = _QUEUE.search(text)
    if m and not _has_column(filters, "queue_name"):
        qname = m.group(1).strip().rstrip(".")
        filters.append(SqlFilter(column="queue_name", op="contains", values=[qname]))
    if _CHANNEL.search(text) and not _has_column(filters, "channel"):
        filters.append(SqlFilter(column="channel", op="eq", values=[_CHANNEL.search(text).group(1).lower()]))
    return filters


def parse_crm_filters(
    instruction: str,
    raw_filters: list[dict[str, Any]] | None,
    *,
    product: str,
) -> list[SqlFilter]:
    filters = _from_raw(raw_filters)
    text = instruction or ""
    m = _STAGE.search(text)
    if m and not _has_column(filters, "stage"):
        filters.append(SqlFilter(column="stage", op="contains", values=[m.group(2).strip()]))
    m = _OWNER.search(text)
    if m and not _has_column(filters, "owner_name"):
        filters.append(SqlFilter(column="owner_name", op="contains", values=[m.group(2).strip()]))
    m = _LIFECYCLE.search(text)
    if m and not _has_column(filters, "lifecycle_stage"):
        filters.append(SqlFilter(column="lifecycle_stage", op="contains", values=[m.group(2).strip()]))
    return filters


def parse_campaign_filters(
    instruction: str,
    raw_filters: list[dict[str, Any]] | None,
    *,
    product: str,
) -> list[SqlFilter]:
    filters = _from_raw(raw_filters)
    text = instruction or ""
    if _CAMPAIGN_STATUS.search(text) and not _has_column(filters, "campaign_status"):
        filters.append(SqlFilter(column="campaign_status", op="eq", values=[_CAMPAIGN_STATUS.search(text).group(1).lower()]))
    if _CHANNEL.search(text) and not _has_column(filters, "source_channel"):
        filters.append(SqlFilter(column="source_channel", op="eq", values=[_CHANNEL.search(text).group(1).lower()]))
    return filters


def parse_webtracking_filters(
    instruction: str,
    raw_filters: list[dict[str, Any]] | None,
    *,
    product: str,
) -> list[SqlFilter]:
    filters = _from_raw(raw_filters)
    text = instruction or ""
    if _DEVICE.search(text) and not _has_column(filters, "device"):
        filters.append(SqlFilter(column="device", op="eq", values=[_DEVICE.search(text).group(1).lower()]))
    m = _COUNTRY.search(text)
    if m and not _has_column(filters, "country"):
        filters.append(SqlFilter(column="country", op="eq", values=[m.group(1).upper()]))
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
