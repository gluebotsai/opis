"""Build parameterized SELECT for ticketing operational tables."""

from __future__ import annotations

from sql_agent.catalog_loader import allowed_columns, get_table
from sql_agent.job import ExecutorJob, SqlFilter
from sql_agent.sql_filters import filter_clause
from sql_agent.time_window import bind_calendar_date, time_predicate_sql
from sql_agent.validator import SqlValidationError, quote_ident, validate_readonly_sql

_TICKETS_DEFAULT_SELECT = [
    "ticket_number",
    "subject",
    "status",
    "priority",
    "channel",
    "assignee_name",
    "resolver_name",
    "queue_name",
    "customer_name",
    "due_at",
    "created_at",
    "updated_at",
    "id",
]

_CDP_COLUMNS = frozenset(
    {"first_name", "last_name", "contact_type", "key_value", "key_type"}
)


def _table_alias(job: ExecutorJob) -> str:
    return "t" if job.table == "tickets" else "x"


def _scope_clause(job: ExecutorJob, alias: str) -> tuple[str, list[object]]:
    from sql_agent.ticketing_scope import is_ticketing_product, ticketing_row_scope_clause

    if not is_ticketing_product(job.product):
        return "", []
    return ticketing_row_scope_clause(
        scope_mode=job.scope,  # type: ignore[arg-type]
        visible_user_ids=job.visible_user_ids,
        row_scope_column=job.row_scope_column,
        role=str(job.caller_role or "agent"),
        dual_assignee_resolver=job.scope_dual_assignee_resolver,
        my_queue_ids=job.my_queue_ids,
        table_alias=alias,
    )


def _from_clause(job: ExecutorJob) -> tuple[str, str]:
    alias = _table_alias(job)
    schema = quote_ident(job.schema)
    table = quote_ident(job.table)
    parts = [f"{schema}.{table} AS {alias}"]

    if job.cdp_live and job.table == "tickets":
        parts.append(
            "JOIN ticketing.contact_profile AS cp "
            f"ON cp.id = {alias}.customer_id AND cp.organization_id = {alias}.organization_id"
        )
        if job.cdp_email:
            parts.append(
                "JOIN cdp.identity_keys AS ik "
                "ON ik.cdp_id = cp.cdp_id AND ik.organization_id = cp.organization_id "
                "AND ik.key_type = 'email'"
            )
        else:
            parts.append(
                "JOIN cdp.customer_profile AS cdp "
                "ON cdp.cdp_id = cp.cdp_id AND cdp.organization_id = cp.organization_id"
            )
    return " ".join(parts), alias


def _allowed_columns(job: ExecutorJob) -> set[str]:
    tbl = get_table(job.product, job.table)
    cols = set(allowed_columns(tbl))
    if job.cdp_live and job.table == "tickets":
        cols.update(_CDP_COLUMNS)
    return cols


def _qualify_column(col: str, alias: str, job: ExecutorJob) -> str:
    if col in _CDP_COLUMNS and job.cdp_live:
        if col in ("key_value", "key_type"):
            return f"ik.{quote_ident(col)}"
        return f"cdp.{quote_ident(col)}"
    return f"{alias}.{quote_ident(col)}"


def _append_filter(
    flt: SqlFilter,
    *,
    alias: str,
    job: ExecutorJob,
    clauses: list[str],
    params: list[object],
) -> None:
    col_ref = _qualify_column(flt.column, alias, job)
    frag, flt_params = filter_clause(flt, column_sql=col_ref)
    clauses.append(frag)
    params.extend(flt_params)


_TIME_COLUMNS = frozenset({"created_at", "updated_at", "resolved_at", "due_at", "first_response_at"})
_TIME_GRAINS = {"day": "day", "week": "week", "month": "month", "hour": "hour"}


