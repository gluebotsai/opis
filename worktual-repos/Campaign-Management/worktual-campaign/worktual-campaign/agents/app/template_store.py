"""Channel template persistence via the Node campaign API."""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings
from app.campaign_api_errors import campaign_api_error_message
from app.http_retry import with_http_retry
from app.request_context import get_request_token


def _headers(token: str | None = None) -> dict[str, str]:
    tok = (token or get_request_token()).strip()
    return {"Authorization": f"Bearer {tok}"}


def _base() -> str:
    return get_settings().campaign_api_base.rstrip("/")


def persist_response_payload(body: Any) -> dict[str, Any]:
    """Normalize Campaign API success body to {templates, generation_batch_id, ...}."""
    if not isinstance(body, dict):
        return {}
    data = body.get("data")
    if isinstance(data, dict) and (
        "templates" in data or "generation_batch_id" in data
    ):
        return data
    return body


def persist_templates_from_body(body: Any) -> list[dict[str, Any]]:
    payload = persist_response_payload(body)
    rows = payload.get("templates")
    if isinstance(rows, list):
        return [row for row in rows if isinstance(row, dict)]
    return []


async def save_campaign_from_session(
    session_id: str,
    payload: dict[str, Any],
    *,
    token: str | None = None,
) -> dict[str, Any]:
    """Persist campaign + channels + audience after templates are saved."""
    url = f"{_base()}/campaigns/from-session/{session_id}"

    async def _once() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(url, headers=_headers(token), json=payload)
            try:
                res.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise RuntimeError(campaign_api_error_message(exc)) from exc
            return res.json()

    return await with_http_retry(f"save_campaign:{session_id}", _once)


async def create_templates_batch(
    session_id: str,
    templates: list[dict[str, Any]],
    *,
    generation_batch_id: str | None = None,
    token: str | None = None,
) -> dict[str, Any]:
    url = f"{_base()}/channel-templates/session/{session_id}/batch"
    body: dict[str, Any] = {"templates": templates}
    if generation_batch_id:
        body["generation_batch_id"] = generation_batch_id

    async def _once() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(url, headers=_headers(token), json=body)
            res.raise_for_status()
            return persist_response_payload(res.json())

    return await with_http_retry(f"create_templates_batch:{session_id}", _once)


async def sync_session_templates(
    session_id: str,
    templates: list[dict[str, Any]],
    *,
    generation_batch_id: str | None = None,
    token: str | None = None,
) -> dict[str, Any]:
    """Backfill missing session cards into DB (idempotent)."""
    url = f"{_base()}/channel-templates/session/{session_id}/sync"
    body: dict[str, Any] = {"templates": templates}
    if generation_batch_id:
        body["generation_batch_id"] = generation_batch_id

    async def _once() -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=60.0) as client:
            res = await client.post(url, headers=_headers(token), json=body)
            res.raise_for_status()
            return persist_response_payload(res.json())

    return await with_http_retry(f"sync_session_templates:{session_id}", _once)


async def list_session_templates(
    session_id: str, *, token: str | None = None
) -> list[dict[str, Any]]:
    from app.session_store import (
        _ensure_agent_session_shell,
        is_whatsapp_template_session_id,
    )

    if is_whatsapp_template_session_id(session_id):
        await _ensure_agent_session_shell(session_id, token=token)
    url = f"{_base()}/channel-templates/session/{session_id}"

    async def _once() -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(url, headers=_headers(token))
            if res.status_code == 404:
                return []
            res.raise_for_status()
            body = res.json()
        data = body.get("data") if isinstance(body, dict) else body
        if isinstance(data, dict):
            return list(data.get("templates") or [])
        return list(body.get("templates") or [])

    return await with_http_retry(f"list_session_templates:{session_id}", _once)


async def list_recent_org_templates(
    *,
    channel: str | None = None,
    limit: int = 20,
    token: str | None = None,
) -> list[dict[str, Any]]:
    """Recent templates for org — used for cross-campaign fingerprint rotation."""
    q: list[str] = []
    if channel:
        q.append(f"channel={channel.strip().lower()}")
    if limit:
        q.append(f"limit={int(limit)}")
    suffix = f"?{'&'.join(q)}" if q else ""
    url = f"{_base()}/channel-templates/recent{suffix}"

    async def _once() -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.get(url, headers=_headers(token))
            res.raise_for_status()
            body = res.json()
        data = body.get("data") if isinstance(body, dict) else body
        if isinstance(data, dict):
            return list(data.get("templates") or [])
        return list(body.get("templates") or []) if isinstance(body, dict) else []

    return await with_http_retry("list_recent_org_templates", _once)


async def get_template(
    template_id: str, *, token: str | None = None
) -> dict[str, Any]:
    url = f"{_base()}/channel-templates/{template_id}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(url, headers=_headers(token))
        res.raise_for_status()
        return res.json()


async def update_template_fields(
    template_id: str,
    fields: dict[str, Any],
    *,
    token: str | None = None,
) -> dict[str, Any]:
    url = f"{_base()}/channel-templates/{template_id}/fields"
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.patch(
            url, headers=_headers(token), json={"fields": fields}
        )
        res.raise_for_status()
        return res.json()


async def append_template_messages(
    template_id: str,
    messages: list[dict[str, Any]],
    *,
    token: str | None = None,
) -> dict[str, Any]:
    url = f"{_base()}/channel-templates/{template_id}/messages"
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.post(
            url, headers=_headers(token), json={"messages": messages}
        )
        res.raise_for_status()
        return res.json()
