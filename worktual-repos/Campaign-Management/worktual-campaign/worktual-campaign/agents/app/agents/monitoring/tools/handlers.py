"""Tool handlers for monitoring agent — call campaign API."""

from __future__ import annotations

from typing import Any, Awaitable, Callable

import httpx

from app.agents.routing import dispatch_route_to_module
from app.config import get_settings
from app.agents.monitoring.list_filters import (
    channel_rollup_count,
    is_ran_campaign_status,
    normalize_row_channels,
    row_includes_channel,
)
from app.services.portfolio_api import (
    fetch_portfolio_totals,
    period_to_query_params,
    resolve_report_period,
)
from app.services.portfolio_metrics import KPI_GLOSSARY, totals_from_api_portfolio
from app.agents.reports.org_context import (
    resolve_session_context,
    scope_note,
    scope_result_fields,
)
from app.session_store import get_or_create_session, save_session

ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _base() -> str:
    return get_settings().campaign_api_base.rstrip("/")


def _channel_key(raw: str) -> str:
    ch = str(raw or "").strip().lower()
    if ch in ("apppush", "app_push", "app-push"):
        return "push"
    return ch


def _pct_1(numerator: float, denominator: float) -> float | None:
    """Same display precision as Dashboard formatPct (one decimal)."""
    if not denominator:
        return None
    return round((numerator / denominator) * 100, 1)


def _rate_pct(numerator: float, denominator: float) -> float | None:
    """Engagement rate: unique numerator over delivered, capped at 100%."""
    pct = _pct_1(numerator, denominator)
    return None if pct is None else min(pct, 100.0)


def _pct_from_api_rate(raw: Any) -> float | None:
    """Campaign API openRate/clickRate are fractions 0…1."""
    if raw is None or raw == "":
        return None
    try:
        frac = float(raw)
    except (TypeError, ValueError):
        return None
    if frac > 1.0:
        return round(min(100.0, frac), 1)
    return round(min(100.0, frac * 100), 1)


_RATE_NOTE = (
    "open_rate_pct / click_rate_pct are already percentages matching the Dashboard "
    "(e.g. 40.7 means 40.7%). Speak them with a % sign. Do not divide or multiply "
    "them again. Rates are unique openers/clickers divided by delivered, so they "
    "never exceed 100%. total_opens / total_clicks include repeat hits from the "
    "same person and are counts, not rates. ctor_pct is clicks per opener."
)


def _aggregate_totals(items: list[dict[str, Any]], campaigns: int) -> dict[str, Any]:
    sent = sum(int(i.get("sent") or 0) for i in items)
    failed = sum(int(i.get("failed") or 0) for i in items)
    opens = sum(int(i.get("opens") or 0) for i in items)
    clicks = sum(int(i.get("clicks") or 0) for i in items)
    total_opens = sum(
        int(i.get("total_opens") or i.get("totalOpens") or i.get("opens") or 0)
        for i in items
    )
    total_clicks = sum(
        int(i.get("total_clicks") or i.get("totalClicks") or i.get("clicks") or 0)
        for i in items
    )
    impressions = sum(int(i.get("impressions") or 0) for i in items)
    spend = round(sum(float(i.get("spend") or 0) for i in items), 2)
    conversions = sum(int(i.get("conversions") or 0) for i in items)
    currency = next(
        (
            str(i.get("currency") or "").strip()
            for i in items
            if str(i.get("currency") or "").strip()
        ),
        None,
    )
    live_count = sum(
        1 for i in items if str(i.get("status") or "").strip().lower() == "live"
    )
    scheduled_count = sum(
        1
        for i in items
        if str(i.get("status") or "").strip().lower() == "scheduled"
    )
    open_rate_pct = _rate_pct(opens, sent)
    click_rate_pct = _rate_pct(clicks, sent)
    # Only percentage fields — never return fractions (LLM misreads 4.07 as 4.07%).
    return {
        "campaigns": campaigns,
        "live_count": live_count,
        "scheduled_count": scheduled_count,
        "sent": sent,
        "delivered": sent,
        "failed": failed,
        "opens": opens,
        "clicks": clicks,
        "total_opens": total_opens,
        "total_clicks": total_clicks,
        "impressions": impressions,
        "spend": spend,
        "conversions": conversions,
        "currency": currency or "INR",
        "open_rate_pct": open_rate_pct,
        "click_rate_pct": click_rate_pct,
        "ctor_pct": _rate_pct(clicks, opens),
        "open_rate_display": (
            f"{open_rate_pct}%" if open_rate_pct is not None else None
        ),
        "click_rate_display": (
            f"{click_rate_pct}%" if click_rate_pct is not None else None
        ),
        "note": _RATE_NOTE,
    }


