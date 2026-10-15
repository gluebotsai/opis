"""Fetch triage roster/teams/workload via Ticketing API (no direct business SQL)."""

from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings


def _use_api() -> bool:
    flag = str(getattr(get_settings(), "agent_data_via_api", "1")).strip().lower()
    if flag in ("0", "false", "no", "off"):
        return False
    return bool(get_settings().express_base_url and get_settings().coworker_tasks_secret)


def _headers(org_id: str) -> dict[str, str]:
    settings = get_settings()
    return {
        "X-Coworker-Tasks-Key": settings.coworker_tasks_secret or "worktual-tasks-dev-secret",
        "X-Coworker-Org-Id": org_id,
    }


def fetch_triage_context(org_id: str) -> dict[str, Any]:
    settings = get_settings()
    base = settings.express_base_url.rstrip("/")
    with httpx.Client(timeout=45.0) as client:
        res = client.get(f"{base}/api/coworker/triage-data", headers=_headers(org_id))
    if res.status_code >= 400:
        raise RuntimeError(f"triage-data API failed: HTTP {res.status_code}")
    return dict(res.json())
