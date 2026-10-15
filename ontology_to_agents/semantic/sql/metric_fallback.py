"""Execute certified metrics via pre-approved SQL templates."""

from __future__ import annotations

import re
from typing import Any

from semantic.lookup import get_metric_policy
from semantic.sql.executors.base import _filter_clause
from semantic.sql.job import ExecutorJob
from semantic.sql.metric_template_registry import get_template
from semantic.sql.validator import validate_readonly_sql

_GLUED_EOD = re.compile(r"\s+23:59:59(?:\.\d+)?$")
_ISO_PREFIX = re.compile(r"^(\d{4}-\d{2}-\d{2})")


def _calendar_date_bind(raw: object) -> str | None:
    if raw is None or raw == "":
        return None
    s = _GLUED_EOD.sub("", str(raw).strip())
    m = _ISO_PREFIX.match(s)
    if m:
        return m.group(1)
    return s[:10] if len(s) >= 10 else s


def execute_metric_fallback(job: ExecutorJob) -> dict[str, Any]:
    if not job.metric_id:
        raise ValueError("metric_fallback requires metric_id")
    spec = get_template(job.product, job.metric_id)
    if not spec:
        raise ValueError(
            f"No SQL template for metric '{job.metric_id}' (product={job.product})"
        )

    sql = str(spec.get("sql") or "").strip()
    if not sql:
        raise ValueError(f"Empty template for metric '{job.metric_id}'")

    product = str(job.product or "").lower()
    is_wt = product in ("webtracking", "web_tracking")
    if is_wt and job.engine != "clickhouse":
        raise ValueError(
            f"webtracking metrics must execute on ClickHouse (got engine={job.engine!r})"
        )

    time_col = str(spec.get("time_column") or job.time_column or "created_at")
    time_sessions = str(spec.get("time_column_sessions") or "started_at")
    time_events = str(spec.get("time_column_events") or "created_at")

    metric_table = str(spec.get("table") or "")
    where_default, params_default = _build_extra_where(
        job, time_col, include_website=is_wt, table=metric_table
    )
    where_sessions, params_sessions = _build_extra_where(
        job, time_sessions, include_website=is_wt, table=metric_table
    )
    where_events, params_events = _build_extra_where(
        job, time_events, include_website=is_wt, table=metric_table
    )

    org = str(job.organization_id)
    sql = _replace_org_where(
        sql,
        org=org,
        where_default=where_default,
        params_default=params_default,
        where_sessions=where_sessions,
        params_sessions=params_sessions,
        where_events=where_events,
        params_events=params_events,
        inline=(job.engine == "clickhouse"),
    )

    bound_params: list[object] = []
    if job.engine != "clickhouse":
        # Non-CH still uses %s — rebuild with markers (postgres products)
        sql = str(spec.get("sql") or "").strip()
        sql, bound_params = _replace_org_where_params(
            sql,
            org=org,
            where_default=where_default,
            params_default=params_default,
            where_sessions=where_sessions,
            params_sessions=params_sessions,
            where_events=where_events,
            params_events=params_events,
        )

    if job.group_by:
        sql = _rewrite_groupby(sql, job, spec)

    validate_readonly_sql(sql)

    if job.engine == "clickhouse":
        from semantic.sql.db import run_clickhouse_query

        rows = run_clickhouse_query(sql, [])
    else:
        from semantic.sql.db import run_postgres_query

        rows = run_postgres_query(sql, bound_params)

    metric_col = str(spec.get("result_column") or job.metric_id)
    group_cols = [str(c) for c in (job.group_by or [])]
    out_rows: list[dict[str, Any]] = []
    for row in rows:
        if group_cols:
            item = {c: row.get(c) for c in group_cols}
            item[metric_col] = row.get(metric_col, row.get("value"))
            out_rows.append(item)
        else:
            out_rows.append({metric_col: row.get(metric_col, row.get("value"))})

    pol = get_metric_policy(job.metric_id, product=job.product)
    if not out_rows and spec.get("default_zero") and not group_cols:
        out_rows = [{metric_col: 0}]
    elif (
        out_rows
        and not group_cols
        and out_rows[0].get(metric_col) is None
        and (pol.get("kind") == "rate" or spec.get("default_zero"))
    ):
        out_rows[0][metric_col] = 0

    return {
        "rows": out_rows,
        "rowCount": len(out_rows),
        "sql": sql,
        "metricId": job.metric_id,
    }


