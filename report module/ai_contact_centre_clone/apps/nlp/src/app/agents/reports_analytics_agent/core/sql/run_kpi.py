"""Fill a certified Contact Center template and run it. Bound params only."""

from __future__ import annotations

import re
from typing import Any

from ..access import AccessDenied, assert_scope_allowed, grant_for, normalize_role, normalize_scope_level
from ..analysis import occupancy_pct, percent_change, rate_one_decimal
from ..errors import AmbiguousName, UnmatchedName, public_message
from ..loader import PRODUCT_DIR, merge_effective
from ..resolve import resolve_filter_names
from ..time import TimeSpec, previous_equal_window, resolve_time
from .sql_guard import GuardError, guard_sql
from .templates import apply_slice_leftovers, dimension_slots, fill_dimension_slots, partition_slice

_COMMENT = re.compile(r"^--.*$", re.M)

_RATE_PAIRS = {
    "missed_rate": ("missed_n", "total_n"),
    "resolution_rate": ("resolved_n", "handled_n"),
    "transfer_rate": ("transferred_n", "handled_n"),
    "fcr": ("fcr_n", "resolved_n"),
    "reopen_rate": ("reopen_n", "resolved_n"),
    "bot_containment": ("contained_n", "handled_n"),
    "first_reply_sla": ("sla_n", "replies_n"),
    "queue_service_level": ("sl_n", "answered_n"),
    "abandonment_rate": ("abandoned_n", "queued_finished_n"),
    "failed_send_rate": ("failed_n", "outbound_visible_n"),
    "negative_sentiment_rate": ("negative_n", "with_sentiment_n"),
    "offer_accept_rate": ("accepted_n", "offered_n"),
    "bot_grounded_rate": ("grounded_n", "turns_n"),
    "copilot_acceptance_rate": ("accepted_n", "suggested_n"),
}


def _strip_comments(sql: str) -> str:
    return _COMMENT.sub("", sql).strip()


def _coerce_filter(name: str, value: Any, spec: dict[str, Any]) -> Any:
    if value is None:
        return None
    column = str(spec.get("column") or name)
    text = str(value).strip()
    if name == "customer_name" or "name" in name:
        if text and "%" not in text:
            text = f"%{text}%"
        return text
    if name == "channel" and text.lower() == "voice":
        return "call"
    low_col = column.lower()
    if "blocked" in name or low_col.endswith("boolean") or name in {
        "is_reopened",
        "is_bot_only",
        "customer_blocked",
        "grounded",
        "handoff_recommended",
        "copilot_accepted",
    }:
        if isinstance(value, bool):
            return value
        return text.lower() in {"1", "true", "t", "yes"}
    if name == "priority" or "priority" in low_col:
        try:
            return int(text)
        except ValueError:
            return text
    return value if not isinstance(value, str) else text


def _as_name_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    return [text] if text else []


def _keep_named_rows(rows: list[dict[str, Any]], labels: list[str]) -> list[dict[str, Any]]:
    needles = [str(x).strip().lower() for x in labels if str(x).strip()]
    if not needles:
        return rows
    kept: list[dict[str, Any]] = []
    for row in rows:
        hay = " ".join(
            str(row.get(key) or "")
            for key in ("agent", "queue", "team")
            if row.get(key) is not None
        ).lower()
        if not hay:
            hay = " ".join(str(v or "") for v in row.values()).lower()
        if any(needle in hay or hay in needle for needle in needles):
            kept.append(row)
    return kept


def _resolve_compare_labels(
    dsn: str,
    *,
    organization_id: int,
    mentions: list[str],
) -> list[str]:
    from ..resolve import resolve_agent_name, resolve_queue_name

    labels: list[str] = []
    for mention in mentions:
        try:
            labels.append(resolve_agent_name(dsn, organization_id=organization_id, mention=mention))
            continue
        except (UnmatchedName, AmbiguousName):
            pass
        try:
            labels.append(resolve_queue_name(dsn, organization_id=organization_id, mention=mention))
        except (UnmatchedName, AmbiguousName):
            labels.append(mention)
    return labels