def _report_summary(campaign: dict[str, Any]) -> dict[str, Any]:
    channels = list(campaign.get("channels") or [])
    sent = sum(int(c.get("sent") or 0) for c in channels)
    failed = sum(int(c.get("failed") or 0) for c in channels)
    opens = sum(int(c.get("opens") or 0) for c in channels)
    clicks = sum(int(c.get("clicks") or 0) for c in channels)
    total_opens = sum(
        int(c.get("totalOpens") or c.get("total_opens") or c.get("opens") or 0)
        for c in channels
    )
    total_clicks = sum(
        int(c.get("totalClicks") or c.get("total_clicks") or c.get("clicks") or 0)
        for c in channels
    )
    impressions = sum(int(c.get("impressions") or 0) for c in channels)
    spend = sum(float(c.get("spend") or 0) for c in channels)
    conversions = sum(int(c.get("conversions") or 0) for c in channels)
    to_send = sum(int(c.get("totalToSend") or c.get("total_to_send") or 0) for c in channels)
    stub = sum(int(c.get("stubSent") or c.get("stub_sent") or 0) for c in channels)
    pending = max(0, to_send - sent - failed - stub)
    currency = next(
        (
            str(c.get("currency") or "").strip()
            for c in channels
            if str(c.get("currency") or "").strip()
        ),
        "INR",
    )
    api_delivered = int(
        campaign.get("delivered")
        or campaign.get("emailSent")
        or campaign.get("email_sent")
        or sent
    )
    api_opens = int(
        campaign.get("emailOpens")
        or campaign.get("email_opens")
        or campaign.get("opens")
        or opens
    )
    api_clicks = int(
        campaign.get("emailClicks")
        or campaign.get("email_clicks")
        or campaign.get("clicks")
        or clicks
    )
    open_rate_pct = _pct_from_api_rate(
        campaign.get("openRate") if campaign.get("openRate") is not None else campaign.get("open_rate")
    )
    click_rate_pct = _pct_from_api_rate(
        campaign.get("clickRate")
        if campaign.get("clickRate") is not None
        else campaign.get("click_rate")
    )
    ctor_frac = campaign.get("ctor")
    ctor_pct = _pct_from_api_rate(ctor_frac) if ctor_frac is not None else _rate_pct(
        api_clicks, api_opens
    )
    if open_rate_pct is None:
        open_rate_pct = _rate_pct(api_opens, api_delivered)
    if click_rate_pct is None:
        click_rate_pct = _rate_pct(api_clicks, api_delivered)
    return {
        "campaign_id": campaign.get("id"),
        "name": campaign.get("name"),
        "status": campaign.get("status"),
        "goal": campaign.get("goal"),
        "objective": campaign.get("objective"),
        "audience_count": campaign.get("audienceCount")
        or campaign.get("audience_count")
        or 0,
        "audience_summary": campaign.get("audienceSummary")
        or campaign.get("audience_summary"),
        "totals": {
            "to_send": to_send,
            "sent": sent,
            "stub": stub
            or int(campaign.get("stubSent") or campaign.get("stub_sent") or 0),
            "failed": failed,
            "pending": pending,
            "delivered": api_delivered,
            "opens": api_opens,
            "clicks": api_clicks,
            "total_opens": int(
                campaign.get("totalOpens")
                or campaign.get("total_opens")
                or total_opens
            ),
            "total_clicks": int(
                campaign.get("totalClicks")
                or campaign.get("total_clicks")
                or total_clicks
            ),
            "open_rate_pct": open_rate_pct,
            "click_rate_pct": click_rate_pct,
            "ctor_pct": ctor_pct,
            "open_rate_display": (
                f"{open_rate_pct}%" if open_rate_pct is not None else None
            ),
            "click_rate_display": (
                f"{click_rate_pct}%" if click_rate_pct is not None else None
            ),
            "rate_note": _RATE_NOTE,
            "impressions": impressions,
            "spend": spend,
            "conversions": conversions,
            "currency": currency,
            "ctr_pct": _pct_1(clicks, impressions) if impressions else None,
            "cpc": round(spend / clicks, 2) if clicks else None,
            "cpa": round(spend / conversions, 2) if conversions else None,
        },
        "email_ab": campaign.get("emailAb") or campaign.get("email_ab"),
        "channels": [
            {
                "channel": c.get("channel"),
                "total_to_send": c.get("totalToSend") or c.get("total_to_send") or 0,
                "sent": int(c.get("sent") or 0),
                "stub": int(c.get("stubSent") or c.get("stub_sent") or 0),
                "failed": int(c.get("failed") or 0),
                "opens": int(c.get("opens") or 0),
                "clicks": int(c.get("clicks") or 0),
                "total_opens": int(
                    c.get("totalOpens") or c.get("total_opens") or c.get("opens") or 0
                ),
                "total_clicks": int(
                    c.get("totalClicks")
                    or c.get("total_clicks")
                    or c.get("clicks")
                    or 0
                ),
                "open_rate_pct": _rate_pct(
                    int(c.get("opens") or 0), int(c.get("sent") or 0)
                ),
                "click_rate_pct": _rate_pct(
                    int(c.get("clicks") or 0), int(c.get("sent") or 0)
                ),
                "ctor_pct": _rate_pct(
                    int(c.get("clicks") or 0), int(c.get("opens") or 0)
                ),
                "paused": bool(c.get("paused")),
                "pause_reason": c.get("pauseReason") or c.get("pause_reason"),
                "how_it_works": c.get("howItWorks") or c.get("how_it_works"),
                "status": c.get("status"),
                "network": c.get("network"),
                "impressions": int(c.get("impressions") or 0),
                "spend": float(c.get("spend") or 0),
                "currency": c.get("currency"),
                "conversions": int(c.get("conversions") or 0),
                "daily_budget": c.get("dailyBudget") if c.get("dailyBudget") is not None else c.get("daily_budget"),
                "plan_summary": c.get("planSummary") or c.get("plan_summary"),
                "ctr_pct": _pct_1(
                    int(c.get("clicks") or 0), int(c.get("impressions") or 0)
                ),
                "cpc": c.get("cpc"),
                "cpa": c.get("cpa"),
            }
            for c in channels
        ],
    }


