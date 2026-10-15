"""Catalog list / find / count / breakdown / ranking. Allowlisted tables only."""

from __future__ import annotations

from typing import Any

from .access import apply_scope
from .checks import assert_read_only
from .dims import catalog_label, extra_filters_sql, in_list, segment_sql, shape_row_limit
from .loader import merge_effective
from .query_frame import Identity, QueryFrame
from .time import resolve_time

LIST_DEFAULT = [
    "ticket_number",
    "subject",
    "status",
    "priority",
    "description",
    "customer_name",
    "assignee_name",
    "queue_name",
    "csat_score",
    "created_by_name",
    "resolver_name",
    "created_at",
]
COLUMN_ALIASES = {
    "ticket number": "ticket_number",
    "number": "ticket_number",
    "subject": "subject",
    "status": "status",
    "priority": "priority",
    "description": "description",
    "customer": "customer_name",
    "customer name": "customer_name",
    "assignee": "assignee_name",
    "assignee name": "assignee_name",
    "agent": "assignee_name",
    "agent name": "assignee_name",
    "queue": "queue_name",
    "queue name": "queue_name",
    "csat": "csat_score",
    "csat_score": "csat_score",
    "created by": "created_by_name",
    "created_by": "created_by_name",
    "created by name": "created_by_name",
    "resolver": "resolver_name",
    "resolver name": "resolver_name",
    "created": "created_at",
    "created date": "created_at",
    "created_at": "created_at",
    "ticket_number": "ticket_number",
}
ALLOWED_LIST = set(LIST_DEFAULT)
DATE_COLUMNS = {"created_at", "resolved_at", "updated_at", "due_at"}


def roster_id(measure: str, catalog: dict[str, Any] | None = None) -> str | None:
    rosters = (catalog or {}).get("rosters") or {}
    raw = (measure or "").strip().lower()
    if not raw or raw in {"ticket_count", "tickets"}:
        return None
    if raw in rosters:
        return raw
    for name, spec in rosters.items():
        aliases = {str(a).lower() for a in (spec.get("aliases") or [])}
        if raw in aliases or raw.rstrip("s") == name.rstrip("s"):
            return name
    return None


def compile_roster(
    frame: QueryFrame,
    identity: Identity,
    *,
    resolved_targets: list[int] | None = None,
    filter_ids: dict[str, list[int]] | None = None,
) -> tuple[str, str]:
    catalog = merge_effective(identity.organization_id)
    product = catalog["catalog"]
    key = roster_id(frame.measure, product)
    if not key:
        raise ValueError(f"unknown roster {frame.measure}")
    spec = product["rosters"][key]
    org_id = int(identity.organization_id)
    alias = spec["alias"]
    table = spec["table"]
    cols = ", ".join(spec["columns"])
    order = spec.get("order") or "1"
    limit = shape_row_limit(frame)
    where = [f"{alias}.organization_id = {org_id}"]
    if frame.scope.level == "own" and key == "agents":
        where.append(f"{alias}.id = {int(identity.user_id)}")
    sql = (
        f"SELECT {cols} FROM {table} {alias} "
        f"WHERE {' AND '.join(where)} "
        f"ORDER BY {order} LIMIT {limit}"
    )
    assert_read_only(sql)
    return sql, f"roster {key}; scope {frame.scope.level}"


def list_columns(frame: QueryFrame) -> list[str]:
    requested = [COLUMN_ALIASES.get(c.strip().lower(), c.strip()) for c in (frame.select or [])]
    requested = [c for c in requested if c in ALLOWED_LIST]
    cols = requested or list(LIST_DEFAULT)
    if "created_at" in cols:
        cols = [c for c in cols if c != "created_at"] + ["created_at"]
    return cols


def compile_catalog(
    frame: QueryFrame,
    identity: Identity,
    *,
    resolved_targets: list[int] | None = None,
    filter_ids: dict[str, list[int]] | None = None,
) -> tuple[str, str]:
    catalog = merge_effective(identity.organization_id)
    bounds = resolve_time(frame.time)
    org_id = int(identity.organization_id)
    scope = apply_scope(
        frame,
        identity,
        catalog["access"],
        kpi_id="ticket_count" if frame.shape in {"count", "breakdown", "ranking"} else None,
        target_ids=resolved_targets,
    )
    where = [f"t.organization_id = {org_id}"]
    if scope.get("column") and scope.get("ids"):
        where.append(in_list(f"t.{scope['column']}", scope["ids"]))
    if scope.get("queue_ids"):
        where.append(in_list("t.queue_id", scope["queue_ids"]))
    date_col = frame.time.date_column or "created_at"
    if date_col not in DATE_COLUMNS:
        raise ValueError(f"date column {date_col} is not allowed")
    if bounds.start is not None and bounds.end is not None:
        where.append(
            f"t.{date_col} >= TIMESTAMPTZ '{bounds.start.isoformat()}' "
            f"AND t.{date_col} < TIMESTAMPTZ '{bounds.end.isoformat()}'"
        )
    dummy_card = catalog["kpis"].get("ticket_count") or {}
    seg = segment_sql(dummy_card, catalog["catalog"], frame)
    if seg != "TRUE":
        where.append(
            seg.replace("status", "t.status")
            .replace("priority", "t.priority")
            .replace("assignee_id", "t.assignee_id")
        )
    extra = extra_filters_sql(
        frame,
        filter_ids,
        alias="t",
        compare_fields=(catalog.get("catalog") or {}).get("compare_fields"),
    )
    if extra != "TRUE":
        where.append(extra)

    limit = shape_row_limit(frame)
    where_sql = " AND ".join(where)

    if frame.shape in {"list", "find"}:
        cols_list = list_columns(frame)
        person_only = {"customer_name", "assignee_name", "resolver_name", "created_by_name", "queue_name"}
        cols = ", ".join(f"t.{c}" for c in cols_list)
        if set(cols_list) <= person_only:
            sql = (
                f"SELECT DISTINCT {cols} FROM ticketing.tickets t "
                f"WHERE {where_sql} "
                f"ORDER BY 1 LIMIT {limit}"
            )
        else:
            sql = (
                f"SELECT {cols} FROM ticketing.tickets t "
                f"WHERE {where_sql} "
                f"ORDER BY t.created_at DESC LIMIT {limit}"
            )
    elif frame.shape == "count":
        sql = (
            f"SELECT COUNT(*)::bigint AS ticket_count FROM ticketing.tickets t "
            f"WHERE {where_sql}"
        )
    elif frame.shape in {"breakdown", "ranking"}:
        if not frame.group_by:
            raise ValueError("breakdown needs group_by")
        dim = frame.group_by[0]
        expr, alias = catalog_label(dim, date_col)
        order = "COUNT(*) DESC" if frame.shape == "ranking" else expr
        sql = (
            f"SELECT {expr} AS {alias}, COUNT(*)::bigint AS ticket_count "
            f"FROM ticketing.tickets t WHERE {where_sql} "
            f"GROUP BY {expr} ORDER BY {order} LIMIT {limit}"
        )
    else:
        raise ValueError(f"catalog path does not support shape {frame.shape}")
    assert_read_only(sql)
    echo = f"catalog tickets; scope {frame.scope.level}; {bounds.echo}"
    return sql, echo