def _sql_literal(val: object) -> str:
    if val is None:
        return "NULL"
    if isinstance(val, bool):
        return "1" if val else "0"
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val).replace("\\", "\\\\").replace("'", "\\'")
    return f"'{s}'"


def _inline_where(where: str, params: list[object]) -> str:
    if not where:
        return ""
    if not params:
        return where
    parts = where.split("%s")
    if len(parts) - 1 != len(params):
        raise ValueError(
            f"where/param mismatch: placeholders={len(parts)-1} params={len(params)}"
        )
    out: list[str] = []
    for i, chunk in enumerate(parts[:-1]):
        out.append(chunk)
        out.append(_sql_literal(params[i]))
    out.append(parts[-1])
    return "".join(out)


def _replace_org_where(
    sql: str,
    *,
    org: str,
    where_default: str,
    params_default: list[object],
    where_sessions: str,
    params_sessions: list[object],
    where_events: str,
    params_events: list[object],
    inline: bool,
) -> str:
    wd = _inline_where(where_default, params_default) if inline else where_default
    ws = _inline_where(where_sessions, params_sessions) if inline else where_sessions
    we = _inline_where(where_events, params_events) if inline else where_events

    def sub_org_token(token_where: str) -> None:
        nonlocal sql
        # s.organization_id = %s{{extra_where_X}} or organization_id = %s{{extra_where_X}}
        pass

    sql = re.sub(
        r"((?:s\.)?organization_id\s*=\s*)%s\{\{extra_where_sessions\}\}",
        rf"\g<1>{org}{ws}",
        sql,
    )
    sql = re.sub(
        r"((?:s\.)?organization_id\s*=\s*)%s\{\{extra_where_events\}\}",
        rf"\g<1>{org}{we}",
        sql,
    )
    sql = re.sub(
        r"((?:s\.)?organization_id\s*=\s*)%s\{\{extra_where\}\}",
        rf"\g<1>{org}{wd}",
        sql,
    )
    sql = sql.replace("{{extra_where_sessions}}", ws)
    sql = sql.replace("{{extra_where_events}}", we)
    sql = sql.replace("{{extra_where}}", wd)
    # Remaining bare organization_id = %s (no placeholder)
    if inline:
        sql = re.sub(
            r"((?:s\.)?organization_id\s*=\s*)%s",
            rf"\g<1>{org}",
            sql,
        )
    return sql


