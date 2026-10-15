"""Compile a Domain frame to read-only SQL."""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from .access import AccessDenied, apply_scope
from .checks import assert_read_only
from .dims import certified_group_sql, extra_filters_sql, in_list, segment_sql, shape_row_limit
from .errors import AmbiguousName, UnmatchedName
from .loader import merge_effective
from .prepare import prepare_frame
from .query_frame import Identity, QueryFrame, frame_from_dict
from .resolve import resolve_mention
from .templates import fill_slots
from .thresholds import evaluate
from .time import resolve_time, window_days

TIME_COLUMNS = {
    "note_count": "n.created_at",
    "escalation_count": "ae.created_at",
    "reassignment_count": "ae.created_at",
    "unread_notifications": "created_at",
    "kb_article_count": "created_at",
    "kb_views": "created_at",
    "recommendation_count": "created_at",
    "recommendation_acceptance_rate": "created_at",
    "approval_count": "created_at",
    "approval_rate": "created_at",
}
TICKET_SCOPED_EVENTS = {"note_count", "escalation_count", "reassignment_count"}


def _group_sql(frame: QueryFrame, card: dict[str, Any]) -> tuple[str, str]:
    if not frame.group_by:
        return "", ""
    allowed = set(card.get("allowed_dimensions") or [])
    date_col = frame.time.date_column or card.get("default_time_column") or "created_at"
    exprs: list[str] = []
    for name in frame.group_by:
        if allowed and name not in allowed:
            raise ValueError(f"dimension {name} is not allowed on {frame.measure}")
        exprs.append(certified_group_sql(name, date_col))
    select = ", ".join(f"{e} AS {a}" for e, a in zip(exprs, frame.group_by)) + ","
    group = "GROUP BY " + ", ".join(exprs)
    return select, group


def compile_frame(
    frame: QueryFrame,
    identity: Identity,
    *,
    resolved_targets: list[int] | None = None,
    filter_ids: dict[str, list[int]] | None = None,
) -> tuple[str, str]:
    from .compiler import compile_catalog, compile_roster, roster_id

    kwargs = {"resolved_targets": resolved_targets, "filter_ids": filter_ids}
    if frame.shape in {"list", "find"}:
        catalog = merge_effective(identity.organization_id)["catalog"]
        if roster_id(frame.measure, catalog):
            return compile_roster(frame, identity, **kwargs)
    if frame.shape in {"list", "find", "ranking"}:
        return compile_catalog(frame, identity, **kwargs)
    if frame.shape == "kpi" and frame.path == "catalog":
        if frame.group_by:
            return compile_catalog(replace(frame, shape="breakdown", path="catalog"), identity, **kwargs)
        try:
            return compile_certified(replace(frame, path="certified"), identity, **kwargs)
        except KeyError:
            return compile_catalog(replace(frame, shape="count", path="catalog"), identity, **kwargs)
    if frame.path == "certified" or frame.shape == "kpi":
        try:
            return compile_certified(replace(frame, path="certified"), identity, **kwargs)
        except KeyError:
            cat_shape = frame.shape if frame.shape in {"count", "breakdown"} else (
                "breakdown" if frame.group_by else "count"
            )
            return compile_catalog(replace(frame, path="catalog", shape=cat_shape), identity, **kwargs)
    return compile_catalog(frame, identity, **kwargs)


