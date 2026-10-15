"""HTTP persistence for conversation_context via Ticketing API (Phase 3 boundary)."""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings


class ConversationContextApiError(RuntimeError):
    pass


class ConversationContextStaleError(RuntimeError):
    pass


def _use_api() -> bool:
    settings = get_settings()
    flag = str(getattr(settings, "conversation_context_via_api", "1")).strip().lower()
    if flag in ("0", "false", "no", "off"):
        return False
    return bool(settings.express_base_url and settings.coworker_tasks_secret)


def _headers(org_id: str, user_id: str | None) -> dict[str, str]:
    settings = get_settings()
    return {
        "Content-Type": "application/json",
        "X-Coworker-Tasks-Key": settings.coworker_tasks_secret,
        "X-Coworker-Actor-Id": str(user_id or "anonymous"),
        "X-Coworker-Org-Id": org_id,
    }


def api_load_context(
    organization_id: str, user_id: str | None, session_id: str
) -> tuple[dict[str, Any] | None, int]:
    settings = get_settings()
    base = settings.express_base_url.rstrip("/")
    with httpx.Client(timeout=30.0) as client:
        res = client.get(
            f"{base}/api/coworker/conversation-context",
            params={"sessionId": session_id},
            headers=_headers(organization_id, user_id),
        )
    if res.status_code >= 500:
        raise ConversationContextApiError("conversation_context API load failed")
    if res.status_code == 401:
        raise ConversationContextApiError("conversation_context API unauthorized")
    data = res.json()
    context = data.get("context")
    version = int(data.get("version") or 0)
    if context is None:
        return None, 0
    if not isinstance(context, dict):
        return None, 0
    return dict(context), version


def api_save_context(
    organization_id: str,
    user_id: str | None,
    session_id: str,
    context: dict[str, Any],
    *,
    expected_version: int = 0,
) -> int:
    settings = get_settings()
    base = settings.express_base_url.rstrip("/")
    payload = {
        "sessionId": session_id,
        "context": context,
        "expectedVersion": max(0, int(expected_version)),
    }
    with httpx.Client(timeout=30.0) as client:
        res = client.put(
            f"{base}/api/coworker/conversation-context",
            json=payload,
            headers=_headers(organization_id, user_id),
        )
    if res.status_code == 409:
        raise ConversationContextStaleError(
            "conversation_context was updated by another turn"
        )
    if res.status_code >= 400:
        raise ConversationContextApiError("conversation_context API save failed")
    data = res.json()
    return int(data.get("version") or 0)


def api_persist_workflow_events(
    organization_id: str,
    user_id: str | None,
    session_id: str,
    request_id: str,
    events: list[dict[str, Any]],
) -> None:
    if not events:
        return
    settings = get_settings()
    base = settings.express_base_url.rstrip("/")
    payload = {
        "sessionId": session_id,
        "requestId": request_id,
        "events": events,
    }
    with httpx.Client(timeout=30.0) as client:
        res = client.post(
            f"{base}/api/coworker/workflow-events",
            json=payload,
            headers=_headers(organization_id, user_id),
        )
    if res.status_code >= 400:
        raise ConversationContextApiError("workflow events API persist failed")