def _replace_org_where_params(
    sql: str,
    *,
    org: str,
    where_default: str,
    params_default: list[object],
    where_sessions: str,
    params_sessions: list[object],
    where_events: str,
    params_events: list[object],
) -> tuple[str, list[object]]:
    """Postgres path: keep %s and build params list in order.

    Uses a temporary org marker so bare ``organization_id = %s`` leftovers are
    not double-counted after ``%s{{extra_where}}`` expansion.
    """
    params: list[object] = []
    org_mark = "<<<ORG_PARAM>>>"

    def repl_sessions(m: re.Match[str]) -> str:
        params.append(org)
        params.extend(params_sessions)
        return m.group(1) + org_mark + where_sessions

    def repl_events(m: re.Match[str]) -> str:
        params.append(org)
        params.extend(params_events)
        return m.group(1) + org_mark + where_events

    def repl_default(m: re.Match[str]) -> str:
        params.append(org)
        params.extend(params_default)
        return m.group(1) + org_mark + where_default

    sql = re.sub(
        r"((?:s\.)?organization_id\s*=\s*)%s\{\{extra_where_sessions\}\}",
        repl_sessions,
        sql,
    )
    sql = re.sub(
        r"((?:s\.)?organization_id\s*=\s*)%s\{\{extra_where_events\}\}",
        repl_events,
        sql,
    )
    sql = re.sub(
        r"((?:s\.)?organization_id\s*=\s*)%s\{\{extra_where\}\}",
        repl_default,
        sql,
    )

    def repl_bare(m: re.Match[str]) -> str:
        params.append(org)
        return m.group(1) + org_mark

    # Bind org placeholders before orphan mustache filters so param order
    # matches SQL left-to-right (org %s, then time/filter %s from extra_where).
    sql = re.sub(r"((?:s\.)?organization_id\s*=\s*)%s", repl_bare, sql)

    # Orphan mustache (e.g. "... = %s AND col IS NOT NULL{{extra_where}}")
    if "{{extra_where_sessions}}" in sql:
        sql = sql.replace("{{extra_where_sessions}}", where_sessions)
        params.extend(params_sessions)
    if "{{extra_where_events}}" in sql:
        sql = sql.replace("{{extra_where_events}}", where_events)
        params.extend(params_events)
    if "{{extra_where}}" in sql:
        sql = sql.replace("{{extra_where}}", where_default)
        params.extend(params_default)

    sql = sql.replace(org_mark, "%s")
    return sql, params


def _qualify_where(where_sql: str, alias: str, columns: set[str]) -> str:
    out = where_sql
    for col in sorted(columns, key=len, reverse=True):
        out = re.sub(rf"(?<!\.)\b{re.escape(col)}\b", f"{alias}.{col}", out)
    return out


def _dim_join_sql(table: str, dims: list[str]) -> tuple[str, list[str]]:
    """LEFT JOINs for dims not on metric table. Returns (join_sql, select_exprs)."""
    from semantic.sql.webtracking_dim_catalog import (
        DimensionNotJoinable,
        join_key_for_tables,
        mart_has_dim,
        owner_mart_for_dim,
    )

    join_sql = ""
    dim_select: list[str] = []
    used_owners: dict[str, str] = {}
    extra_n = 0
    for d in dims:
        if mart_has_dim(table, d):
            dim_select.append(f"m.{d} AS {d}")
            continue
        owner = owner_mart_for_dim(d)
        key = join_key_for_tables(table, owner) if owner else None
        if not owner or not key:
            raise DimensionNotJoinable(d, table)
        alias = used_owners.get(owner)
        if alias is None:
            alias = f"j{len(used_owners)}"
            used_owners[owner] = alias
            join_sql += (
                f" LEFT JOIN (SELECT DISTINCT organization_id, website_id, "
                f"{key}, {d} FROM webtracking_marts.{owner}) AS {alias} "
                f"ON m.organization_id = {alias}.organization_id "
                f"AND m.website_id = {alias}.website_id "
                f"AND m.{key} = {alias}.{key}"
            )
        else:
            extra_n += 1
            alias = f"j{alias}_{extra_n}"
            join_sql += (
                f" LEFT JOIN (SELECT DISTINCT organization_id, website_id, "
                f"{key}, {d} FROM webtracking_marts.{owner}) AS {alias} "
                f"ON m.organization_id = {alias}.organization_id "
                f"AND m.website_id = {alias}.website_id "
                f"AND m.{key} = {alias}.{key}"
            )
        dim_select.append(f"{alias}.{d} AS {d}")
    return join_sql, dim_select


