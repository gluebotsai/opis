"""Base executor: build parameterized list SQL from ExecutorJob."""

from __future__ import annotations

from sql_agent.catalog_loader import allowed_columns, get_table
from sql_agent.job import ExecutorJob, SqlFilter
from sql_agent.validator import SqlValidationError, quote_ident, validate_readonly_sql


def _filter_clause(flt: SqlFilter) -> tuple[str, list[object]]:
    """Return SQL fragment and bound params (psycopg2 %s placeholders only)."""
    col = quote_ident(flt.column)
    op = flt.op.lower()
    if op in ("eq", "="):
        return f"{col} = %s", [flt.values[0]]
    if op in ("neq", "!="):
        return f"{col} != %s", [flt.values[0]]
    if op in ("in",):
        placeholders = ", ".join("%s" for _ in flt.values)
        return f"{col} IN ({placeholders})", list(flt.values)
    if op in ("contains", "ilike", "like"):
        needle = f"%{flt.values[0]}%"
        return f"{col} ILIKE %s", [needle]
    raise SqlValidationError(f"Unsupported filter op: {flt.op}")


def build_list_sql(job: ExecutorJob) -> tuple[str, list[object]]:
    tbl_meta = get_table(job.product, job.table)
    allowed = allowed_columns(tbl_meta)
    schema = quote_ident(job.schema)
    table = quote_ident(job.table)

    cols = job.select or ["*"]
    if cols != ["*"]:
        for c in cols:
            if c not in allowed:
                raise SqlValidationError(
                    f"Column '{c}' not allowed on {job.table}"
                )
        select_sql = ", ".join(quote_ident(c) for c in cols)
    else:
        select_sql = "*"

    clauses: list[str] = [
        f"{quote_ident(tbl_meta.get('tenant_column', 'organization_id'))} = %s"
    ]
    params: list[object] = [str(job.organization_id)]

    if job.entitled_channels and job.channel_column:
        ch_col = quote_ident(job.channel_column)
        placeholders = ", ".join("%s" for _ in job.entitled_channels)
        clauses.append(f"{ch_col} IN ({placeholders})")
        params.extend(job.entitled_channels)

    if job.scope in ("assignee", "created_by", "team") and job.visible_user_ids:
        from semantic.ticketing_scope import is_ticketing_product, ticketing_row_scope_clause

        if is_ticketing_product(job.product):
            frag, frag_params = ticketing_row_scope_clause(
                scope_mode=str(job.scope),
                visible_user_ids=job.visible_user_ids,
                row_scope_column=job.row_scope_column,
                role=str(job.caller_role or "agent"),
                dual_assignee_resolver=bool(job.scope_dual_assignee_resolver),
                my_queue_ids=list(getattr(job, "my_queue_ids", None) or []),
            )
            if frag:
                clauses.append(frag)
                params.extend(frag_params)
        elif job.scope == "assignee" and job.row_scope_column:
            sc = quote_ident(job.row_scope_column)
            placeholders = ", ".join("%s" for _ in job.visible_user_ids)
            clauses.append(f"{sc} IN ({placeholders})")
            params.extend(job.visible_user_ids)

    for flt in job.filters:
        if flt.column not in allowed:
            raise SqlValidationError(f"Filter column '{flt.column}' not allowed")
        frag, flt_params = _filter_clause(flt)
        clauses.append(frag)
        params.extend(flt_params)

    sql = f"SELECT {select_sql} FROM {schema}.{table} WHERE {' AND '.join(clauses)}"
    if job.order_by:
        parts = []
        for ob in job.order_by:
            bits = ob.strip().split()
            col = quote_ident(bits[0])
            direction = bits[1].upper() if len(bits) > 1 else "ASC"
            if direction not in ("ASC", "DESC"):
                direction = "ASC"
            parts.append(f"{col} {direction}")
        sql += f" ORDER BY {', '.join(parts)}"
    sql += f" LIMIT {int(job.limit)}"

    validate_readonly_sql(sql)
    return sql, params


def _count_column(table_meta: dict) -> str:
    for col in table_meta.get("columns") or []:
        name = str(col.get("name") if isinstance(col, dict) else col)
        if name.endswith("_id"):
            return name
    return "*"


def build_count_sql(
    job: ExecutorJob,
    *,
    result_column: str = "count",
) -> tuple[str, list[object]]:
    """Parameterized COUNT for list-only volume queries without a metric template."""
    tbl_meta = get_table(job.product, job.table)
    schema = quote_ident(job.schema)
    table = quote_ident(job.table)
    count_expr = _count_column(tbl_meta)
    if count_expr == "*":
        select_sql = f"COUNT(*)::bigint AS {quote_ident(result_column)}"
    else:
        select_sql = (
            f"COUNT({quote_ident(count_expr)})::bigint AS {quote_ident(result_column)}"
        )

    clauses: list[str] = [
        f"{quote_ident(tbl_meta.get('tenant_column', 'organization_id'))} = %s"
    ]
    params: list[object] = [str(job.organization_id)]

    if job.entitled_channels and job.channel_column:
        ch_col = quote_ident(job.channel_column)
        placeholders = ", ".join("%s" for _ in job.entitled_channels)
        clauses.append(f"{ch_col} IN ({placeholders})")
        params.extend(job.entitled_channels)

    if job.scope in ("assignee", "created_by", "team") and job.visible_user_ids:
        from semantic.ticketing_scope import is_ticketing_product, ticketing_row_scope_clause

        if is_ticketing_product(job.product):
            frag, frag_params = ticketing_row_scope_clause(
                scope_mode=str(job.scope),
                visible_user_ids=job.visible_user_ids,
                row_scope_column=job.row_scope_column,
                role=str(job.caller_role or "agent"),
                dual_assignee_resolver=bool(job.scope_dual_assignee_resolver),
                my_queue_ids=list(getattr(job, "my_queue_ids", None) or []),
            )
            if frag:
                clauses.append(frag)
                params.extend(frag_params)
        elif job.scope == "assignee" and job.row_scope_column:
            sc = quote_ident(job.row_scope_column)
            placeholders = ", ".join("%s" for _ in job.visible_user_ids)
            clauses.append(f"{sc} IN ({placeholders})")
            params.extend(job.visible_user_ids)

    for flt in job.filters:
        allowed = allowed_columns(tbl_meta)
        if flt.column not in allowed:
            raise SqlValidationError(f"Filter column '{flt.column}' not allowed")
        frag, flt_params = _filter_clause(flt)
        clauses.append(frag)
        params.extend(flt_params)

    sql = f"SELECT {select_sql} FROM {schema}.{table} WHERE {' AND '.join(clauses)}"
    validate_readonly_sql(sql)
    return sql, params
