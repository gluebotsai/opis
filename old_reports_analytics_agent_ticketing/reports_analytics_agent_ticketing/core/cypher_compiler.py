"""Compile a Domain frame to read-only Cypher. Access and time match SQL."""

from __future__ import annotations

import re
from typing import Any

from .access import AccessDenied, apply_scope
from .cypher_validate import assert_allowlist, assert_product_fence, assert_read_only_cypher, cap_limit
from .dims import extra_filters_cypher, in_list, segment_sql, shape_row_limit, KG_HOPS, KG_RETURN
from .loader import merge_effective
from .prepare import CALENDAR_DIMS, KG_CALENDAR_ERROR
from .query_frame import Identity, QueryFrame
from .templates import fill_named
from .time import resolve_time

TRUE = "true"


def _collapse_true_and(cypher: str) -> str:
    out = cypher
    prev = None
    while prev != out:
        prev = out
        out = re.sub(r"\bWHERE\s+true\s+AND\s+", "WHERE ", out, flags=re.IGNORECASE)
        out = re.sub(r"\s+AND\s+true\b", "", out, flags=re.IGNORECASE)
        out = re.sub(r"\btrue\s+AND\s+", "", out, flags=re.IGNORECASE)
        out = re.sub(r"[ \t]+\n", "\n", out)
    return out


def _sql_pred_to_cypher(pred: str, alias: str) -> str:
    if pred == "TRUE" or not pred:
        return TRUE
    out = pred
    for col in (
        "status",
        "priority",
        "assignee_id",
        "resolver_id",
        "queue_id",
        "created_by_id",
        "customer_id",
        "channel",
        "category",
    ):
        out = re.sub(rf"(?<!\.)\b{col}\b", f"{alias}.{col}", out)
    out = re.sub(r"\bIN\s*\(([^)]*'[^)]*)\)", r"IN [\1]", out, flags=re.IGNORECASE)
    return out


def _scope_cypher(scope: dict[str, Any], *, alias: str) -> str:
    parts: list[str] = []
    if scope.get("column") and scope.get("ids"):
        parts.append(in_list(f"{alias}.{scope['column']}", scope["ids"]))
    if scope.get("queue_ids"):
        parts.append(in_list(f"{alias}.queue_id", scope["queue_ids"]))
    return " AND ".join(parts) if parts else TRUE


def compile_graph_frame(
    frame: QueryFrame,
    identity: Identity,
    *,
    resolved_targets: list[int] | None = None,
    filter_ids: dict[str, list[int]] | None = None,
) -> tuple[str, dict[str, Any], str]:
    catalog = merge_effective(identity.organization_id)
    measures = catalog["kg_measures"]
    if frame.path == "catalog":
        measure_id = "why_breakdown" if frame.shape in {"breakdown", "ranking", "count"} else "ticket_neighborhood"
    else:
        measure_id = frame.measure
    if measure_id not in measures:
        raise ValueError(f"unknown graph measure {measure_id}")
    card = measures[measure_id]
    allowed_levels = card.get("allowed_scope_levels") or []
    if allowed_levels and frame.scope.level not in allowed_levels:
        raise AccessDenied(f"{measure_id} does not allow scope {frame.scope.level}.")

    kpi_for_access = "ticket_count" if measure_id == "why_breakdown" else measure_id
    scope = apply_scope(
        frame,
        identity,
        catalog["access"],
        kpi_id=kpi_for_access,
        target_ids=resolved_targets,
    )

    alias = "q" if measure_id == "staffing_path" else "t"
    if measure_id == "staffing_path" and scope.get("column") == "queue_id":
        scope_clause = _scope_cypher({"column": "id", "ids": scope.get("ids")}, alias="q")
    else:
        scope_clause = _scope_cypher(scope, alias=alias)
    extra_c = extra_filters_cypher(frame, alias="t")
    if measure_id != "staffing_path" and extra_c != "true":
        scope_clause = f"{scope_clause} AND {extra_c}" if scope_clause != TRUE else extra_c

    bounds = resolve_time(frame.time)
    params: dict[str, Any] = {}
    date_col = frame.time.date_column or card.get("default_time_column") or "created_at"
    allowed_dates = set(card.get("allowed_date_columns") or [date_col])
    if date_col not in allowed_dates:
        raise ValueError(f"date column {date_col} is not allowed")
    if measure_id == "staffing_path":
        time_clause = TRUE
        echo_time = "overall (no date filter, UTC)"
    elif bounds.start is not None and bounds.end is not None:
        params["period_start"] = bounds.start.strftime("%Y-%m-%dT%H:%M:%SZ")
        params["period_end"] = bounds.end.strftime("%Y-%m-%dT%H:%M:%SZ")
        time_clause = (
            f"{alias}.{date_col} >= datetime($period_start) "
            f"AND {alias}.{date_col} < datetime($period_end)"
        )
        echo_time = bounds.echo
    else:
        time_clause = TRUE
        echo_time = bounds.echo

    dummy_sql_card = catalog["kpis"].get("ticket_count") or {}
    seg = segment_sql(dummy_sql_card, catalog["catalog"], frame)
    segment_clause = TRUE if measure_id == "staffing_path" else _sql_pred_to_cypher(seg, "t")

    hop_match = ""
    dim_select = ""
    if measure_id == "why_breakdown" or (frame.path == "catalog" and frame.shape in {"breakdown", "ranking"}):
        if not frame.group_by:
            raise ValueError("why_breakdown needs group_by")
        hops: list[str] = []
        returns: list[str] = []
        allowed = set(card.get("allowed_dimensions") or [])
        for name in frame.group_by:
            if name in CALENDAR_DIMS:
                raise ValueError(KG_CALENDAR_ERROR)
            if allowed and name not in allowed:
                raise ValueError(f"dimension {name} is not allowed on {measure_id}")
            if name not in KG_RETURN:
                raise ValueError(f"dimension {name} is not allowed on the graph")
            hop = KG_HOPS.get(name)
            if hop:
                hops.append(hop)
            returns.append(KG_RETURN[name])
        hop_match = "\n".join(hops)
        dim_select = " ".join(returns)

    max_rows = int((catalog.get("kg_neo4j") or {}).get("max_rows") or 500)
    limit = shape_row_limit(frame, cap=max_rows)

    raw = catalog["kg_cypher_files"][measure_id].read_text()
    compiled = fill_named(
        raw,
        {
            "scope_cypher": scope_clause,
            "time_cypher": time_clause,
            "segment_cypher": segment_clause,
            "hop_match": hop_match,
            "dimension_select": dim_select,
            "limit": str(limit),
        },
    )
    compiled = _collapse_true_and(compiled)
    compiled = re.sub(r"\n{3,}", "\n\n", compiled).strip()
    compiled = cap_limit(compiled, max_rows)
    assert_read_only_cypher(compiled)
    assert_allowlist(compiled, catalog.get("kg_schema"))
    assert_product_fence(compiled)
    echo = f"{measure_id}; scope {frame.scope.level}; {echo_time}"
    return compiled, params, echo
