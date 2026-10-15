"""Campaign allowlisted analytics fallback (POST /analytics/ask)."""

from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)


async def ask_campaign_analytics(
    query: str,
    *,
    token: str,
    period: dict[str, Any] | None = None,
    metrics: list[str] | None = None,
) -> dict[str, Any]:
    """Call backend allowlisted analytics. Returns { ok, usable, results, plan, error? }."""
    q = str(query or "").strip()
    if not q:
        return {
            "ok": False,
            "usable": [],
            "results": [],
            "plan": {"source": "campaign_sql"},
            "error": "query is required",
        }
    base = get_settings().campaign_api_base.rstrip("/")
    payload: dict[str, Any] = {"query": q}
    if isinstance(period, dict) and period:
        payload["period"] = period
    if isinstance(metrics, list) and metrics:
        payload["metrics"] = [str(m).strip().lower() for m in metrics if str(m).strip()]
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            res = await client.post(
                f"{base}/analytics/ask",
                headers={"Authorization": f"Bearer {token}"},
                json=payload,
            )
            res.raise_for_status()
            body = res.json()
    except httpx.HTTPError as exc:
        logger.warning("campaign analytics /ask failed: %s", exc)
        return {
            "ok": False,
            "usable": [],
            "results": [],
            "plan": {"source": "campaign_sql"},
            "error": f"campaign_analytics_transport: {exc}",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "usable": [],
            "results": [],
            "plan": {"source": "campaign_sql"},
            "error": f"campaign_analytics_error: {exc}",
        }

    # Envelope may be flat sendSuccess fields
    usable = body.get("usable") or body.get("results") or []
    if not isinstance(usable, list):
        usable = []
    usable = [r for r in usable if isinstance(r, dict) and r.get("ok") is True]
    data = body.get("data") if isinstance(body.get("data"), dict) else body
    plan = (
        data.get("plan")
        if isinstance(data.get("plan"), dict)
        else body.get("plan") if isinstance(body.get("plan"), dict) else {"source": "campaign_sql"}
    )
    return {
        "ok": bool(body.get("ok") and usable),
        "usable": usable,
        "results": data.get("results") if isinstance(data.get("results"), list) else usable,
        "plan": plan,
        "error": body.get("error") or data.get("error"),
        "query": q,
        "source": "campaign_sql",
        "scope_applied": data.get("scope_applied") or plan.get("scope_applied"),
        "scope_label": data.get("scope_label") or plan.get("scope_label"),
        "raw": body,
    }
