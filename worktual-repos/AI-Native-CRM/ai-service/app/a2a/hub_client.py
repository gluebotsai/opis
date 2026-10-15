"""Outbound A2A client: CRM → Hub only for leftover non-CRM work.

Never used for clarifying follow-ups. Hub-originated tasks never bounce back
(see escalate.is_delegated). Tokens live on accounts.a2a_spoke_clients
(a2a_server_name = worktual-hub), same table as Hub → CRM.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping

import httpx

from app.config import get_settings

log = logging.getLogger("ai-service.a2a.hub_client")

_SKEW = timedelta(seconds=60)


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def hub_base_url() -> str:
    return get_settings().hub_a2a_url.rstrip("/")


def hub_token_url() -> str:
    settings = get_settings()
    explicit = (settings.hub_a2a_token_url or "").strip()
    if explicit:
        return explicit.rstrip("/")
    base = hub_base_url()
    return f"{base}/token" if base else ""


def hub_server_name() -> str:
    return (get_settings().hub_a2a_server_name or "worktual-hub").strip() or "worktual-hub"


def hub_invoke_timeout() -> float:
    raw = int(get_settings().hub_a2a_timeout_seconds or 300)
    return float(max(60, min(900, raw)))


def _access_live(record: Any) -> bool:
    token = str(getattr(record, "access_token", None) or "").strip()
    expires = _aware(getattr(record, "access_expires_at", None))
    if not token or expires is None:
        return False
    return expires > datetime.now(timezone.utc) + _SKEW


def _refresh_live(record: Any) -> bool:
    token = str(getattr(record, "refresh_token", None) or "").strip()
    expires = _aware(getattr(record, "refresh_expires_at", None))
    if not token:
        return False
    if expires is None:
        return True
    return expires > datetime.now(timezone.utc)


async def _mint_hub_tokens(*, grant: str, refresh_token: str | None = None) -> dict[str, Any]:
    from app.a2a.log import decode_body, log_http_exchange

    settings = get_settings()
    client_id = (settings.hub_a2a_client_id or "").strip()
    client_secret = (settings.hub_a2a_client_secret or "").strip()
    token_url = hub_token_url()
    if not token_url or not client_id or not client_secret:
        raise RuntimeError("Hub token client is not configured")
    body: dict[str, Any] = {
        "grant_type": grant,
        "client_id": client_id,
        "client_secret": client_secret,
        "a2a_server_name": hub_server_name(),
    }
    if grant == "refresh_token":
        body["refresh_token"] = refresh_token or ""
    started = datetime.now(timezone.utc)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(token_url, json=body)
            elapsed_ms = (datetime.now(timezone.utc) - started).total_seconds() * 1000
            try:
                payload = response.json()
            except Exception:  # noqa: BLE001
                payload = decode_body(response.content)
            log_http_exchange(
                direction="crm_to_hub",
                method="POST",
                url=token_url,
                status=response.status_code,
                request=body,
                response=payload,
                ms=elapsed_ms,
            )
            response.raise_for_status()
    except httpx.HTTPStatusError:
        raise
    except Exception as exc:  # noqa: BLE001
        log_http_exchange(
            direction="crm_to_hub",
            method="POST",
            url=token_url,
            request=body,
            error=str(exc) or type(exc).__name__,
        )
        raise
    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise RuntimeError("Hub /token did not return access_token")
    return payload


async def _store_hub_tokens(issued: Mapping[str, Any], *, client_secret: str) -> str:
    from app.a2a.clients import persist_tokens
    from app.a2a.log import log_a2a

    settings = get_settings()
    now = datetime.now(timezone.utc)
    access = str(issued.get("access_token") or "")
    refresh = str(issued.get("refresh_token") or "")
    expires_in = int(issued.get("expires_in") or 21600)
    refresh_expires_in = int(issued.get("refresh_expires_in") or 5_184_000)
    await persist_tokens(
        client_id=(settings.hub_a2a_client_id or "").strip(),
        server_name=hub_server_name(),
        access_token=access,
        access_expires_at=now + timedelta(seconds=max(60, expires_in)),
        refresh_token=refresh,
        refresh_expires_at=now + timedelta(seconds=max(3600, refresh_expires_in)),
        skill_version=str(issued.get("skillVersion") or issued.get("skill_version") or ""),
        client_secret=client_secret,
    )
    log_a2a(
        step="hub_token",
        ok=True,
        hub={"a2a_server_name": hub_server_name(), "grant": "token"},
        crm={"stored": "accounts.a2a_spoke_clients", "expires_in": expires_in},
    )
    return access


async def hub_access_token() -> str:
    """SELECT live Hub access token; mint/refresh via Hub /token and UPDATE the row."""
    from app.a2a.clients import ensure_seed_row, load_client_by_server

    settings = get_settings()
    await ensure_seed_row()
    record = await load_client_by_server(hub_server_name())
    if record is None:
        raise RuntimeError("Hub peer client row is missing on accounts.a2a_spoke_clients")
    if _access_live(record):
        return str(record.access_token)
    grant = "refresh_token" if _refresh_live(record) else "client_credentials"
    try:
        issued = await _mint_hub_tokens(
            grant=grant,
            refresh_token=str(record.refresh_token or "") if grant == "refresh_token" else None,
        )
    except Exception:
        if grant == "refresh_token":
            issued = await _mint_hub_tokens(grant="client_credentials")
        else:
            raise
    return await _store_hub_tokens(issued, client_secret=record.client_secret or settings.hub_a2a_client_secret)


def leftover_domain_tags() -> tuple[str, ...]:
    """Domains CRM does not own. Not Hub's skill catalog."""
    return tuple(
        item.strip().lower()
        for item in get_settings().a2a_peer_skill_tags.split(",")
        if item.strip()
    )