def _list_item_from_api_row(r: dict[str, Any]) -> dict[str, Any]:
    sent_i = int(r.get("sent") or 0)
    delivered_i = int(r.get("delivered") or sent_i)
    opens_i = int(r.get("opens") or 0)
    clicks_i = int(r.get("clicks") or 0)
    total_opens_i = int(r.get("totalOpens") or r.get("total_opens") or opens_i)
    total_clicks_i = int(r.get("totalClicks") or r.get("total_clicks") or clicks_i)
    open_pct = _rate_pct(opens_i, delivered_i)
    click_pct = _rate_pct(clicks_i, delivered_i)
    channels = normalize_row_channels(r)
    channel_metrics = r.get("channelMetrics") or r.get("channel_metrics") or []
    per_channel: list[dict[str, Any]] = []
    if isinstance(channel_metrics, list):
        for cm in channel_metrics:
            if not isinstance(cm, dict):
                continue
            ch = _channel_key(str(cm.get("channel") or ""))
            if not ch:
                continue
            per_channel.append(
                {
                    "channel": ch,
                    "sent": int(cm.get("sent") or 0),
                    "delivered": int(cm.get("delivered") or cm.get("sent") or 0),
                    "failed": int(cm.get("failed") or 0),
                    "opens": int(cm.get("opens") or 0),
                    "clicks": int(cm.get("clicks") or 0),
                }
            )
    return {
        "id": r.get("id"),
        "name": r.get("name"),
        "status": r.get("status"),
        "channels": channels,
        "channel_metrics": per_channel,
        "audience_count": int(r.get("audienceCount") or r.get("audience_count") or 0),
        "audience_summary": r.get("audienceSummary") or r.get("audience_summary"),
        "starts_at": r.get("startsAt") or r.get("starts_at"),
        "timezone": r.get("timezone") or "Asia/Kolkata",
        "launch_local_date": r.get("launchLocalDate") or r.get("launch_local_date"),
        "launch_local_time": r.get("launchLocalTime") or r.get("launch_local_time"),
        "sent": sent_i,
        "delivered": delivered_i,
        "failed": int(r.get("failed") or 0),
        "opens": opens_i,
        "clicks": clicks_i,
        "total_opens": total_opens_i,
        "total_clicks": total_clicks_i,
        "open_rate_pct": open_pct,
        "click_rate_pct": click_pct,
        "ctor_pct": _rate_pct(clicks_i, opens_i),
        "open_rate_display": f"{open_pct}%" if open_pct is not None else None,
        "click_rate_display": f"{click_pct}%" if click_pct is not None else None,
        "impressions": int(r.get("impressions") or 0),
        "spend": float(r.get("spend") or 0),
        "conversions": int(r.get("conversions") or 0),
        "currency": r.get("currency"),
        "has_ppc": bool(
            r.get("hasPpc") if r.get("hasPpc") is not None else r.get("has_ppc")
        ),
    }


