"""SSOT portfolio performance — Dashboard + agent parity."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


def _unwrap(body: dict[str, Any]) -> dict[str, Any]:
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    return data if isinstance(data, dict) else {}


async def fetch_portfolio_performance(
    token: str,
    *,
    mode: str = "launch",
    relative: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    activity_from: str | None = None,
    activity_to: str | None = None,
    channels: str | None = None,
) -> dict[str, Any] | None:
    base = get_settings().campaign_api_base.rstrip("/")
    params: dict[str, str] = {"bucket": "all", "mode": mode or "launch"}
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
                f"{base}/campaigns/portfolio/performance",
                headers={"Authorization": f"Bearer {token}"},
                params=params,
            )
            res.raise_for_status()
            return _unwrap(res.json())
    except httpx.HTTPError as exc:
        logger.warning("portfolio performance GET failed: %s", exc)
        return None