def compile_certified(
    frame: QueryFrame,
    identity: Identity,
    *,
    resolved_targets: list[int] | None = None,
    filter_ids: dict[str, list[int]] | None = None,
) -> tuple[str, str]:
    catalog = merge_effective(identity.organization_id)
    kpis = catalog["kpis"]
    if frame.measure not in kpis:
        raise ValueError(f"unknown measure {frame.measure}")
    card = kpis[frame.measure]
    allowed_levels = card.get("allowed_scope_levels") or []
    if allowed_levels and frame.scope.level not in allowed_levels:
        raise AccessDenied(f"{frame.measure} does not allow scope {frame.scope.level}.")
    scope = apply_scope(
        frame,
        identity,
        catalog["access"],
        kpi_id=frame.measure,
        target_ids=resolved_targets,
    )
    bounds = resolve_time(frame.time)
    date_col = frame.time.date_column or card.get("default_time_column") or "created_at"
    allowed_dates = set(card.get("allowed_date_columns") or [])
    if allowed_dates and date_col not in allowed_dates:
        date_col = card.get("default_time_column") or next(iter(allowed_dates))
    org_id = str(int(identity.organization_id))
    tenant_sql = f"organization_id = {org_id}"

    scope_sql = "TRUE"
    if frame.measure == "unread_notifications":
        if frame.scope.level == "own":
            scope_sql = f"user_id = {int(identity.user_id)}"
        elif frame.scope.level == "org":
            scope_sql = "TRUE"
        else:
            raise AccessDenied("Unread notifications only support org or own.")
    elif scope.get("column") and scope.get("ids"):
        col = scope["column"]
        if frame.measure in TICKET_SCOPED_EVENTS:
            col = f"t.{col}"
        scope_sql = in_list(col, scope["ids"])
    if scope.get("queue_ids") and frame.measure != "unread_notifications":
        qcol = "t.queue_id" if frame.measure in TICKET_SCOPED_EVENTS else "queue_id"
        extra = in_list(qcol, scope["queue_ids"])
        scope_sql = f"({scope_sql}) AND {extra}" if scope_sql != "TRUE" else extra

    time_sql = "TRUE"
    echo_time = bounds.echo
    date_sql = TIME_COLUMNS.get(frame.measure, date_col)
    if bounds.start is not None and bounds.end is not None:
        time_sql = (
            f"{date_sql} >= TIMESTAMPTZ '{bounds.start.isoformat()}' "
            f"AND {date_sql} < TIMESTAMPTZ '{bounds.end.isoformat()}'"
        )

    seg = segment_sql(card, catalog["catalog"], frame)
    if frame.measure == "csat_distribution_rate" and seg == "TRUE":
        seg = str((card.get("segments") or {}).get("promoter") or "csat_score >= 4")

    dim_select, group_sql = _group_sql(frame, card)
    filters_sql = extra_filters_sql(
        frame,
        filter_ids,
        compare_fields=(catalog.get("catalog") or {}).get("compare_fields"),
    )
    if bounds.start is None:
        window_days_sql = "GREATEST(1.0, EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 86400.0)"
    else:
        window_days_sql = str(window_days(bounds))

    sql_path = catalog["sql_files"][frame.measure]
    raw = sql_path.read_text()
    base_filled = fill_slots(
        catalog["base_ticket_sql"],
        {"org_id": org_id, "tenant_sql": f"t.organization_id = {org_id}"},
    )
    compiled = fill_slots(
        raw,
        {
            "org_id": org_id,
            "tenant_sql": tenant_sql,
            "scope_sql": scope_sql,
            "time_sql": time_sql,
            "segment_sql": seg,
            "filters_sql": filters_sql,
            "dimension_select": dim_select,
            "group_by_sql": group_sql,
            "window_days": window_days_sql,
            "window_days_sql": window_days_sql,
            "segment_predicate": seg,
            "limit_sql": (
                f"LIMIT {shape_row_limit(frame)}"
                if frame.group_by and (frame.shape == "ranking" or frame.limit is not None)
                else ""
            ),
        },
        base_ticket=base_filled if "{{base_ticket}}" in raw else None,
    )
    assert_read_only(compiled)
    echo = f"{frame.measure}; scope {frame.scope.level}; {echo_time}"
    return compiled, echo


def bind_names(
    frame: QueryFrame,
    identity: Identity,
    *,
    fetch=None,
    resolved_targets: list[int] | None = None,
    filter_ids: dict[str, list[int]] | None = None,
) -> tuple[list[int] | None, dict[str, list[int]]]:
    targets = resolved_targets
    if (
        targets is None
        and frame.scope.level in {"queue", "agent", "resolver"}
        and frame.scope.target_mention
    ):
        result = resolve_mention(
            frame.scope.level, frame.scope.target_mention, identity.organization_id, fetch=fetch
        )
        if result.unmatched:
            raise UnmatchedName(frame.scope.level, result.unmatched)
        if result.ambiguous:
            raise AmbiguousName(frame.scope.level, frame.scope.target_mention, result.ambiguous)
        targets = result.ids
    bound = dict(filter_ids or {})
    return targets, bound


def _first_numeric(rows: list[dict[str, Any]]) -> float | None:
    if not rows:
        return None
    for val in rows[0].values():
        if isinstance(val, bool):
            continue
        if isinstance(val, (int, float)):
            return float(val)
    return None


def execute_frame(
    frame: QueryFrame | dict[str, Any],
    identity: Identity,
    *,
    fetch=None,
    dsn: str | None = None,
    run: bool = False,
    resolved_targets: list[int] | None = None,
    filter_ids: dict[str, list[int]] | None = None,
    value: float | None = None,
) -> dict[str, Any]:
    """Compile a SQL job. With dsn+run, also fetch rows (read-only)."""
    from .errors import public_message

    if isinstance(frame, dict):
        frame = frame_from_dict(frame)
    frame = prepare_frame(frame)
    if fetch is None and dsn:
        from . import db as pg

        def fetch(sql: str, params: tuple[Any, ...], _dsn: str = dsn) -> list[dict[str, Any]]:
            return pg.fetchall(_dsn, sql, params)

    try:
        targets, bound_filters = bind_names(
            frame,
            identity,
            fetch=fetch,
            resolved_targets=resolved_targets,
            filter_ids=filter_ids,
        )
        sql, echo = compile_frame(
            frame, identity, resolved_targets=targets, filter_ids=bound_filters
        )
    except (UnmatchedName, AmbiguousName, AccessDenied):
        raise
    except Exception as exc:
        return {
            "status": "error",
            "store": "sql",
            "sql": "",
            "echo": "",
            "rows": [],
            "error": public_message(exc),
        }
    out: dict[str, Any] = {"status": "compiled", "store": "sql", "sql": sql, "echo": echo, "rows": []}
    if run and dsn:
        from . import db as pg

        try:
            rows = pg.fetchall(dsn, sql, ())
        except Exception as exc:
            out["status"] = "error"
            out["error"] = public_message(exc)
            return out
        out["rows"] = rows
        out["status"] = "ok"
        if value is None:
            value = _first_numeric(rows)
    if frame.check_thresholds:
        catalog = merge_effective(identity.organization_id)
        spec = (catalog.get("thresholds") or {}).get(frame.measure)
        segment = None
        for flt in frame.filters:
            if flt.field == "bucket":
                segment = flt.mention
        out["threshold_spec"] = spec
        out["threshold_level"] = evaluate(spec, value, segment=segment)
    return out
