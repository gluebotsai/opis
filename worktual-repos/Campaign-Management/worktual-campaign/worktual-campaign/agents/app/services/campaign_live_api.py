"""Campaign live send status + recent failures (Dashboard ops)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


def _unwrap(body: dict[str, Any]) -> dict[str, Any]:
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    return data if isinstance(data, dict) else {}


async def fetch_campaign_live_status(
    token: str,
    campaign_id: str,
) -> dict[str, Any] | None:
    cid = str(campaign_id or "").strip()
    if not cid:
        return None
    base = get_settings().campaign_api_base.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{base}/campaigns/{cid}/live-status",
                headers={"Authorization": f"Bearer {token}"},
            )
            res.raise_for_status()
            return _unwrap(res.json())
    except httpx.HTTPError as exc:
        logger.warning("live-status GET failed: %s", exc)
        return None


async def fetch_recent_send_failures(
    token: str,
    *,
    campaign_id: str | None = None,
    channel: str | None = None,
    limit: int = 20,
) -> dict[str, Any] | None:
    base = get_settings().campaign_api_base.rstrip("/")
    params: dict[str, str] = {"limit": str(min(max(limit, 1), 50))}
    if campaign_id:
        params["campaign_id"] = str(campaign_id).strip()
    if channel:
        params["channel"] = str(channel).strip()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{base}/campaigns/send-failures/recent",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            res.raise_for_status()
            return _unwrap(res.json())
    except httpx.HTTPError as exc:
        logger.warning("recent failures GET failed: %s", exc)
        return None


async def fetch_portfolio_activity_series(
    token: str,
    *,
    relative: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    channels: str | None = None,
) -> dict[str, Any] | None:
    base = get_settings().campaign_api_base.rstrip("/")
    params: dict[str, str] = {}
    if relative:
        params["relative"] = relative
    if from_date:
        params["from"] = from_date
    if to_date:
        params["to"] = to_date
    if channels:
        params["channels"] = channels
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.get(
                f"{base}/campaigns/portfolio/activity-series",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            res.raise_for_status()
            return _unwrap(res.json())
    except httpx.HTTPError as exc:
        logger.warning("activity-series GET failed: %s", exc)
        return None


async def fetch_campaign_ops_feed(
    token: str,
    *,
    relative: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    activity_from: str | None = None,
    activity_to: str | None = None,
    channels: str | None = None,
    live_limit: int = 8,
    failure_limit: int = 8,
) -> dict[str, Any] | None:
    base = get_settings().campaign_api_base.rstrip("/")
    params: dict[str, str] = {
        "live_limit": str(min(max(live_limit, 1), 20)),
        "failure_limit": str(min(max(failure_limit, 1), 20)),
    }
    if relative:
        params["relative"] = relative
    if from_date:
        params["from"] = from_date
    if to_date:
        params["to"] = to_date
    if activity_from:
        params["activity_from"] = activity_from
    if activity_to:
        params["activity_to"] = activity_to
    if channels:
        params["channels"] = channels
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.get(
                f"{base}/campaigns/ops-feed",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            res.raise_for_status()
            return _unwrap(res.json())
    except httpx.HTTPError as exc:
        logger.warning("ops-feed GET failed: %s", exc)
        return None


async def fetch_active_live_sends(
    token: str,
    *,
    limit: int = 10,
) -> dict[str, Any] | None:
    base = get_settings().campaign_api_base.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(
                f"{base}/campaigns/live-sends/active",
                headers={"Authorization": f"Bearer {token}"},
                params={"limit": str(min(max(limit, 1), 20))},
            )
            res.raise_for_status()
            return _unwrap(res.json())
    except httpx.HTTPError as exc:
        logger.warning("active live sends GET failed: %s", exc)
        return None
