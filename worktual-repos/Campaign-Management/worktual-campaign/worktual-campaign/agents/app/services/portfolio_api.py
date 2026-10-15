"""Fetch Dashboard-parity portfolio totals from Campaign API."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings
from app.services.portfolio_metrics import totals_from_api_portfolio

logger = logging.getLogger(__name__)


def period_to_query_params(period: dict[str, Any] | None) -> dict[str, str]:
    """Map session/tool period to GET /campaigns/portfolio query params."""
    params: dict[str, str] = {"bucket": "all"}
    if not isinstance(period, dict):
        return params

    fd = str(
        period.get("fromDate") or period.get("from_date") or period.get("from") or ""
    ).strip()
    td = str(
        period.get("toDate") or period.get("to_date") or period.get("to") or ""
    ).strip()
    if fd:
        params["from"] = fd
    if td:
        params["to"] = td
    if fd and td:
        return params

    rel = str(period.get("relative") or "").strip().lower()
    mapping = {
        "today": "today",
        "yesterday": "yesterday",
        "weekly": "last_7_days",
        "last_7_days": "last_7_days",
        "last_week": "last_7_days",
        "monthly": "last_month",
        "last_month": "last_month",
    }
    rel = mapping.get(rel, rel)
    if rel in ("today", "yesterday", "last_7_days", "last_month"):
        params["relative"] = rel
    return params


async def fetch_portfolio_totals(
    token: str,
    period: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Same totals as Dashboard Overview + LIST_MONITOR totals_all_matched."""
    base = get_settings().campaign_api_base.rstrip("/")
    params = period_to_query_params(period)
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.get(
                f"{base}/campaigns/portfolio",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            res.raise_for_status()
            body = res.json()
    except httpx.HTTPError as exc:
        logger.warning("portfolio GET failed: %s", exc)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("portfolio fetch error: %s", exc)
        return None

    data = body.get("data") if isinstance(body.get("data"), dict) else body
    raw = data.get("portfolio_totals") if isinstance(data, dict) else None
    totals = totals_from_api_portfolio(raw if isinstance(raw, dict) else None)
    if not totals:
        return None
    totals["campaigns_matched"] = int(
        (data.get("campaigns_matched") if isinstance(data, dict) else 0) or 0
    )
    totals["period_filter"] = dict(params)
    if isinstance(data, dict):
        if data.get("scope_applied"):
            totals["scope_applied"] = data.get("scope_applied")
        if data.get("scope_label"):
            totals["scope_label"] = data.get("scope_label")
    return totals


async def fetch_dashboard_monitoring_counts(token: str) -> dict[str, Any] | None:
    """Monitoring tab badges — Live/Scheduled/Draft/Past (all-time)."""
    base = get_settings().campaign_api_base.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{base}/campaigns/dashboard",
                headers={"Authorization": f"Bearer {token}"},
            )
            res.raise_for_status()
            body = res.json()
    except httpx.HTTPError as exc:
        logger.warning("dashboard counts GET failed: %s", exc)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("dashboard counts error: %s", exc)
        return None

    data = body.get("data") if isinstance(body.get("data"), dict) else body
    counts = data.get("counts") if isinstance(data, dict) else None
    if not isinstance(counts, dict):
        return None
    return {
        "live": int(counts.get("live") or 0),
        "scheduled": int(counts.get("scheduled") or 0),
        "draft": int(counts.get("draft") or 0),
        "past_all_time": int(counts.get("past") or 0),
        "on_demand": int(counts.get("onDemand") or counts.get("on_demand") or 0),
    }