async def handle_list(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    from app.agents.reports.visual_policy import resolve_include_visual

    include_visual = resolve_include_visual("LIST_MONITOR_CAMPAIGNS", args)
    session_scope = await get_or_create_session(session_id, token=token)
    caller = await resolve_session_context(session_scope, token)
    scope_msg = scope_note(caller)
    bucket = str(args.get("bucket") or "live").strip().lower()
    if bucket not in ("live", "scheduled", "past", "draft", "all"):
        return {
            "ok": False,
            "error": "bucket must be live, scheduled, past, draft, or all",
        }
    relative = str(args.get("relative") or "").strip().lower() or None
    from_date = str(args.get("from_date") or args.get("fromDate") or "").strip() or None
    to_date = str(args.get("to_date") or args.get("toDate") or "").strip() or None
    if not relative and not from_date and not to_date:
        session_pre = await get_or_create_session(session_id, token=token)
        merged = resolve_report_period(session_pre, args)
        if merged:
            pparams = period_to_query_params(merged)
            relative = pparams.get("relative") or relative
            from_date = pparams.get("from") or from_date
            to_date = pparams.get("to") or to_date
    if relative and relative not in (
        "today",
        "yesterday",
        "last_7_days",
        "last_month",
    ):
        relative = None
    try:
        limit = int(args.get("limit") if args.get("limit") is not None else 20)
    except (TypeError, ValueError):
        limit = 20
    limit = max(1, min(limit, 50))
    try:
        offset = int(args.get("offset") if args.get("offset") is not None else 0)
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)

    channel_raw = str(args.get("channel") or args.get("channels") or "").strip()
    channel_filter = _channel_key(channel_raw) if channel_raw else None
    ran_only = args.get("ran_only")
    if ran_only is None:
        ran_only = bool(
            channel_filter
            or relative
            or from_date
            or to_date
            or bucket in ("all", "past")
        )
    else:
        ran_only = bool(ran_only)

    params: dict[str, str] = {"bucket": bucket, "portfolio": "1"}
    if relative:
        params["relative"] = relative
    if from_date:
        params["from"] = from_date
    if to_date:
        params["to"] = to_date
    session_pre = await get_or_create_session(session_id, token=token)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{_base()}/campaigns",
                headers=_headers(token),
                params=params,
            )
            res.raise_for_status()
            body = res.json()
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"List failed: {exc}"}
    rows = list(body.get("getCampaignDetails") or [])
    all_items: list[dict[str, Any]] = []
    for r in rows:
        if not r:
            continue
        all_items.append(_list_item_from_api_row(r))

    if ran_only and bucket not in ("draft", "scheduled"):
        all_items = [
            i for i in all_items if is_ran_campaign_status(str(i.get("status") or ""))
        ]
    if channel_filter:
        all_items = [
            i
            for i in all_items
            if row_includes_channel(
                {"channels": i.get("channels") or []}, channel_filter
            )
        ]

    name_contains = str(args.get("name_contains") or "").strip().lower()
    if name_contains:
        all_items = [
            i
            for i in all_items
            if name_contains in str(i.get("name") or "").lower()
        ]
    total_matched = len(all_items)

    period_for_portfolio: dict[str, Any] = {}
    if relative:
        period_for_portfolio["relative"] = relative
    if from_date:
        period_for_portfolio["fromDate"] = from_date
    if to_date:
        period_for_portfolio["toDate"] = to_date
    portfolio_crosscheck: dict[str, Any] | None = None
    if channel_filter and period_for_portfolio:
        pf = await fetch_portfolio_totals(token, period_for_portfolio)
        expected = channel_rollup_count(pf, channel_filter)
        if expected is not None:
            portfolio_crosscheck = {
                "channel": channel_filter,
                "campaigns_in_channel_rollup": expected,
                "list_total_matched": total_matched,
                "note": (
                    "Dashboard Overview channel card uses channel_rollup.campaigns "
                    "(ran campaigns including this channel). list total_matched uses "
                    "the same ran + channel filter when ran_only=true."
                ),
            }
            if expected > 0 and total_matched == 0:
                portfolio_crosscheck["warning"] = (
                    "Portfolio shows campaigns for this channel but list filter returned "
                    "zero — recheck bucket=all, period, and channel spelling (push=App Push)."
                )
    items = all_items[offset : offset + limit]
    has_more = offset + len(items) < total_matched
    next_offset = offset + len(items) if has_more else None

    api_portfolio = body.get("portfolio_totals")
    full_from_api = totals_from_api_portfolio(
        api_portfolio if isinstance(api_portfolio, dict) else None
    )
    if full_from_api:
        full_totals = {
            **full_from_api,
            "campaigns": full_from_api.get("campaigns", total_matched),
        }
        page_totals = _aggregate_totals(items, len(items))
        if full_from_api.get("open_rate_pct") is not None:
            page_totals = dict(page_totals)
            page_totals["note"] = full_from_api.get("note", page_totals.get("note"))
    else:
        page_totals = _aggregate_totals(items, len(items))
        full_totals = _aggregate_totals(all_items, total_matched)

    session = await get_or_create_session(session_id, token=token)
    session["monitor_bucket"] = bucket
    session["stage"] = "list"
    session["last_action"] = "list"
    session["campaign_list_page"] = {
        "bucket": bucket,
        "relative": relative,
        "from_date": from_date,
        "to_date": to_date,
        "channel": channel_filter,
        "ran_only": ran_only,
        "name_contains": name_contains or None,
        "limit": limit,
        "offset": offset,
        "total_matched": total_matched,
        "has_more": has_more,
        "next_offset": next_offset,
    }
    await save_session(session, token=token)
    channel_note = f" channel={channel_filter}" if channel_filter else ""
    return {
        "ok": True,
        "bucket": bucket,
        "relative": relative,
        "from_date": from_date,
        "to_date": to_date,
        "channel": channel_filter,
        "ran_only": ran_only,
        "limit": limit,
        "offset": offset,
        "total_matched": total_matched,
        "returned": len(items),
        "has_more": has_more,
        "next_offset": next_offset,
        "count": len(items),
        "totals": page_totals,
        "totals_all_matched": full_totals,
        "portfolio_crosscheck": portfolio_crosscheck,
        "kpi_glossary": full_totals.get("kpi_glossary") or KPI_GLOSSARY,
        "campaigns": items,
        "include_visual": include_visual,
        "message": args.get("change_summary")
        or (
            f"Showing {len(items)} of {total_matched} {bucket} campaign(s)"
            f"{channel_note} (offset {offset}). {scope_msg}"
            + (" More available — use next_offset." if has_more else "")
        ),
        **scope_result_fields(caller),
        "ui_event": {
            "type": "monitor_list",
            "payload": {
                "bucket": bucket,
                "campaigns": items,
                "totals": page_totals,
                "total_matched": total_matched,
                "limit": limit,
                "offset": offset,
                "has_more": has_more,
                "next_offset": next_offset,
            },
        },
    }


