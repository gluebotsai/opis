"""Campaign → Hub remainder escalate (never when source=hub)."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

import httpx

from app.a2a.clients import (
    access_token_valid,
    get_client_by_server_name,
    save_tokens,
)
from app.a2a.traffic_log import log_incoming_hub_response, log_outgoing_hub_request
from app.config import get_settings

_log = logging.getLogger(__name__)


class HubEscalateError(Exception):
    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


def _hub_token_url() -> str:
    s = get_settings()
    if s.hub_a2a_token_url.strip():
        return s.hub_a2a_token_url.rstrip("/")
    return f"{s.hub_a2a_url.rstrip('/')}/token"


def _safe_json(res: httpx.Response) -> dict[str, Any]:
    if not res.content:
        return {}
    try:
        data = res.json()
        return data if isinstance(data, dict) else {"raw": data}
    except Exception:  # noqa: BLE001
        return {"raw_text": (res.text or "")[:500]}


def _payload_json(obj: Any, *, limit: int = 8000) -> str:
    """Compact JSON for log lines (truncated)."""
    try:
        text = json.dumps(obj, default=str, ensure_ascii=False, separators=(",", ":"))
    except Exception:  # noqa: BLE001
        text = repr(obj)
    if len(text) > limit:
        return text[:limit] + "…"
    return text


def _hub_success_summary(data: dict[str, Any]) -> dict[str, Any]:
    """Small always-logged view of Hub success (full body still logged separately)."""
    result = data.get("result") if isinstance(data, dict) else None
    if not isinstance(result, dict):
        return {"raw_keys": list(data.keys()) if isinstance(data, dict) else []}
    status = result.get("status") if isinstance(result.get("status"), dict) else {}
    summary = None
    skill_id = None
    artifacts = result.get("artifacts") or []
    if artifacts and isinstance(artifacts[0], dict):
        parts = artifacts[0].get("parts") or []
        if parts and isinstance(parts[0], dict):
            payload = parts[0].get("data") if isinstance(parts[0].get("data"), dict) else {}
            summary = payload.get("summary")
            skill_id = payload.get("skillId")
    return {
        "task_id": result.get("id"),
        "state": status.get("state"),
        "skillId": skill_id,
        "summary": (str(summary)[:400] if summary else None),
    }


async def mint_hub_access_token() -> str:
    """POST Hub /token and store access on worktual-hub row."""
    s = get_settings()
    if not s.hub_a2a_url.strip():
        raise HubEscalateError("HUB_A2A_URL is not configured")
    if not s.hub_a2a_client_secret.strip():
        raise HubEscalateError(
            "HUB_A2A_CLIENT_SECRET is not configured "
            f"(client_id={s.hub_a2a_client_id})"
        )

    body = {
        "grant_type": "client_credentials",
        "client_id": s.hub_a2a_client_id,
        "client_secret": s.hub_a2a_client_secret,
        "a2a_server_name": s.hub_a2a_server_name,
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(_hub_token_url(), json=body)
            data = _safe_json(res)
    except httpx.RequestError as exc:
        raise HubEscalateError(
            f"Cannot reach Hub token URL {_hub_token_url()}: {exc}",
            status_code=None,
        ) from exc

    if res.status_code >= 400:
        raise HubEscalateError(
            str(
                data.get("error_description")
                or data.get("error")
                or data.get("raw_text")
                or res.text
                or f"HTTP {res.status_code}"
            ),
            status_code=res.status_code,
        )
    access = str(data.get("access_token") or "").strip()
    refresh = str(data.get("refresh_token") or "").strip() or access
    expires_in = int(data.get("expires_in") or s.a2a_access_token_ttl_seconds)
    if not access:
        raise HubEscalateError("Hub /token returned no access_token")
    await save_tokens(
        s.hub_a2a_server_name,
        access_token=access,
        refresh_token=refresh,
        access_ttl_s=expires_in,
        refresh_ttl_s=int(s.a2a_refresh_token_ttl_seconds),
        client_id=s.hub_a2a_client_id,
        client_secret=s.hub_a2a_client_secret,
    )
    return access


async def get_hub_bearer() -> str:
    s = get_settings()
    row = await get_client_by_server_name(s.hub_a2a_server_name)
    if access_token_valid(row) and row and row.access_token:
        return row.access_token
    return await mint_hub_access_token()


def build_remainder_body(
    *,
    cdp_id: str,
    query: str,
    organization_id: str | int,
    channel: str = "chat",
    spoke: str | None = None,
) -> dict[str, Any]:
    """Exact Hub remainder format (Campaign-originated leftover only)."""
    s = get_settings()
    return {
        "cdp_id": str(cdp_id),
        "spoke": spoke or s.hub_a2a_spoke_label,
        "recent_event": {
            "channel": channel or "chat",
            "query": str(query or "").strip(),
        },
        "organization_id": int(organization_id)
        if str(organization_id).isdigit()
        else organization_id,
    }


async def send_remainder_to_hub(
    *,
    cdp_id: str,
    query: str,
    organization_id: str | int,
    channel: str = "chat",
    source: str = "campaign",
) -> dict[str, Any]:
    """
    POST Hub JSON-RPC message/send with remainder body.

    Skip / refuse when source=hub (no ping-pong).
    """
    if str(source or "").strip().lower() in {"hub", "delegated"}:
        return {
            "ok": False,
            "skipped": True,
            "reason": "source=hub — never escalate Hub work back to Hub",
        }

    s = get_settings()
    if not s.hub_a2a_url.strip():
        return {"ok": False, "error": "HUB_A2A_URL empty — escalate disabled"}

    bearer = await get_hub_bearer()
    remainder = build_remainder_body(
        cdp_id=cdp_id,
        query=query,
        organization_id=organization_id,
        channel=channel,
    )
    rpc = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "messageId": str(uuid.uuid4()),
                "metadata": {"source": "campaign"},
                "parts": [{"kind": "data", "data": remainder}],
            }
        },
    }
    hub_invoke = f"{s.hub_a2a_url.rstrip('/')}/"
    log_outgoing_hub_request(url=hub_invoke, rpc=rpc, remainder=remainder)
    _log.info(
        "a2a campaign_instruct hub url=%s org=%s cdp=%s remainder=%s rpc=%s",
        hub_invoke,
        organization_id,
        cdp_id,
        _payload_json(remainder),
        _payload_json(rpc),
    )
    try:
        async with httpx.AsyncClient(timeout=s.hub_a2a_timeout_s) as client:
            res = await client.post(
                hub_invoke,
                headers={
                    "Authorization": f"Bearer {bearer}",
                    "Content-Type": "application/json",
                },
                json=rpc,
            )
            data = _safe_json(res)
    except httpx.RequestError as exc:
        err = (
            f"Cannot reach Hub invoke URL ({type(exc).__name__}): "
            f"{exc or 'timed out / connection closed with empty message'}"
        )
        _log.warning(
            "a2a hub_reply transport_error type=%s repr=%r remainder=%s rpc=%s",
            type(exc).__name__,
            exc,
            _payload_json(remainder),
            _payload_json(rpc),
        )
        log_incoming_hub_response(
            ok=False,
            error=err,
            remainder=remainder,
            hub_response=None,
        )
        return {
            "ok": False,
            "error": err,
            "sent": remainder,
        }

    if res.status_code >= 400:
        err = str(
            data.get("error") or data.get("raw_text") or res.text or f"HTTP {res.status_code}"
        )
        _log.warning(
            "a2a hub_reply error status=%s body=%s remainder=%s",
            res.status_code,
            _payload_json(data),
            _payload_json(remainder),
        )
        log_incoming_hub_response(
            ok=False,
            http_status=res.status_code,
            error=err,
            remainder=remainder,
            hub_response=data,
        )
        return {
            "ok": False,
            "error": err,
            "http_status": res.status_code,
            "sent": remainder,
        }
    _log.info(
        "a2a hub_reply ok status=%s summary=%s remainder=%s hub_response=%s",
        res.status_code,
        _payload_json(_hub_success_summary(data)),
        _payload_json(remainder),
        _payload_json(data, limit=12000),
    )
    log_incoming_hub_response(
        ok=True,
        http_status=res.status_code,
        remainder=remainder,
        hub_response=data,
    )
    return {"ok": True, "sent": remainder, "hub_response": data}


async def diagnose_hub_connectivity() -> dict[str, Any]:
    """Step-by-step Hub reachability for debugging (card → token → optional)."""
    s = get_settings()
    steps: list[dict[str, Any]] = []
    hub = s.hub_a2a_url.rstrip("/")
    out: dict[str, Any] = {
        "hub_url": hub,
        "client_id": s.hub_a2a_client_id,
        "secret_configured": bool(s.hub_a2a_client_secret.strip()),
        "steps": steps,
        "ok": False,
        "root_issue": None,
    }

    if not hub:
        out["root_issue"] = "HUB_A2A_URL empty"
        return out
    if not s.hub_a2a_client_secret.strip():
        out["root_issue"] = "HUB_A2A_CLIENT_SECRET empty — set in .env and restart uvicorn"
        return out

    # Step 1: agent card
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            res = await client.get(f"{hub}/.well-known/agent-card.json")
            data = _safe_json(res)
        steps.append(
            {
                "step": "hub_agent_card",
                "ok": res.status_code < 400 and data.get("id") == "worktual-hub",
                "http_status": res.status_code,
                "hub_id": data.get("id"),
            }
        )
        if res.status_code >= 400:
            out["root_issue"] = f"Hub agent-card HTTP {res.status_code}"
            return out
    except httpx.RequestError as exc:
        steps.append({"step": "hub_agent_card", "ok": False, "error": str(exc)})
        out["root_issue"] = f"Cannot reach Hub ({hub}): {exc}"
        return out

    # Step 2: token
    try:
        access = await mint_hub_access_token()
        steps.append(
            {
                "step": "hub_token",
                "ok": True,
                "access_token_prefix": access[:20] + "…",
            }
        )
    except HubEscalateError as exc:
        steps.append(
            {
                "step": "hub_token",
                "ok": False,
                "error": str(exc),
                "http_status": exc.status_code,
            }
        )
        out["root_issue"] = f"Hub /token failed: {exc}"
        return out

    # Step 3: tiny remainder invoke
    rem = await send_remainder_to_hub(
        cdp_id="bbbbbbbb-cccc-4ddd-8eee-ffff00000001",
        query="Campaign A2A hub-ping diagnostic",
        organization_id=1000,
        channel="chat",
        source="campaign",
    )
    steps.append(
        {
            "step": "hub_message_send",
            "ok": bool(rem.get("ok")),
            "error": rem.get("error"),
            "http_status": rem.get("http_status"),
            "hub_response_keys": list((rem.get("hub_response") or {}).keys())
            if isinstance(rem.get("hub_response"), dict)
            else None,
        }
    )
    if rem.get("ok"):
        out["ok"] = True
        out["root_issue"] = None
    else:
        out["root_issue"] = rem.get("error") or "Hub message/send failed"
    return out