def resolve_report_period(
    session: dict[str, Any] | None,
    args: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """Dashboard session period, then explicit tool args (same as reports handlers)."""
    args = args or {}
    rel = str(args.get("relative") or "").strip().lower()
    if rel:
        out: dict[str, Any] = {"relative": rel}
        fd = str(args.get("from_date") or args.get("fromDate") or "").strip()
        td = str(args.get("to_date") or args.get("toDate") or "").strip()
        if fd:
            out["fromDate"] = fd
        if td:
            out["toDate"] = td
        return out
    fd = str(args.get("from_date") or args.get("fromDate") or "").strip()
    td = str(args.get("to_date") or args.get("toDate") or "").strip()
    if fd or td:
        out: dict[str, Any] = {}
        if fd:
            out["fromDate"] = fd
        if td:
            out["toDate"] = td
        return out

    period = _session_dashboard_period(session)
    if not period:
        return None
    fd = str(
        period.get("from_date") or period.get("fromDate") or period.get("from") or ""
    ).strip()
    td = str(
        period.get("to_date") or period.get("toDate") or period.get("to") or ""
    ).strip()
    if fd and td:
        return {"fromDate": fd, "toDate": td}
    out: dict[str, Any] = {}
    rel = str(period.get("relative") or "").strip().lower()
    range_key = str(period.get("range") or "").strip().lower()
    mapping = {
        "today": "today",
        "yesterday": "yesterday",
        "weekly": "last_7_days",
        "last_7_days": "last_7_days",
        "monthly": "last_month",
        "last_30_days": "last_30_days",
        "last_month": "last_month",
    }
    if not rel and range_key:
        rel = mapping.get(range_key, "")
    if rel and range_key not in ("all", "custom"):
        out["relative"] = rel
    return out or None


def _session_dashboard_period(session: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(session, dict):
        return None
    snap = session.get("dashboard_snapshot")
    if isinstance(snap, dict):
        nested = snap.get("dashboard_period")
        if isinstance(nested, dict):
            return nested
    period = session.get("dashboard_period")
    return period if isinstance(period, dict) else None


def merge_portfolio_performance_args(
    session: dict[str, Any],
    args: dict[str, Any],
) -> dict[str, str | None]:
    """Tool args override session dashboard_period (Overview parity)."""
    period = _session_dashboard_period(session) or {}
    relative = str(args.get("relative") or "").strip() or None
    from_date = str(args.get("from_date") or args.get("fromDate") or "").strip() or None
    to_date = str(args.get("to_date") or args.get("toDate") or "").strip() or None
    activity_from = str(args.get("activity_from_date") or "").strip() or None
    activity_to = str(args.get("activity_to_date") or "").strip() or None
    channels = str(args.get("channels") or "").strip() or None
    if isinstance(period, dict):
        if not relative and period.get("relative"):
            relative = str(period.get("relative") or "").strip() or None
        if not from_date:
            from_date = (
                str(
                    period.get("from_date")
                    or period.get("fromDate")
                    or period.get("from")
                    or ""
                ).strip()
                or None
            )
        if not to_date:
            to_date = (
                str(
                    period.get("to_date")
                    or period.get("toDate")
                    or period.get("to")
                    or ""
                ).strip()
                or None
            )
        if not activity_from and period.get("activity_from"):
            activity_from = str(period.get("activity_from") or "").strip() or None
        if not activity_to and period.get("activity_to"):
            activity_to = str(period.get("activity_to") or "").strip() or None
    if from_date and to_date:
        relative = None
    return {
        "relative": relative,
        "from_date": from_date,
        "to_date": to_date,
        "activity_from": activity_from,
        "activity_to": activity_to,
        "channels": channels,
    }


def normalize_dashboard_period(raw: Any) -> dict[str, Any] | None:
    """Shape FE dashboard_period for session storage (Overview dropdown)."""
    if not isinstance(raw, dict):
        return None
    return {
        "range": str(raw.get("range") or "").strip() or "today",
        "from": str(raw.get("from") or "").strip() or None,
        "to": str(raw.get("to") or "").strip() or None,
        "label": str(raw.get("label") or "").strip() or None,
        "relative": str(raw.get("relative") or "").strip() or None,
        "from_date": str(
            raw.get("from_date") or raw.get("fromDate") or raw.get("from") or ""
        ).strip()
        or None,
        "to_date": str(
            raw.get("to_date") or raw.get("toDate") or raw.get("to") or ""
        ).strip()
        or None,
        "activity_from": str(raw.get("activity_from") or "").strip() or None,
        "activity_to": str(raw.get("activity_to") or "").strip() or None,
    }


__all__ = [
    "fetch_dashboard_monitoring_counts",
    "fetch_portfolio_totals",
    "merge_portfolio_performance_args",
    "normalize_dashboard_period",
    "period_to_query_params",
    "resolve_report_period",
]

