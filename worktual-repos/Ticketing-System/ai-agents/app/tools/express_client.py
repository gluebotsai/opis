"""Shared HTTP client for Express domain APIs (agents never invent URLs)."""

from __future__ import annotations

import time
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import get_settings
from app.contracts import tool_err, tool_ok
from app.llm_log import log_llm

_actor_ctx: ContextVar["ToolActor | None"] = ContextVar("tool_actor", default=None)


@dataclass(frozen=True)
class ToolActor:
    user_id: str
    organization_id: str
    user_role: str | None = None
    user_name: str | None = None
    request_id: str | None = None
    portal_customer_id: str | None = None


def set_tool_actor(actor: ToolActor | None) -> None:
    _actor_ctx.set(actor)


def get_tool_actor() -> ToolActor | None:
    return _actor_ctx.get()


class _ActorScope:
    def __init__(self, actor: ToolActor | None):
        self._actor = actor
        self._token = None

    def __enter__(self):
        self._token = _actor_ctx.set(self._actor)
        return self

    def __exit__(self, *args):
        if self._token is not None:
            _actor_ctx.reset(self._token)


def tool_actor_scope(actor: ToolActor | None) -> _ActorScope:
    return _ActorScope(actor)


def _base_url() -> str:
    settings = get_settings()
    return (settings.express_base_url or "http://127.0.0.1:3001").rstrip("/")


def _tasks_secret() -> str:
    settings = get_settings()
    secret = (settings.coworker_tasks_secret or "").strip()
    return secret or "worktual-tasks-dev-secret"


def express_request(
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
    params: dict[str, Any] | None = None,
    timeout: float = 30.0,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    """
    Call an Express domain API as the current ToolActor.

    Auth: X-Coworker-Tasks-Key + X-Coworker-Actor-* (service-on-behalf-of).
    Never calls /api/coworker/chat (no recursion).
    """
    actor = get_tool_actor()
    if not actor or not actor.user_id or not actor.organization_id:
        return tool_err("NO_ACTOR", "Tool actor (user/org) is required")

    url_path = path if path.startswith("/") else f"/{path}"
    if url_path.startswith("/api/coworker/"):
        return tool_err("FORBIDDEN_PATH", "Tools must not call coworker chat endpoints")

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-Coworker-Tasks-Key": _tasks_secret(),
        "X-Coworker-Actor-Id": actor.user_id,
        "X-Coworker-Org-Id": actor.organization_id,
    }
    if actor.user_role:
        headers["X-Coworker-Actor-Role"] = actor.user_role
    if actor.user_name:
        headers["X-Coworker-Actor-Name"] = actor.user_name
    if actor.request_id:
        headers["X-Request-Id"] = actor.request_id
    if actor.portal_customer_id:
        headers["X-Portal-Customer-Id"] = actor.portal_customer_id
    if extra_headers:
        headers.update(extra_headers)

    url = f"{_base_url()}{url_path}"
    t0 = time.perf_counter()
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.request(
                method.upper(),
                url,
                json=json_body,
                params=params,
                headers=headers,
            )
    except httpx.HTTPError as exc:
        log_llm(
            kind="express_tool_error",
            user_text=f"{method} {url_path}",
            response="",
            error=str(exc),
            ms=(time.perf_counter() - t0) * 1000,
            organization_id=actor.organization_id,
            user_id=actor.user_id,
        )
        return tool_err("TRANSPORT", f"Express unreachable: {exc}")

    ms = (time.perf_counter() - t0) * 1000
    try:
        data = resp.json() if resp.content else {}
    except Exception:
        data = {"raw": (resp.text or "")[:400]}

    log_llm(
        kind="express_tool",
        user_text=f"{method} {url_path}",
        response=f"status={resp.status_code} {str(data)[:350]}",
        ms=ms,
        organization_id=actor.organization_id,
        user_id=actor.user_id,
    )

    if resp.status_code >= 400:
        message = ""
        if isinstance(data, dict):
            message = str(data.get("error") or data.get("detail") or data.get("message") or "")
        if not message:
            message = resp.reason_phrase or f"HTTP {resp.status_code}"
        code = "HTTP_ERROR"
        if resp.status_code == 400:
            code = "BAD_INPUT"
        elif resp.status_code == 401:
            code = "UNAUTHORIZED"
        elif resp.status_code == 403:
            code = "FORBIDDEN"
        elif resp.status_code == 404:
            code = "NOT_FOUND"
        elif resp.status_code == 422:
            code = "UNPROCESSABLE"
        elif resp.status_code == 409:
            code = "CONFLICT"
        return tool_err(code, message, payload=data if isinstance(data, dict) else {}, http_status=resp.status_code)

    return tool_ok(data if isinstance(data, dict) else {"data": data})