def _attach_derived(kpi_id: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        item = dict(row)
        if kpi_id in _RATE_PAIRS:
            num_k, den_k = _RATE_PAIRS[kpi_id]
            item["rate_pct"] = rate_one_decimal(item.get(num_k), item.get(den_k))
        if kpi_id == "occupancy":
            item["rate_pct"] = occupancy_pct(item.get("busy_acw_seconds"), item.get("logged_in_seconds"))
        if kpi_id == "handled_change":
            item["change_pct"] = percent_change(item.get("handled_now"), item.get("handled_prev"))
        out.append(item)
    return out


def run_kpi(
    kpi_id: str,
    *,
    organization_id: int,
    user_id: int,
    role: str,
    queue_ids: list[int] | None = None,
    scope_level: str = "org",
    time_start: str | None = None,
    time_end: str | None = None,
    time_window: str | None = None,
    cmp_start: str | None = None,
    cmp_end: str | None = None,
    dimensions: list[str] | None = None,
    dimension: str | None = None,
    filters: dict[str, Any] | None = None,
    dsn: str | None = None,
    row_cap: int = 500,
) -> dict[str, Any]:
    catalog = merge_effective(organization_id)
    access = catalog["access"]
    role = normalize_role(role, access)
    scope_level = normalize_scope_level(scope_level, role, access)
    queue_ids = list(queue_ids or [])

    try:
        assert_scope_allowed(role, scope_level, access)
        if grant_for(role, scope_level, access) == "deny":
            raise AccessDenied(f"scope_denied: role '{role}' is denied scope '{scope_level}'.")
        if scope_level == "queue" and not queue_ids:
            raise AccessDenied("scope_denied: queue scope requires queue_ids from the UI.")
    except AccessDenied as exc:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "DENY",
            "error": str(exc),
            "rows": [],
        }

    kpis = catalog["kpis"]
    sql_files = catalog["sql_files"]
    if kpi_id not in kpis or kpi_id not in sql_files:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "REPLAN",
            "error": f"kpi_not_found: {kpi_id} is not in the certified KPI index.",
            "rows": [],
        }

    card = kpis[kpi_id]
    if card.get("admin_only") and role != "admin":
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "DENY",
            "error": f"scope_denied: KPI '{kpi_id}' is administrator-only.",
            "rows": [],
        }
    allowed_levels = card.get("allowed_scope_levels") or []
    if allowed_levels and scope_level not in allowed_levels:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "DENY",
            "error": f"scope_denied: KPI '{kpi_id}' does not allow scope '{scope_level}'.",
            "rows": [],
        }

    dim_list: list[str] = []
    if dimension:
        dim_list.append(dimension)
    dim_list.extend(dimensions or [])
    seen_raw: list[str] = []
    for d in dim_list:
        if d and d not in seen_raw:
            seen_raw.append(d)

    declared = card.get("filters") or {}
    incoming = dict(filters or {})
    listed_names: list[str] = []
    if "agent" in incoming:
        agent_names = _as_name_list(incoming.get("agent"))
        if len(agent_names) >= 2:
            incoming.pop("agent", None)
            listed_names = agent_names
        elif len(agent_names) == 1:
            incoming["agent"] = agent_names[0]
    try:
        seen, leftovers = partition_slice(seen_raw, card, kpi_id=kpi_id)
        seen, incoming, name_mentions = apply_slice_leftovers(
            leftovers, card, dims=seen, filters=incoming
        )
        for mention in listed_names:
            if mention not in name_mentions:
                name_mentions.append(mention)
        if name_mentions and "agent" in (card.get("allowed_dimensions") or []) and "agent" not in seen:
            seen.append("agent")
        dim_select, group_sql = dimension_slots(seen or None, card, kpi_id=kpi_id)
    except ValueError as exc:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "REPAIR",
            "error": str(exc),
            "rows": [],
        }
    unknown = [k for k in incoming if k not in declared]
    if unknown:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "REPAIR",
            "error": (
                f"unknown filter: {unknown} is not a declared slot on '{kpi_id}'. "
                "run_kpi does not append WHERE."
            ),
            "rows": [],
        }
    if dsn:
        try:
            incoming = resolve_filter_names(
                dsn, organization_id=organization_id, filters=incoming
            )
        except UnmatchedName as exc:
            return {
                "status": "error",
                "store": "sql",
                "kpi_id": kpi_id,
                "error_type": "REPLAN",
                "error": public_message(exc),
                "certified": True,
                "rows": [],
            }
        except AmbiguousName as exc:
            return {
                "status": "error",
                "store": "sql",
                "kpi_id": kpi_id,
                "error_type": "REPAIR",
                "error": public_message(exc),
                "certified": True,
                "rows": [],
            }

    compare_labels: list[str] = []
    if name_mentions:
        if dsn:
            compare_labels = _resolve_compare_labels(
                dsn, organization_id=organization_id, mentions=name_mentions
            )
        else:
            compare_labels = list(name_mentions)

    live = str(card.get("time_kind") or "") == "live"
    echo = "live (no date window)"
    start = end = None
    if not live:
        try:
            bounds = resolve_time(
                TimeSpec(expression=time_window, start=time_start, end=time_end)
            )
        except ValueError as exc:
            return {
                "status": "error",
                "store": "sql",
                "kpi_id": kpi_id,
                "error_type": "REPLAN",
                "error": str(exc),
                "rows": [],
            }
        start, end, echo = bounds.start, bounds.end, bounds.echo
        if card.get("compare") and start and end and not (cmp_start and cmp_end):
            prev_s, prev_e = previous_equal_window(start, end)
            cmp_start = prev_s.isoformat()
            cmp_end = prev_e.isoformat()

    params: dict[str, Any] = {
        "start": start,
        "end": end,
        "cmp_start": cmp_start,
        "cmp_end": cmp_end,
    }
    for name, spec in declared.items():
        raw = incoming.get(name)
        params[name] = _coerce_filter(name, raw, spec or {})

    raw_sql = _strip_comments(sql_files[kpi_id].read_text())
    try:
        compiled = fill_dimension_slots(raw_sql, dim_select, group_sql)
    except Exception as exc:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "REPLAN",
            "error": f"kpi_template_slot_error: {exc}",
            "rows": [],
        }

    try:
        guarded = guard_sql(
            compiled,
            role=role,
            organization_id=organization_id,
            user_id=user_id,
            queue_ids=queue_ids,
            params=params,
            row_cap=row_cap,
            product_dir=PRODUCT_DIR,
            apply_row_cap=bool(seen),
        )
    except GuardError as exc:
        return {
            "status": "error",
            "store": "sql",
            "kpi_id": kpi_id,
            "error_type": "REPAIR",
            "error": str(exc),
            "rows": [],
            "sql": compiled,
        }

    out: dict[str, Any] = {
        "status": "compiled",
        "store": "sql",
        "kpi_id": kpi_id,
        "sql": guarded.sql,
        "views": guarded.views,
        "time_echo": echo,
        "certified": True,
        "unit": str(card.get("unit") or ""),
        "rows": [],
    }
    if dsn:
        from .. import db as pg

        try:
            rows = pg.fetchall(dsn, guarded.sql, guarded.params)
            rows = _attach_derived(kpi_id, rows)
            if compare_labels:
                rows = _keep_named_rows(rows, compare_labels)
            out["rows"] = rows
            out["status"] = "ok"
        except Exception as exc:
            out["status"] = "error"
            out["error_type"] = "REPLAN"
            out["error"] = public_message(exc)
    return out