async def handle_report(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    from app.agents.reports.visual_policy import resolve_include_visual

    include_visual = resolve_include_visual("GET_CAMPAIGN_REPORT", args)
    session_scope = await get_or_create_session(session_id, token=token)
    caller = await resolve_session_context(session_scope, token)
    scope_msg = scope_note(caller)
    campaign_id = str(args.get("campaign_id") or "").strip()
    if not campaign_id:
        session = await get_or_create_session(
            session_id, token=token
        )
        campaign_id = str(session.get("focus_campaign_id") or "").strip()
    if not campaign_id:
        return {"ok": False, "error": "campaign_id required"}

    session_pre = await get_or_create_session(session_id, token=token)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{_base()}/campaigns/{campaign_id}",
                headers=_headers(token),
            )
            res.raise_for_status()
            campaign = (res.json() or {}).get("campaign") or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Get campaign failed: {exc}"}

    if not campaign.get("id"):
        return {"ok": False, "error": "Campaign not found."}

    summary = _report_summary(campaign)
    # Attach schedule/timezone when present on campaign payload.
    summary["timezone"] = (
        campaign.get("timezone") or "Asia/Kolkata"
    )
    summary["launch_local_date"] = (
        campaign.get("launchLocalDate") or campaign.get("launch_local_date")
    )
    summary["launch_local_time"] = (
        campaign.get("launchLocalTime") or campaign.get("launch_local_time")
    )
    summary["starts_at"] = campaign.get("startsAt") or campaign.get("starts_at")
    session = await get_or_create_session(session_id, token=token)
    session["focus_campaign_id"] = campaign["id"]
    session["focus_campaign_name"] = campaign.get("name")
    session["last_report"] = summary
    session["stage"] = "report"
    session["last_action"] = "report"
    await save_session(session, token=token)
    return {
        "ok": True,
        "report": summary,
        "include_visual": include_visual,
        "message": args.get("change_summary") or f"Campaign report loaded. {scope_msg}",
        **scope_result_fields(caller),
        "ui_event": {
            "type": "campaign_report",
            "payload": {"campaign": campaign, "report": summary},
        },
    }


