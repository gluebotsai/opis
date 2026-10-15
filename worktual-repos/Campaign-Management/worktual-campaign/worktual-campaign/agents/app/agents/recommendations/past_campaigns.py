"""Load completed campaigns for the recommendations agent."""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _base() -> str:
    return get_settings().campaign_api_base.rstrip("/")


def _rate_pct(numerator: float, denominator: float) -> float | None:
    if not denominator:
        return None
    return min(100.0, round((numerator / denominator) * 100, 1))


def _as_pct(raw: Any, numerator: float, denominator: float) -> float | None:
    if raw is not None:
        try:
            n = float(raw)
            return round(n * 100, 1) if n <= 1 else round(n, 1)
        except (TypeError, ValueError):
            pass
    return _rate_pct(numerator, denominator)


def compact_past_row(row: dict[str, Any]) -> dict[str, Any]:
    sent = int(row.get("sent") or 0)
    delivered = int(row.get("delivered") or sent)
    opens = int(row.get("opens") or 0)
    clicks = int(row.get("clicks") or 0)
    bounced = 0
    for ch in row.get("channelMetrics") or row.get("channel_metrics") or []:
        if isinstance(ch, dict):
            bounced += int(ch.get("bounced") or 0)
    channels = row.get("channels") or []
    if channels and isinstance(channels[0], dict):
        channels = [
            str(c.get("channel") or "")
            for c in channels
            if str(c.get("channel") or "").strip()
        ]
    else:
        channels = [str(c) for c in channels if str(c).strip()]
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "goal": row.get("goal") or None,
        "objective": row.get("objective") or None,
        "channels": channels,
        "audience": row.get("audienceSummary")
        or row.get("audience_summary")
        or None,
        "audience_count": int(row.get("audienceCount") or row.get("audience_count") or 0),
        "sent": sent,
        "failed": int(row.get("failed") or 0),
        "bounced": bounced,
        "delivered": delivered,
        "opens": opens,
        "clicks": clicks,
        "open_rate_pct": _as_pct(
            row.get("openRate") if row.get("openRate") is not None else row.get("open_rate"),
            opens,
            delivered,
        ),
        "click_rate_pct": _as_pct(
            row.get("clickRate")
            if row.get("clickRate") is not None
            else row.get("click_rate"),
            clicks,
            delivered,
        ),
        "launch_date": row.get("launchLocalDate")
        or row.get("launch_local_date")
        or None,
        "status": str(row.get("status") or "").strip().lower() or None,
    }


async def fetch_past_campaigns(token: str, *, limit: int = 15) -> dict[str, Any]:
    """Compact past-campaign performance for recommendation reasoning."""
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            res = await client.get(
                f"{_base()}/campaigns",
                headers=_headers(token),
                params={"bucket": "all"},
            )
            res.raise_for_status()
            body = res.json()
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "has_past": False,
            "count": 0,
            "campaigns": [],
            "error": str(exc),
        }

    raw = [r for r in (body.get("getCampaignDetails") or []) if r]
    launched: list[dict[str, Any]] = []
    other: list[dict[str, Any]] = []
    for row in raw:
        status = str(row.get("status") or "").strip().lower()
        sent = int(row.get("sent") or 0)
        if sent > 0 or status in ("live", "completed", "cancelled"):
            launched.append(row)
        elif status != "draft":
            other.append(row)
    rows = (launched or other)[: max(1, min(limit, 20))]
    campaigns = [compact_past_row(r) for r in rows]
    return {
        "ok": True,
        "has_past": len(campaigns) > 0,
        "count": len(campaigns),
        "campaigns": campaigns,
    }