def _rewrite_groupby(sql: str, job: ExecutorJob, spec: dict[str, Any]) -> str:
    product = str(job.product or "").lower()
    is_wt = product in ("webtracking", "web_tracking")
    if is_wt:
        from semantic.sql.webtracking_dims import assert_safe_ident

        dims = [assert_safe_ident(d) for d in job.group_by]
    else:
        dims = []
        for d in job.group_by:
            n = str(d or "").strip()
            if "__" in n:
                n = n.split("__", 1)[-1]
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", n):
                raise ValueError(f"Unsafe group_by dimension: {d!r}")
            dims.append(n)
    metric_col = str(spec.get("result_column") or job.metric_id)
    limit = int(job.limit or 50)
    body = sql.rstrip().rstrip(";")
    if re.search(r"\bGROUP\s+BY\b", body, re.I):
        return sql

    table = str(spec.get("table") or "mart_web_sessions")
    join_sql = ""
    dim_select_sql = ", ".join(dims)
    if is_wt:
        join_sql, dim_sel = _dim_join_sql(table, dims)
        dim_select_sql = ", ".join(dim_sel)

    dim_list = ", ".join(dims)

    # Simple single-FROM templates only
    if (
        "SELECT\n        (" in body
        or "SELECT\n  (" in body
        or "LEFT JOIN" in body.upper()
        or body.upper().count("SELECT") > 1
    ):
        if not is_wt:
            raise ValueError(
                f"group_by not supported for complex metric '{job.metric_id}'"
            )
        where_m = re.search(r"(?is)\bWHERE\b(.*)$", body)
        where_sql = where_m.group(1).strip() if where_m else "1"
        agg = _simple_agg_for_metric(str(job.metric_id), metric_col)
        if not agg:
            raise ValueError(
                f"group_by not supported for complex metric '{job.metric_id}'"
            )
        if join_sql:
            from semantic.sql.webtracking_dim_catalog import load_webtracking_dim_catalog

            cols = set(load_webtracking_dim_catalog()["mart_dims"].get(table) or set())
            cols.update({"organization_id", "website_id", "started_at", "created_at"})
            where_sql = _qualify_where(where_sql, "m", cols)
            for col in ("session_id", "visitor_id", "is_bounce_flag", "page_view_count"):
                agg = re.sub(rf"(?<!\.)\b{col}\b", f"m.{col}", agg)
            return (
                f"SELECT {dim_select_sql}, {agg} AS {metric_col} "
                f"FROM webtracking_marts.{table} AS m{join_sql} "
                f"WHERE {where_sql} "
                f"GROUP BY {dim_list} "
                f"ORDER BY {metric_col} DESC "
                f"LIMIT {limit}"
            )
        return (
            f"SELECT {dim_list}, {agg} AS {metric_col} "
            f"FROM webtracking_marts.{table} "
            f"WHERE {where_sql} "
            f"GROUP BY {dim_list} "
            f"ORDER BY {metric_col} DESC "
            f"LIMIT {limit}"
        )

    agg_m = re.search(
        r"(?is)SELECT\s+(.*?)\s+AS\s+" + re.escape(metric_col),
        body,
    )
    from_m = re.search(r"(?is)\bFROM\b\s+(\S+)", body)
    if not (agg_m and from_m):
        raise ValueError(f"Cannot apply group_by to metric '{job.metric_id}'")
    from_pos = from_m.start()
    where_m = re.search(r"(?is)\bWHERE\b(.*)$", body[from_pos:])
    if not where_m:
        raise ValueError(f"Cannot apply group_by to metric '{job.metric_id}'")
    agg_sql = agg_m.group(1).strip()
    from_sql = from_m.group(1).strip()
    where_sql = where_m.group(1).strip()
    if join_sql:
        from semantic.sql.webtracking_dim_catalog import load_webtracking_dim_catalog

        cols = set(load_webtracking_dim_catalog()["mart_dims"].get(table) or set())
        cols.update(
            {
                "organization_id",
                "website_id",
                "started_at",
                "created_at",
                "last_seen_at",
            }
        )
        where_sql = _qualify_where(where_sql, "m", cols)
        agg_sql = _qualify_where(agg_sql, "m", cols)
        return (
            f"SELECT {dim_select_sql}, {agg_sql} AS {metric_col} "
            f"FROM {from_sql} AS m{join_sql} "
            f"WHERE {where_sql} "
            f"GROUP BY {dim_list} "
            f"ORDER BY {metric_col} DESC "
            f"LIMIT {limit}"
        )
    return (
        f"SELECT {dim_list}, {agg_sql} AS {metric_col} "
        f"FROM {from_sql} "
        f"WHERE {where_sql} "
        f"GROUP BY {dim_list} "
        f"ORDER BY {metric_col} DESC "
        f"LIMIT {limit}"
    )