async def handle_audience(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    campaign_id = str(args.get("campaign_id") or "").strip()
    if not campaign_id:
        session = await get_or_create_session(session_id, token=token)
        campaign_id = str(session.get("focus_campaign_id") or "").strip()
    if not campaign_id:
        return {"ok": False, "error": "campaign_id required"}
    channel = str(args.get("channel") or "").strip().lower() or None
    params: dict[str, str] = {"limit": "200"}
    if channel:
        params["channel"] = channel

    session_pre = await get_or_create_session(session_id, token=token)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{_base()}/campaigns/{campaign_id}/recipients",
                headers=_headers(token),
                params=params,
            )
            res.raise_for_status()
            body = res.json() or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Get audience failed: {exc}"}

    totals = body.get("totals") or {}
    rows = list(body.get("recipients") or [])
    contacts = [
        {
            "name": r.get("name"),
            "email": r.get("email"),
            "company": r.get("company"),
            "selected": bool(r.get("selected")),
            "outcome": r.get("outcome"),
            "reason": (r.get("channels") or [{}])[0].get("skip_fail_reason")
            if r.get("channels")
            else None,
        }
        for r in rows
    ]
    session = await get_or_create_session(session_id, token=token)
    session["focus_campaign_id"] = campaign_id
    session["last_action"] = "audience"
    await save_session(session, token=token)
    return {
        "ok": True,
        "campaign_id": body.get("campaign_id") or campaign_id,
        "name": body.get("name"),
        "audience_summary": body.get("audience_summary"),
        "totals": totals,
        "contacts": contacts,
        "note": body.get("note"),
        "message": args.get("change_summary")
        or (
            f"{totals.get('selected') or 0} selected · "
            f"{totals.get('sent') or 0} sent · "
            f"{totals.get('stub') or 0} stub (not delivered) · "
            f"{(totals.get('failed') or 0) + (totals.get('skipped') or 0) + (totals.get('not_sent') or 0) + (totals.get('pending') or 0)} missed."
        ),
    }


