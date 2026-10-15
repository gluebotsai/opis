"""Portfolio KPI totals from Campaign API (Dashboard parity)."""

from __future__ import annotations

from typing import Any

_RATE_NOTE = (
    "open_rate_pct / click_rate_pct are already percentages matching the Dashboard "
    "(e.g. 40.7 means 40.7%). Speak them with a % sign. Do not divide or multiply "
    "them again. Rates use unique openers/clickers on tracked channels over delivered."
)

KPI_GLOSSARY = (
    "campaigns_ran = campaigns that ran (live+completed+cancelled) in the Overview period only — "
    "always say the period (e.g. Last week). Not lifetime total. "
    "past_all_time / monitoring Past tab = all completed+cancelled campaigns (no date filter). "
    "campaigns_with_send = ran campaigns with at least one delivery (Dashboard Sent KPI). "
    "campaigns_with_failure = ran campaigns with send failures (Dashboard Failed KPI). "
    "sent / messages_sent = message volume across ran campaigns in period. "
    "channel_rollup[].campaigns = ran campaigns that include that channel in period. "
    "If the user says total/all time/past tab without a period, use past_all_time or ask which they mean."
)


def totals_from_api_portfolio(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    """Normalize backend portfolio_totals for agent tool responses."""
    if not isinstance(raw, dict):
        return None
    open_pct = raw.get("open_rate_pct")
    click_pct = raw.get("click_rate_pct")
    ctor_pct = raw.get("ctor_pct")
    campaigns_ran = int(
        raw.get("campaigns_ran")
        or raw.get("campaigns")
        or 0
    )
    messages_sent = int(raw.get("messages_sent") or raw.get("sent") or 0)
    messages_failed = int(raw.get("messages_failed") or raw.get("failed") or 0)
    return {
        "campaigns_ran": campaigns_ran,
        "campaigns": campaigns_ran,
        "campaigns_with_send": int(raw.get("campaigns_with_send") or 0),
        "campaigns_with_failure": int(raw.get("campaigns_with_failure") or 0),
        "live_count": int(raw.get("live_count") or 0),
        "scheduled_count": int(raw.get("scheduled_count") or 0),
        "completed_count": int(raw.get("completed_count") or 0),
        "draft_count": int(raw.get("draft_count") or 0),
        "sent": messages_sent,
        "messages_sent": messages_sent,
        "campaign_sent_count": messages_sent,
        "delivered": int(raw.get("delivered") or messages_sent or 0),
        "failed": messages_failed,
        "messages_failed": messages_failed,
        "stub_sent": int(raw.get("stub_sent") or 0),
        "opens": int(raw.get("opens") or 0),
        "clicks": int(raw.get("clicks") or 0),
        "total_opens": int(raw.get("total_opens") or raw.get("opens") or 0),
        "total_clicks": int(raw.get("total_clicks") or raw.get("clicks") or 0),
        "impressions": int(raw.get("impressions") or 0),
        "spend": float(raw.get("spend") or 0),
        "conversions": int(raw.get("conversions") or 0),
        "currency": str(raw.get("currency") or "INR"),
        "open_rate_pct": open_pct,
        "click_rate_pct": click_pct,
        "ctor_pct": ctor_pct,
        "open_rate_display": raw.get("open_rate_display")
        or (f"{open_pct}%" if open_pct is not None else None),
        "click_rate_display": raw.get("click_rate_display")
        or (f"{click_pct}%" if click_pct is not None else None),
        "channel_rollup": raw.get("channel_rollup") or [],
        "note": str(raw.get("note") or _RATE_NOTE),
        "kpi_glossary": str(raw.get("kpi_glossary") or KPI_GLOSSARY),
    }


__all__ = ["totals_from_api_portfolio", "KPI_GLOSSARY"]