def _simple_agg_for_metric(metric_id: str, metric_col: str) -> str | None:
    mapping = {
        "web_session_volume": "uniqExact(session_id)",
        "unique_visitors": "uniqExact(visitor_id)",
        "bounce_count": "sum(is_bounce_flag)",
        "bounce_rate": (
            "sum(is_bounce_flag) * 100.0 "
            "/ nullIf(uniqExactIf(session_id, page_view_count > 0), 0)"
        ),
        "total_clicks": None,  # not on sessions
        "page_views": None,
    }
    return mapping.get(metric_id)


def _build_extra_where(
    job: ExecutorJob,
    time_column: str,
    *,
    include_website: bool = False,
    table: str = "",
) -> tuple[str, list[object]]:
    parts: list[str] = []
    params: list[object] = []
    wid: int | None = None
    if include_website:
        from semantic.sql.webtracking_dims import resolve_website_id

        wid = resolve_website_id(job.prepared)
        if wid is not None:
            parts.append("website_id = %s")
            params.append(int(wid))
    if job.entitled_channels and job.channel_column:
        placeholders = ", ".join("%s" for _ in job.entitled_channels)
        parts.append(f"{job.channel_column} IN ({placeholders})")
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
                parts.append(frag)
                params.extend(frag_params)
        elif job.scope == "assignee" and job.row_scope_column:
            placeholders = ", ".join("%s" for _ in job.visible_user_ids)
            parts.append(f"{job.row_scope_column} IN ({placeholders})")
            params.extend([str(x) for x in job.visible_user_ids])
    prepared = job.prepared or {}
    time_spec = prepared.get("time") or {}
    period = str(time_spec.get("period") or "").lower()
    if period not in ("overall", "all_time", "all"):
        start_bind = _calendar_date_bind(time_spec.get("start"))
        end_bind = _calendar_date_bind(time_spec.get("end"))
        if start_bind:
            parts.append(f"{time_column} >= %s::date")
            params.append(start_bind)
        if end_bind:
            parts.append(f"{time_column} < (%s::date + interval '1 day')")
            params.append(end_bind)
    for flt in job.filters or []:
        from semantic.sql.webtracking_dims import assert_safe_ident

        col = assert_safe_ident(flt.column)
        use_subquery = False
        owner = ""
        join_key = ""
        if table and include_website:
            from semantic.sql.webtracking_dim_catalog import (
                DimensionNotJoinable,
                join_key_for_tables,
                mart_has_dim,
                owner_mart_for_dim,
            )

            if col not in ("website_id", "organization_id") and not mart_has_dim(
                table, col
            ):
                owner = owner_mart_for_dim(col) or ""
                join_key = join_key_for_tables(table, owner) if owner else ""
                if not owner or not join_key:
                    raise DimensionNotJoinable(col, table)
                use_subquery = True
        if job.engine == "clickhouse" and flt.op.lower() in (
            "contains",
            "ilike",
            "like",
        ):
            pred = f"positionCaseInsensitive(toString({col}), %s) > 0"
            pred_params: list[object] = [str(flt.values[0])]
        else:
            frag, pred_params = _filter_clause(flt)
            if job.engine == "clickhouse":
                frag = frag.replace('"', "")
            pred = frag
        if use_subquery:
            org = int(job.organization_id)
            site_pred = f" AND website_id = {int(wid)}" if wid is not None else ""
            parts.append(
                f"{join_key} IN (SELECT {join_key} FROM webtracking_marts.{owner} "
                f"WHERE organization_id = {org}{site_pred} AND {pred})"
            )
            params.extend(pred_params)
            continue
        parts.append(pred)
        params.extend(pred_params)
    if not parts:
        return "", []
    return " AND " + " AND ".join(parts), params