async def handle_stop_campaign(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    campaign_id = str(args.get("campaign_id") or "").strip()
    reason = str(args.get("reason") or "").strip()
    if not campaign_id:
        session = await get_or_create_session(session_id, token=token)
        campaign_id = str(session.get("focus_campaign_id") or "").strip()
    if not campaign_id:
        return {"ok": False, "error": "campaign_id required"}

    payload: dict[str, Any] = {}
    if reason:
        payload["reason"] = reason

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{_base()}/campaigns/{campaign_id}/stop",
                headers=_headers(token),
                json=payload,
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith(
                        "application/json"
                    )
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Stop failed",
                }
            body = res.json() or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Stop campaign failed: {exc}"}

    campaign = body.get("campaign") or {}
    summary = _report_summary(campaign) if campaign else {}
    session = await get_or_create_session(session_id, token=token)
    session["focus_campaign_id"] = campaign_id
    if summary:
        session["last_report"] = summary
    session["last_action"] = "stop_campaign"
    await save_session(session, token=token)

    already_finished = bool(body.get("already_finished"))
    needs_reason = bool(body.get("needs_reason"))
    not_launching = bool(body.get("not_launching"))
    stopped = bool(body.get("stopped"))
    selected = int(body.get("selected") or 0)
    sent = int(body.get("sent") or 0)
    status = str(body.get("status") or summary.get("status") or "")
    name = str(body.get("name") or summary.get("name") or "this campaign")
    api_message = str(body.get("message") or "").strip()

    if already_finished:
        message = api_message or (
            f"{name} is already completed (status: {status}). It cannot be stopped."
        )
        return {
            "ok": True,
            "stopped": False,
            "already_finished": True,
            "status": status,
            "name": name,
            "selected": selected,
            "sent": sent,
            "report": summary,
            "message": message,
            "ui_event": {
                "type": "campaign_report",
                "payload": {"campaign": campaign, "report": summary},
            },
        }

    if not_launching:
        return {
            "ok": True,
            "stopped": False,
            "not_launching": True,
            "status": status,
            "name": name,
            "selected": selected,
            "sent": sent,
            "report": summary,
            "message": api_message or f"{name} is still a draft — nothing is launching.",
        }

    if needs_reason:
        remaining = max(0, selected - sent)
        message = api_message or (
            f"{name} is {status}: {sent} of {selected} selected contacts already sent "
            f"({remaining} remaining). Ask the user for a reason, then call STOP_CAMPAIGN again with that reason."
        )
        return {
            "ok": True,
            "stopped": False,
            "needs_reason": True,
            "status": status,
            "name": name,
            "selected": selected,
            "sent": sent,
            "remaining": remaining,
            "report": summary,
            "message": message,
            "ask": "Ask the user for a reason before stopping. Do not invent one.",
            "ui_event": {
                "type": "campaign_report",
                "payload": {"campaign": campaign, "report": summary},
            },
        }

    return {
        "ok": True,
        "stopped": stopped,
        "status": status,
        "name": name,
        "selected": selected,
        "sent": sent,
        "reason": reason or body.get("reason"),
        "report": summary,
        "message": args.get("change_summary")
        or api_message
        or f"Stopped {name}. Reason: {reason}",
        "ui_event": {
            "type": "campaign_report",
            "payload": {"campaign": campaign, "report": summary},
        },
    }


async def handle_stop(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    campaign_id = str(args.get("campaign_id") or "").strip()
    channel = _channel_key(str(args.get("channel") or ""))
    reason = str(args.get("reason") or "").strip()
    if not campaign_id:
        session = await get_or_create_session(
            session_id, token=token
        )
        campaign_id = str(session.get("focus_campaign_id") or "").strip()
    if not campaign_id:
        return {"ok": False, "error": "campaign_id required"}
    if not channel:
        return {"ok": False, "error": "channel required"}
    if not reason:
        return {
            "ok": False,
            "error": "A reason is required to stop a channel.",
        }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{_base()}/campaigns/{campaign_id}/channels/{channel}/run-state",
                headers=_headers(token),
                json={"paused": True, "reason": reason},
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith(
                        "application/json"
                    )
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "Stop failed",
                }
            campaign = (res.json() or {}).get("campaign") or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Stop failed: {exc}"}

    summary = _report_summary(campaign) if campaign else {}
    session = await get_or_create_session(
        session_id, token=token
    )
    session["focus_campaign_id"] = campaign_id
    session["last_report"] = summary or session.get("last_report")
    session["last_action"] = "stop"
    await save_session(session, token=token)
    return {
        "ok": True,
        "channel": channel,
        "reason": reason,
        "report": summary,
        "message": args.get("change_summary")
        or f"Stopped {channel}. Reason: {reason}",
        "ui_event": {
            "type": "campaign_report",
            "payload": {"campaign": campaign, "report": summary},
        },
    }


