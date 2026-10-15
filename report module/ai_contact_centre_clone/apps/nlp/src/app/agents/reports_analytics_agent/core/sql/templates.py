"""Fill certified templates. Only {{dimension_select}} and {{group_by_sql}}. No filters_sql."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from ..loader import PRODUCT_DIR, hitl_object

_TABLE_ALIAS = {
    "conversations": "conversations",
    "agent_missed_contacts": "missed_contacts",
    "agent_presence_history": "presence_history",
    "agent_presence": "presence",
    "conversation_messages": "messages",
    "conversation_assignments": "assignments",
    "agent_tasks": "tasks",
    "nlp_turns": "nlp_turns",
    "copilot_turns": "copilot_turns",
    "call_cdr": "call_cdr",
    "agents": "agents",
}


@lru_cache(maxsize=4)
def _dimensions(product_dir: str) -> dict[str, Any]:
    path = Path(product_dir) / "dimensions.yml"
    data = yaml.safe_load(path.read_text()) or {}
    return data if isinstance(data, dict) else {}


def alias_dimension(raw: str | None, *, object_name: str | None = None, product_dir: Path = PRODUCT_DIR) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip().lower()
    if text in {"", "null", "none"}:
        return None
    doc = _dimensions(str(product_dir))
    aliases = {str(k).lower(): str(v) for k, v in (doc.get("aliases") or {}).items()}
    if object_name:
        scoped = f"{object_name}.{text}"
        if scoped in aliases:
            return aliases[scoped]
        dotted = f"{object_name}.{text.replace(' ', '_')}"
        if dotted in aliases:
            return aliases[dotted]
    if text in aliases:
        return aliases[text]
    dim_ids = {str(k).lower() for k in (doc.get("dimensions") or {})}
    slug = text.replace(" ", "_")
    if text in dim_ids:
        return text
    if slug in dim_ids:
        return slug
    return None


def business_clock_sql(card: dict[str, Any], object_name: str) -> str | None:
    raw = str(card.get("default_time_column") or "").strip()
    if not raw or raw == "none":
        return None
    parts = raw.split(".")
    col = parts[-1]
    table = parts[-2] if len(parts) >= 2 else object_name
    alias = _TABLE_ALIAS.get(table, object_name)
    return f"{alias}.{col}"


def _expr_for(
    dim_id: str,
    object_name: str,
    card: dict[str, Any],
    product_dir: Path,
) -> str | None:
    dims = (_dimensions(str(product_dir)).get("dimensions") or {})
    spec = dims.get(dim_id) or {}
    exprs = spec.get("sql_expr") or {}
    if object_name in exprs:
        expr = str(exprs[object_name])
    elif "default" in exprs:
        expr = str(exprs["default"])
    else:
        return None
    if "<business_date_column>" in expr:
        clock = business_clock_sql(card, object_name)
        if not clock:
            return None
        expr = expr.replace("<business_date_column>", clock)
    return expr


_CHANNEL_VALUES = frozenset(
    {"call", "webchat", "email", "whatsapp", "instagram", "facebook", "voice", "social"}
)


def partition_slice(
    raw_list: list[str] | str | None,
    card: dict[str, Any],
    *,
    product_dir: Path = PRODUCT_DIR,
    kpi_id: str | None = None,
) -> tuple[list[str], list[str]]:
    """Keep catalog dimensions. Leave person/queue/channel values as leftovers. Not routing."""
    if not raw_list:
        return [], []
    items = [raw_list] if isinstance(raw_list, str) else list(raw_list)
    allowed = {str(a).strip() for a in (card.get("allowed_dimensions") or []) if a}
    object_name = hitl_object(kpi_id) if kpi_id else "conversation"
    dims: list[str] = []
    leftovers: list[str] = []
    for raw in items:
        if not raw:
            continue
        dim = alias_dimension(str(raw), object_name=object_name, product_dir=product_dir)
        if not dim:
            leftovers.append(str(raw).strip())
            continue
        if allowed and dim not in allowed:
            raise ValueError(
                f"unknown dimension: '{raw}' is not allowed on this KPI. "
                f"Allowed: {sorted(allowed)}"
            )
        if not _expr_for(dim, object_name, card, product_dir):
            raise ValueError(
                f"unknown dimension: '{raw}' (resolved '{dim}') has no SQL expression "
                f"for object '{object_name}'."
            )
        if dim not in dims:
            dims.append(dim)
    return dims, leftovers


def apply_slice_leftovers(
    leftovers: list[str],
    card: dict[str, Any],
    *,
    dims: list[str],
    filters: dict[str, Any],
) -> tuple[list[str], dict[str, Any], list[str]]:
    """Person/channel leftovers become filters or a compare group. Not question routing."""
    declared = set(card.get("filters") or {})
    allowed = {str(a).strip() for a in (card.get("allowed_dimensions") or []) if a}
    out_dims = list(dims)
    incoming = dict(filters)
    channels: list[str] = []
    names: list[str] = []
    for raw in leftovers:
        key = str(raw).strip().lower()
        if not key:
            continue
        if key in _CHANNEL_VALUES:
            channels.append("call" if key == "voice" else key)
        else:
            names.append(str(raw).strip())
    if channels and "channel" in declared and "channel" not in incoming:
        incoming["channel"] = channels[0]
    mentions: list[str] = []
    if len(names) == 1:
        mention = names[0]
        if "agent" in declared and "agent" not in incoming:
            incoming["agent"] = mention
        elif "queue" in declared and "queue" not in incoming:
            incoming["queue"] = mention
        else:
            mentions = names
            if "agent" in allowed and "agent" not in out_dims:
                out_dims.append("agent")
    elif len(names) >= 2:
        if "agent" in allowed and "agent" not in out_dims:
            out_dims.append("agent")
        mentions = names
    return out_dims, incoming, mentions


def dimension_slots(
    dimensions: list[str] | str | None,
    card: dict[str, Any],
    *,
    product_dir: Path = PRODUCT_DIR,
    kpi_id: str | None = None,
) -> tuple[str, str]:
    if not dimensions:
        return "", ""
    raw_list = [dimensions] if isinstance(dimensions, str) else list(dimensions)
    raw_list = [d for d in raw_list if d]
    if not raw_list:
        return "", ""
    if len(raw_list) > 2:
        raise ValueError("unknown dimension: at most two group-by dimensions are supported")
    allowed_ids = {str(a).strip() for a in (card.get("allowed_dimensions") or []) if a}
    object_name = hitl_object(kpi_id) if kpi_id else "conversation"
    selects: list[str] = []
    groups: list[str] = []
    for raw in raw_list:
        dim = alias_dimension(raw, object_name=object_name, product_dir=product_dir)
        if not dim:
            continue
        if allowed_ids and dim not in allowed_ids:
            raise ValueError(
                f"unknown dimension: '{raw}' is not allowed on this KPI. "
                f"Allowed: {sorted(allowed_ids)}"
            )
        expr = _expr_for(dim, object_name, card, product_dir)
        if not expr:
            raise ValueError(
                f"unknown dimension: '{raw}' (resolved '{dim}') has no SQL expression "
                f"for object '{object_name}'."
            )
        selects.append(f"{expr} AS {dim}")
        groups.append(expr)
    if not selects:
        return "", ""
    select_sql = ", ".join(selects) + ","
    group_sql = "GROUP BY " + ", ".join(groups)
    return select_sql, group_sql


def fill_dimension_slots(sql: str, dimension_select: str, group_by_sql: str) -> str:
    out = sql.replace("{{dimension_select}}", dimension_select).replace(
        "{{group_by_sql}}", group_by_sql
    )
    if "{{" in out:
        raise ValueError(f"unfilled SQL slots remain (filters_sql is forbidden): {out}")
    return out