def remainder_channel(metadata: Mapping[str, Any]) -> str:
    raw = str(metadata.get("channel") or metadata.get("surface") or "").strip().lower()
    if raw in {"email", "mail", "inbox"}:
        return "email"
    if raw in {"voice", "call", "phone"}:
        return "voice"
    return "chat"


def remainder_body(*, text: str, metadata: Mapping[str, Any]) -> dict[str, Any]:
    """Hub remainder data part. Query only — no Hub skillId."""
    settings = get_settings()
    cdp = metadata.get("cdp_id") or metadata.get("cdpId") or metadata.get("contactId") or metadata.get("contact_id")
    org_raw = metadata.get("organization_id") if "organization_id" in metadata else metadata.get("organizationId")
    org: Any = None
    if org_raw not in (None, ""):
        try:
            org = int(str(org_raw).strip())
        except ValueError:
            org = org_raw
    body: dict[str, Any] = {
        "spoke": (settings.hub_a2a_spoke_label or "CRM").strip() or "CRM",
        "recent_event": {
            "channel": remainder_channel(metadata),
            "query": text,
        },
    }
    if cdp not in (None, ""):
        body["cdp_id"] = str(cdp)
    if org is not None:
        body["organization_id"] = org
    return body


async def send_to_hub(
    *,
    text: str,
    metadata: Mapping[str, Any],
    context_id: str | None = None,
    task_id: str | None = None,
) -> dict[str, Any]:
    from app.a2a.log import crm_instruction, decode_body, hub_reply, log_a2a, log_http_exchange, start_a2a_trace
    from app.agent_log import current_trace_id

    base = hub_base_url()
    if not base:
        raise RuntimeError("HUB_A2A_URL is not configured")
    if not current_trace_id():
        start_a2a_trace()
    token = await hub_access_token()
    data = remainder_body(text=text, metadata=metadata)
    instruct = crm_instruction(data)
    log_a2a(
        step="crm_instruct",
        hub={"target": base, "spoke": data.get("spoke")},
        crm=instruct,
        instruction=data,
        message="CRM remainder sent to Hub",
    )
    message = {
        "role": "user",
        "messageId": str(uuid.uuid4()),
        "contextId": context_id or "",
        "taskId": task_id or "",
        "parts": [{"kind": "data", "data": data}],
        "metadata": {"source": "crm"},
    }
    payload = {
        "jsonrpc": "2.0",
        "id": str(uuid.uuid4()),
        "method": "message/send",
        "params": {"message": message},
    }
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    invoke_url = f"{base}/"
    try:
        started = datetime.now(timezone.utc)
        async with httpx.AsyncClient(timeout=hub_invoke_timeout()) as client:
            response = await client.post(invoke_url, json=payload, headers=headers)
            elapsed_ms = (datetime.now(timezone.utc) - started).total_seconds() * 1000
            try:
                body = response.json()
            except Exception:  # noqa: BLE001
                body = decode_body(getattr(response, "content", None))
            log_http_exchange(
                direction="crm_to_hub",
                method="POST",
                url=invoke_url,
                status=response.status_code,
                request=payload,
                response=body,
                ms=elapsed_ms,
            )
            response.raise_for_status()
    except (httpx.ReadTimeout, httpx.WriteTimeout) as exc:
        # Hub already accepted the remainder; it often dispatches CRM after our wait.
        log_http_exchange(
            direction="crm_to_hub",
            method="POST",
            url=invoke_url,
            request=payload,
            error="invoke_timeout",
        )
        log_a2a(
            step="hub_reply",
            ok=True,
            hub={"target": base, "state": "working", "error": "invoke_timeout"},
            crm={
                "outcome": "pending",
                "message": "Hub invoke still running after timeout",
            },
            message="Hub leftover work still running",
        )
        log.info("Hub invoke timed out; remainder left pending: %s", exc)
        return {
            "ok": True,
            "pending": True,
            "status": {"state": "working"},
            "assistantText": (
                "Hub is still working on this leftover request. "
                "It will call CRM when it has a next action."
            ),
        }
    except httpx.HTTPStatusError as exc:
        log_a2a(
            step="hub_reply",
            ok=False,
            hub={"target": base, "error": str(exc)},
            crm={"outcome": "error", "message": "Hub invoke failed"},
        )
        raise
    except Exception as exc:  # noqa: BLE001
        log_http_exchange(
            direction="crm_to_hub",
            method="POST",
            url=invoke_url,
            request=payload,
            error=str(exc) or type(exc).__name__,
        )
        log_a2a(
            step="hub_reply",
            ok=False,
            hub={"target": base, "error": str(exc)},
            crm={"outcome": "error", "message": "Hub invoke failed"},
        )
        raise
    if not isinstance(body, dict):
        result: dict[str, Any] = {"result": str(body)}
    elif body.get("error"):
        result = {"ok": False, "error": body.get("error")}
    else:
        result = body.get("result") if isinstance(body.get("result"), dict) else body
    reply = hub_reply(result if isinstance(result, dict) else {"result": result})
    state = str(reply.get("state") or "").lower()
    failed = isinstance(result, dict) and (result.get("ok") is False or state in {"failed", "canceled", "rejected"})
    log_a2a(
        step="hub_reply",
        ok=not failed,
        hub=reply,
        crm={
            "outcome": "error" if failed else (state or "received"),
            "message": reply.get("speech")
            or (str(reply.get("error")) if reply.get("error") else "Hub leftover work received"),
            "taskId": reply.get("taskId"),
        },
        message="Hub leftover work received" if not failed else "Hub leftover work failed",
    )
    if failed:
        if not isinstance(result, dict):
            return {"ok": False, "error": reply.get("error") or "Hub leftover work failed"}
        out = {**result, "ok": False}
        if not out.get("error") and reply.get("error"):
            out["error"] = reply["error"]
        return out
    return result