def _append_time_filters(
    job: ExecutorJob,
    *,
    alias: str,
    clauses: list[str],
    params: list[object],
    time_column: str = "created_at",
) -> None:
    col = quote_ident(time_column)
    ref = f"{alias}.{col}"
    if job.time_start and job.time_end:
        clauses.append(time_predicate_sql(ref))
        params.append(bind_calendar_date(job.time_start))
        params.append(bind_calendar_date(job.time_end))
        return
    if job.time_start:
        clauses.append(f"{ref} >= %s::date")
        params.append(bind_calendar_date(job.time_start))
    if job.time_end:
        clauses.append(f"{ref} < (%s::date + interval '1 day')")
        params.append(bind_calendar_date(job.time_end))


def _group_expression(col: str, alias: str, job: ExecutorJob) -> str:
    base = _qualify_column(col, alias, job)
    grain = (job.time_grain or "").strip().lower()
    if grain in _TIME_GRAINS and col in _TIME_COLUMNS:
        return f"date_trunc('{_TIME_GRAINS[grain]}', {base})"
    return base


def build_ticketing_list_sql(job: ExecutorJob) -> tuple[str, list[object]]:
    from_clause, alias = _from_clause(job)
    tbl = get_table(job.product, job.table)
    tenant_col = quote_ident(str(tbl.get("tenant_column") or "organization_id"))
    allowed = _allowed_columns(job)

    cols = job.select or (
        _TICKETS_DEFAULT_SELECT if job.table == "tickets" else ["*"]
    )
    if cols == ["*"]:
        select_sql = f"{alias}.*"
    else:
        for c in cols:
            if c not in allowed:
                raise SqlValidationError(f"Column '{c}' not allowed on {job.table}")
        select_sql = ", ".join(_qualify_column(c, alias, job) for c in cols)

    clauses = [f"{alias}.{tenant_col} = %s"]
    params: list[object] = [str(job.organization_id)]

    if job.entitled_channels and job.channel_column:
        ch_ref = _qualify_column(job.channel_column, alias, job)
        placeholders = ", ".join("%s" for _ in job.entitled_channels)
        clauses.append(f"{ch_ref} IN ({placeholders})")
        params.extend(job.entitled_channels)

    scope_frag, scope_params = _scope_clause(job, alias)
    if scope_frag:
        clauses.append(scope_frag)
        params.extend(scope_params)

    if job.cdp_live and job.cdp_email:
        clauses.append("lower(ik.key_value) = lower(%s)")
        params.append(str(job.cdp_email))

    _append_time_filters(
        job,
        alias=alias,
        clauses=clauses,
        params=params,
        time_column=job.time_column or "created_at",
    )

    for flt in job.filters:
        if flt.column not in allowed:
            raise SqlValidationError(f"Filter column '{flt.column}' not allowed")
        _append_filter(flt, alias=alias, job=job, clauses=clauses, params=params)

    sql = f"SELECT {select_sql} FROM {from_clause} WHERE {' AND '.join(clauses)}"
    # LIMIT always requires ORDER BY (deterministic pages)
    order_parts = _order_by_sql(job, alias=alias, allowed=allowed)
    sql += f" ORDER BY {order_parts}"
    sql += f" LIMIT {int(job.limit)}"
    validate_readonly_sql(sql)
    return sql, params


def _order_by_sql(job: ExecutorJob, *, alias: str, allowed: set[str]) -> str:
    """Build ORDER BY clause; default entity sort when job.order_by empty."""
    if job.order_by:
        parts = []
        for ob in job.order_by:
            bits = ob.strip().split()
            col = bits[0]
            direction = bits[1].upper() if len(bits) > 1 else "ASC"
            if direction not in ("ASC", "DESC"):
                direction = "ASC"
            if col == "priority_rank":
                # urgent/high first, then medium, low
                parts.append(
                    f"CASE lower({alias}.{quote_ident('priority')}) "
                    f"WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 "
                    f"WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END {direction}"
                )
                continue
            if col not in allowed:
                continue
            parts.append(f"{_qualify_column(col, alias, job)} {direction}")
        if parts:
            return ", ".join(parts)
    # Priority-aware default when instruction mentions priority (set via order_by upstream)
    if job.table == "tickets" and "created_at" in allowed:
        return f"{alias}.{quote_ident('created_at')} DESC"
    if "created_at" in allowed:
        return f"{alias}.{quote_ident('created_at')} DESC"
    if "updated_at" in allowed:
        return f"{alias}.{quote_ident('updated_at')} DESC"
    # Last resort: first allowed column
    first = next(iter(sorted(allowed)), "id")
    return f"{alias}.{quote_ident(first)} DESC"


