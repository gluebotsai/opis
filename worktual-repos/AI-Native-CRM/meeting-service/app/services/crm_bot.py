from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException

from app.config import settings

log = logging.getLogger(__name__)


def _uses_dummy(base: str) -> bool:
    lower = base.lower()
    return lower in {"internal", "dummy"} or "/internal/crm-bot" in lower


def ask(payload: dict[str, Any], bearer: str, db=None) -> dict:
    base = (settings.crm_bot_base_url or "").rstrip("/")
    if not base:
        raise HTTPException(status_code=503, detail="CRM bot is not configured")
    if _uses_dummy(base):
        from app.services.dummy_crm_bot import reply

        return reply(payload, db)
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {bearer}"}
    if settings.crm_bot_api_key:
        headers["X-CRM-Bot-Key"] = settings.crm_bot_api_key
    try:
        with httpx.Client(timeout=settings.llm_timeout_sec) as client:
            r = client.post(f"{base}/v1/assist/ask", json=payload, headers=headers)
    except httpx.HTTPError as exc:
        log.warning("crm_bot_unreachable", extra={"error": str(exc)})
        raise HTTPException(status_code=503, detail="CRM bot unreachable") from exc
    if r.status_code >= 400:
        detail = r.text[:400]
        try:
            body = r.json()
            detail = (
                body.get("detail")
                or body.get("message")
                or body.get("error")
                or detail
            )
        except Exception:
            pass
        raise HTTPException(status_code=r.status_code, detail=detail)
    try:
        data = r.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    reply = data.get("reply") or data.get("text") or data.get("answer") or ""
    data["reply"] = str(reply)
    return data


def _crm_post(path: str, payload: dict[str, Any], bearer: str) -> dict[str, Any]:
    base = (settings.crm_bot_base_url or "").rstrip("/")
    if not base:
        raise HTTPException(status_code=503, detail="CRM bot is not configured")
    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {bearer}"}
    if settings.crm_bot_api_key:
        headers["X-CRM-Bot-Key"] = settings.crm_bot_api_key
    try:
        with httpx.Client(timeout=settings.llm_timeout_sec) as client:
            r = client.post(f"{base}{path}", json=payload, headers=headers)
    except httpx.HTTPError as exc:
        log.warning("crm_bot_unreachable", extra={"error": str(exc)})
        raise HTTPException(status_code=503, detail="CRM bot unreachable") from exc
    if r.status_code >= 400:
        detail = r.text[:400]
        try:
            body = r.json()
            detail = (
                body.get("detail")
                or body.get("message")
                or body.get("error")
                or detail
            )
        except Exception:
            pass
        raise HTTPException(status_code=r.status_code, detail=detail)
    try:
        data = r.json()
    except Exception:
        data = {}
    return data if isinstance(data, dict) else {}


def meet_bootstrap(payload: dict[str, Any], bearer: str) -> dict[str, Any]:
    return _crm_post("/v1/assist/meet-bootstrap", payload, bearer)


def sync_live(payload: dict[str, Any], bearer: str) -> dict[str, Any]:
    return _crm_post("/v1/assist/sync-live", payload, bearer)


def execute_action(payload: dict[str, Any], bearer: str) -> dict[str, Any]:
    return _crm_post("/v1/assist/execute-action", payload, bearer)