async def handle_resume(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    campaign_id = str(args.get("campaign_id") or "").strip()
    channel = _channel_key(str(args.get("channel") or ""))
    if not campaign_id:
        session = await get_or_create_session(
            session_id, token=token
        )
        campaign_id = str(session.get("focus_campaign_id") or "").strip()
    if not campaign_id:
        return {"ok": False, "error": "campaign_id required"}
    if not channel:
        return {"ok": False, "error": "channel required"}

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{_base()}/campaigns/{campaign_id}/channels/{channel}/run-state",
                headers=_headers(token),
                json={"paused": False},
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith(
                        "application/json"
                    )
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message")
                    or res.text
                    or "Resume failed",
                }
            campaign = (res.json() or {}).get("campaign") or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"Resume failed: {exc}"}

    summary = _report_summary(campaign) if campaign else {}
    session = await get_or_create_session(
        session_id, token=token
    )
    session["focus_campaign_id"] = campaign_id
    session["last_report"] = summary or session.get("last_report")
    session["last_action"] = "resume"
    await save_session(session, token=token)
    return {
        "ok": True,
        "channel": channel,
        "report": summary,
        "message": args.get("change_summary") or f"Resumed {channel}.",
        "ui_event": {
            "type": "campaign_report",
            "payload": {"campaign": campaign, "report": summary},
        },
    }


async def handle_pick_ab_winner(
    session_id: str, token: str, args: dict[str, Any]
) -> dict[str, Any]:
    campaign_id = str(args.get("campaign_id") or "").strip()
    if not campaign_id:
        session = await get_or_create_session(session_id, token=token)
        campaign_id = str(session.get("focus_campaign_id") or "").strip()
    if not campaign_id:
        return {"ok": False, "error": "campaign_id required"}
    winner_raw = str(args.get("winner") or "").strip().lower()
    winner = winner_raw if winner_raw in ("a", "b") else None
    force = args.get("force")
    if force is None:
        force = True
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{_base()}/campaigns/{campaign_id}/ab-winner",
                headers=_headers(token),
                json={"winner": winner, "force": bool(force)},
            )
            if res.status_code >= 400:
                detail = (
                    res.json()
                    if res.headers.get("content-type", "").startswith(
                        "application/json"
                    )
                    else {}
                )
                return {
                    "ok": False,
                    "error": detail.get("message") or res.text or "A/B winner failed",
                }
            body = res.json() or {}
            campaign = body.get("campaign") or {}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"A/B winner failed: {exc}"}

    summary = _report_summary(campaign) if campaign else {}
    session = await get_or_create_session(session_id, token=token)
    session["focus_campaign_id"] = campaign_id
    session["last_report"] = summary or session.get("last_report")
    session["last_action"] = "pick_ab_winner"
    await save_session(session, token=token)
    picked = body.get("winner") or winner
    return {
        "ok": True,
        "winner": picked,
        "remainder": body.get("remainder"),
        "report": summary,
        "message": args.get("change_summary")
        or body.get("message")
        or f"Email A/B winner {str(picked or 'auto').upper()} — remainder queued.",
        "ui_event": {
            "type": "campaign_report",
            "payload": {"campaign": campaign, "report": summary},
        },
    }


async def dispatch_tool(
    name: str,
    session_id: str,
    token: str,
    args: dict[str, Any],
    event_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    _ = event_callback
    if name == "LIST_MONITOR_CAMPAIGNS":
        return await handle_list(session_id, token, args)
    if name == "GET_CAMPAIGN_REPORT":
        return await handle_report(session_id, token, args)
    if name == "GET_CAMPAIGN_AUDIENCE":
        return await handle_audience(session_id, token, args)
    if name == "STOP_CAMPAIGN":
        return await handle_stop_campaign(session_id, token, args)
    if name == "STOP_CHANNEL":
        return await handle_stop(session_id, token, args)
    if name == "RESUME_CHANNEL":
        return await handle_resume(session_id, token, args)
    if name == "PICK_AB_WINNER":
        return await handle_pick_ab_winner(session_id, token, args)
    if name == "ROUTE_TO_MODULE":
        result = await dispatch_route_to_module(args)
        if event_callback and result.get("ui_event"):
            await event_callback(result["ui_event"])
        return result
    return {"ok": False, "error": f"Unknown tool: {name}"}