def build_ticketing_count_sql(job: ExecutorJob) -> tuple[str, list[object]]:
    """SELECT COUNT(*)::bigint AS row_count with filters + scope (no LIMIT rows)."""
    from_clause, alias = _from_clause(job)
    tbl = get_table(job.product, job.table)
    tenant_col = quote_ident(str(tbl.get("tenant_column") or "organization_id"))
    allowed = _allowed_columns(job)

    clauses = [f"{alias}.{tenant_col} = %s"]
    params: list[object] = [str(job.organization_id)]

    if job.entitled_channels and job.channel_column:
        ch_ref = _qualify_column(job.channel_column, alias, job)
        placeholders = ", ".join("%s" for _ in job.entitled_channels)
        clauses.append(f"{ch_ref} IN ({placeholders})")
        params.extend(job.entitled_channels)

    scope_frag, scope_params = _scope_clause(job, alias)
    if scope_frag:
        clauses.append(scope_frag)
        params.extend(scope_params)

    if job.cdp_live and job.cdp_email:
        clauses.append("lower(ik.key_value) = lower(%s)")
        params.append(str(job.cdp_email))

    _append_time_filters(
        job,
        alias=alias,
        clauses=clauses,
        params=params,
        time_column=job.time_column or "created_at",
    )

    for flt in job.filters:
        if flt.column not in allowed:
            raise SqlValidationError(f"Filter column '{flt.column}' not allowed")
        _append_filter(flt, alias=alias, job=job, clauses=clauses, params=params)

    sql = (
        f"SELECT COUNT(*)::bigint AS row_count FROM {from_clause} "
        f"WHERE {' AND '.join(clauses)}"
    )
    validate_readonly_sql(sql)
    return sql, params


def build_ticketing_group_sql(job: ExecutorJob) -> tuple[str, list[object]]:
    if not job.group_by:
        raise SqlValidationError("group_count job requires group_by columns")
    from_clause, alias = _from_clause(job)
    tbl = get_table(job.product, job.table)
    tenant_col = quote_ident(str(tbl.get("tenant_column") or "organization_id"))
    allowed = _allowed_columns(job)

    group_cols = []
    for col in job.group_by:
        if col not in allowed and col not in _TIME_COLUMNS:
            raise SqlValidationError(f"group_by column '{col}' not allowed")
        group_cols.append(_group_expression(col, alias, job))

    select_parts = [
        f"{gc} AS {quote_ident(job.group_by[i])}" for i, gc in enumerate(group_cols)
    ]
    select_parts.append("COUNT(*)::bigint AS ticket_count")
    select_sql = ", ".join(select_parts)

    clauses = [f"{alias}.{tenant_col} = %s"]
    params: list[object] = [str(job.organization_id)]

    scope_frag, scope_params = _scope_clause(job, alias)
    if scope_frag:
        clauses.append(scope_frag)
        params.extend(scope_params)

    if job.cdp_live and job.cdp_email:
        clauses.append("lower(ik.key_value) = lower(%s)")
        params.append(str(job.cdp_email))

    _append_time_filters(
        job,
        alias=alias,
        clauses=clauses,
        params=params,
        time_column=job.time_column or "created_at",
    )

    for flt in job.filters:
        if flt.column not in allowed:
            raise SqlValidationError(f"Filter column '{flt.column}' not allowed")
        _append_filter(flt, alias=alias, job=job, clauses=clauses, params=params)

    group_sql = ", ".join(group_cols)
    sql = (
        f"SELECT {select_sql} FROM {from_clause} "
        f"WHERE {' AND '.join(clauses)} "
        f"GROUP BY {group_sql} "
        f"ORDER BY ticket_count DESC "
        f"LIMIT {int(job.limit)}"
    )
    validate_readonly_sql(sql)
    return sql, params
