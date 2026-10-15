"""Proactive store persistence via Ticketing API."""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings


def _use_api() -> bool:
    flag = str(getattr(get_settings(), "proactive_via_api", "1")).strip().lower()
    if flag in ("0", "false", "no", "off"):
        return False
    return bool(get_settings().express_base_url and get_settings().coworker_tasks_secret)


def _headers(org_id: str) -> dict[str, str]:
    settings = get_settings()
    return {
        "Content-Type": "application/json",
        "X-Coworker-Tasks-Key": settings.coworker_tasks_secret or "worktual-tasks-dev-secret",
        "X-Coworker-Org-Id": org_id,
    }


def _base() -> str:
    return get_settings().express_base_url.rstrip("/")


def api_mark_event_processed(org_id: str, event_id: str) -> bool:
    with httpx.Client(timeout=30.0) as client:
        res = client.post(
            f"{_base()}/api/internal/proactive/outbox/{event_id}/processed",
            headers=_headers(org_id),
        )
    if res.status_code >= 400:
        raise RuntimeError(f"outbox processed API failed: {res.status_code}")
    return bool(res.json().get("firstTime"))


def api_insert_recommendation(row: dict[str, Any]) -> dict[str, Any]:
    org_id = str(row["organization_id"])
    with httpx.Client(timeout=30.0) as client:
        res = client.post(
            f"{_base()}/api/internal/proactive/recommendations",
            headers=_headers(org_id),
            json=row,
        )
    if res.status_code >= 400:
        raise RuntimeError(f"insert recommendation API failed: {res.status_code}")
    return dict(res.json())


def api_insert_approval(row: dict[str, Any]) -> dict[str, Any]:
    org_id = str(row["organization_id"])
    with httpx.Client(timeout=30.0) as client:
        res = client.post(
            f"{_base()}/api/internal/proactive/approvals",
            headers=_headers(org_id),
            json=row,
        )
    if res.status_code >= 400:
        raise RuntimeError(f"insert approval API failed: {res.status_code}")
    return dict(res.json())


def api_list_approvals(org_id: str, *, status: str = "pending") -> list[dict[str, Any]]:
    with httpx.Client(timeout=30.0) as client:
        res = client.get(
            f"{_base()}/api/internal/proactive/approvals",
            headers=_headers(org_id),
            params={"organization_id": org_id, "status": status},
        )
    if res.status_code >= 400:
        raise RuntimeError(f"list approvals API failed: {res.status_code}")
    return list(res.json().get("items") or [])


def api_get_approval(org_id: str, approval_id: str) -> dict[str, Any] | None:
    with httpx.Client(timeout=30.0) as client:
        res = client.get(
            f"{_base()}/api/internal/proactive/approvals/{approval_id}",
            headers=_headers(org_id),
            params={"organization_id": org_id},
        )
    if res.status_code >= 400:
        raise RuntimeError(f"get approval API failed: {res.status_code}")
    data = res.json()
    return dict(data) if data else None


def api_set_approval_status(org_id: str, approval_id: str, status: str) -> None:
    with httpx.Client(timeout=30.0) as client:
        res = client.patch(
            f"{_base()}/api/internal/proactive/approvals/{approval_id}/status",
            headers=_headers(org_id),
            json={"organization_id": org_id, "status": status},
        )
    if res.status_code >= 400:
        raise RuntimeError(f"set approval status API failed: {res.status_code}")


def api_list_recommendations(
    org_id: str, *, ticket_number: str | None = None
) -> list[dict[str, Any]]:
    params: dict[str, str] = {"organization_id": org_id}
    if ticket_number:
        params["ticket_number"] = ticket_number
    with httpx.Client(timeout=30.0) as client:
        res = client.get(
            f"{_base()}/api/internal/proactive/recommendations",
            headers=_headers(org_id),
            params=params,
        )
    if res.status_code >= 400:
        raise RuntimeError(f"list recommendations API failed: {res.status_code}")
    return list(res.json().get("items") or [])


def api_recent_similar_recommendation(
    org_id: str,
    agent_id: str,
    summary: str,
    *,
    dedupe_key: str = "",
    ticket_number: str | None = None,
    hours: int = 24,
) -> bool:
    key = " ".join((summary or "").strip().lower().split())
    params: dict[str, str] = {
        "organization_id": org_id,
        "agent_id": agent_id,
        "summary": key,
        "hours": str(hours),
    }
    if dedupe_key:
        params["dedupe_key"] = dedupe_key
    if ticket_number:
        params["ticket_number"] = ticket_number
    with httpx.Client(timeout=30.0) as client:
        res = client.get(
            f"{_base()}/api/internal/proactive/recommendations/similar",
            headers=_headers(org_id),
            params=params,
        )
    if res.status_code >= 400:
        raise RuntimeError(f"similar recommendation API failed: {res.status_code}")
    return bool(res.json().get("exists"))


def api_write_audit(row: dict[str, Any]) -> None:
    org_id = str(row["organization_id"])
    with httpx.Client(timeout=30.0) as client:
        res = client.post(
            f"{_base()}/api/internal/proactive/audit",
            headers=_headers(org_id),
            json=row,
        )
    if res.status_code >= 400:
        raise RuntimeError(f"write audit API failed: {res.status_code}")


def api_already_audited_event(agent_id: str, event_id: str, org_id: str) -> bool:
    with httpx.Client(timeout=30.0) as client:
        res = client.get(
            f"{_base()}/api/internal/proactive/audit/exists",
            headers=_headers(org_id),
            params={"agent_id": agent_id, "event_id": event_id},
        )
    if res.status_code >= 400:
        raise RuntimeError(f"audit exists API failed: {res.status_code}")
    return bool(res.json().get("exists"))


def api_get_routing_weights(org_id: str) -> dict[str, Any]:
    with httpx.Client(timeout=30.0) as client:
        res = client.get(
            f"{_base()}/api/internal/proactive/routing-weights",
            headers=_headers(org_id),
            params={"organization_id": org_id},
        )
    if res.status_code >= 400:
        raise RuntimeError(f"routing weights API failed: {res.status_code}")
    return dict(res.json().get("weights") or {})


def api_set_routing_weights(org_id: str, weights: dict[str, Any]) -> None:
    with httpx.Client(timeout=30.0) as client:
        res = client.put(
            f"{_base()}/api/internal/proactive/routing-weights",
            headers=_headers(org_id),
            json={"organization_id": org_id, "weights": weights},
        )
    if res.status_code >= 400:
        raise RuntimeError(f"set routing weights API failed: {res.status_code}")


def api_pending_outbox(limit: int = 25) -> list[dict[str, Any]]:
    settings = get_settings()
    headers = {
        "X-Coworker-Tasks-Key": settings.coworker_tasks_secret or "worktual-tasks-dev-secret",
    }
    with httpx.Client(timeout=30.0) as client:
        res = client.get(
            f"{_base()}/api/internal/proactive/outbox/pending",
            headers=headers,
            params={"limit": str(limit)},
        )
    if res.status_code >= 400:
        raise RuntimeError(f"pending outbox API failed: {res.status_code}")
    return list(res.json().get("items") or [])


def api_list_organizations() -> list[str]:
    settings = get_settings()
    headers = {
        "X-Coworker-Tasks-Key": settings.coworker_tasks_secret or "worktual-tasks-dev-secret",
    }
    with httpx.Client(timeout=30.0) as client:
        res = client.get(f"{_base()}/api/internal/organizations", headers=headers)
    if res.status_code >= 400:
        raise RuntimeError(f"list organizations API failed: {res.status_code}")
    return list(res.json().get("items") or [])
