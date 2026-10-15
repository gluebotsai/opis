"""Plain HTTP Hub A2A client (Ticketing → Hub remainder). No LangGraph/LangChain."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import get_settings
from app.db import execute, fetch_one

logger = logging.getLogger(__name__)


def _hub_base_url() -> str:
    settings = get_settings()
    return (settings.hub_a2a_url or "").strip().rstrip("/")


def _token_url() -> str:
    settings = get_settings()
    explicit = (settings.hub_a2a_token_url or "").strip()
    if explicit:
        return explicit.rstrip("/")
    base = _hub_base_url()
    return f"{base}/token" if base else ""


def _spoke_label() -> str:
    return (get_settings().hub_a2a_spoke_label or "Ticketing System").strip()


def build_remainder_body(
    *,
    cdp_id: str,
    query: str,
    organization_id: int | str,
    channel: str = "chat",
    spoke: str | None = None,
) -> dict[str, Any]:
    """Fixed Hub remainder shape — only values change."""
    org = organization_id
    try:
        org_int = int(str(org).strip())
    except (TypeError, ValueError):
        org_int = org
    ch = str(channel or "chat").strip().lower()
    if ch not in ("chat", "email"):
        ch = "chat"
    return {
        "cdp_id": str(cdp_id or "").strip(),
        "spoke": str(spoke or _spoke_label()).strip() or "Ticketing System",
        "recent_event": {
            "channel": ch,
            "query": str(query or "").strip()[:4000],
        },
        "organization_id": org_int,
    }


def _parse_expiry(payload: dict[str, Any]) -> datetime | None:
    """Best-effort expiry from token response."""
    now = datetime.now(timezone.utc)
    for key in ("expires_at", "access_token_expires_at", "expiry"):
        raw = payload.get(key)
        if not raw:
            continue
        try:
            if isinstance(raw, (int, float)):
                ts = float(raw)
                if ts > 1e12:
                    ts /= 1000.0
                return datetime.fromtimestamp(ts, tz=timezone.utc)
            text = str(raw).strip().replace("Z", "+00:00")
            return datetime.fromisoformat(text)
        except Exception:  # noqa: BLE001
            continue
    expires_in = payload.get("expires_in")
    try:
        seconds = int(expires_in)
        if seconds > 0:
            # Refresh a bit early
            return now + timedelta(seconds=max(60, seconds - 120))
    except (TypeError, ValueError):
        pass
    # Hub access ~6h per CRM docs — conservative reuse window
    return now + timedelta(hours=5)


def _row_token_usable(row: dict[str, Any] | None) -> str | None:
    if not isinstance(row, dict):
        return None
    token = str(row.get("access_token") or "").strip()
    if not token:
        return None
    for key in ("access_token_expires_at", "expires_at", "token_expires_at"):
        raw = row.get(key)
        if raw is None:
            continue
        try:
            if isinstance(raw, datetime):
                exp = raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
            else:
                exp = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
            if exp <= datetime.now(timezone.utc):
                return None
        except Exception:  # noqa: BLE001
            break
    return token


def _load_client_row(server_name: str, client_id: str) -> dict[str, Any] | None:
    return fetch_one(
        """
        SELECT *
        FROM accounts.a2a_spoke_clients
        WHERE a2a_server_name = %s AND client_id = %s
        LIMIT 1
        """,
        (server_name, client_id),
    )


def _persist_tokens(
    *,
    server_name: str,
    client_id: str,
    access_token: str,
    refresh_token: str | None,
    expires_at: datetime | None,
) -> None:
    """Update token columns; tolerate missing optional expiry column names."""
    refresh = str(refresh_token or "").strip() or None
    # Prefer updating known columns; fall back if expiry column absent.
    attempts: list[tuple[str, tuple[Any, ...]]] = []
    if expires_at is not None:
        attempts.append(
            (
                """
                UPDATE accounts.a2a_spoke_clients
                SET access_token = %s,
                    refresh_token = COALESCE(%s, refresh_token),
                    access_token_expires_at = %s
                WHERE a2a_server_name = %s AND client_id = %s
                """,
                (access_token, refresh, expires_at, server_name, client_id),
            )
        )
        attempts.append(
            (
                """
                UPDATE accounts.a2a_spoke_clients
                SET access_token = %s,
                    refresh_token = COALESCE(%s, refresh_token),
                    expires_at = %s
                WHERE a2a_server_name = %s AND client_id = %s
                """,
                (access_token, refresh, expires_at, server_name, client_id),
            )
        )
    attempts.append(
        (
            """
            UPDATE accounts.a2a_spoke_clients
            SET access_token = %s,
                refresh_token = COALESCE(%s, refresh_token)
            WHERE a2a_server_name = %s AND client_id = %s
            """,
            (access_token, refresh, server_name, client_id),
        )
    )
    last_exc: Exception | None = None
    for sql, params in attempts:
        try:
            execute(sql, params)
            return
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            continue
    if last_exc:
        raise last_exc


def mint_hub_access_token() -> str:
    """POST Hub /token and persist access on accounts.a2a_spoke_clients."""
    settings = get_settings()
    token_url = _token_url()
    if not token_url:
        raise RuntimeError("HUB_A2A_URL / HUB_A2A_TOKEN_URL is not configured")
    client_id = (settings.hub_a2a_client_id or "worktual-ticketing-hub").strip()
    env_secret = (settings.hub_a2a_client_secret or "").strip()
    server = (settings.hub_a2a_server_name or "worktual-hub").strip()
    row = _load_client_row(server, client_id)
    db_secret = (
        str(row.get("client_secret") or "").strip() if isinstance(row, dict) else ""
    )
    # Prefer env; fall back to the shared spoke-client row when secrets drift.
    secrets: list[str] = []
    for candidate in (env_secret, db_secret):
        if candidate and candidate not in secrets:
            secrets.append(candidate)
    if not secrets:
        raise RuntimeError("HUB_A2A_CLIENT_SECRET is not configured")
    timeout = float(settings.hub_a2a_timeout or 120.0)
    logger.info(
        "hub_a2a mint_token client_id=%s server=%s",
        client_id,
        server,
    )
    last_status = 0
    last_body = ""
    data: dict[str, Any] | None = None
    with httpx.Client(timeout=httpx.Timeout(timeout, connect=10.0)) as client:
        for secret in secrets:
            body = {
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": secret,
                "a2a_server_name": server,
            }
            resp = client.post(token_url, json=body)
            last_status = resp.status_code
            last_body = (resp.text or "")[:300]
            if resp.status_code < 400:
                parsed = resp.json() if resp.content else {}
                if isinstance(parsed, dict):
                    data = parsed
                    break
            # Wrong secret → try the other candidate once.
            if resp.status_code in (401, 403) and "invalid client_secret" in last_body:
                continue
            raise RuntimeError(f"Hub /token HTTP {resp.status_code}: {last_body}")
    if data is None:
        raise RuntimeError(f"Hub /token HTTP {last_status}: {last_body}")
    access = str(
        data.get("access_token") or data.get("accessToken") or ""
    ).strip()
    if not access:
        raise RuntimeError("Hub /token response missing access_token")
    refresh = str(
        data.get("refresh_token") or data.get("refreshToken") or ""
    ).strip() or None
    expires_at = _parse_expiry(data)
    _persist_tokens(
        server_name=server,
        client_id=client_id,
        access_token=access,
        refresh_token=refresh,
        expires_at=expires_at,
    )
    return access


def get_or_mint_hub_access() -> str:
    """Reuse DB access_token for worktual-hub or mint via Hub /token."""
    settings = get_settings()
    client_id = (settings.hub_a2a_client_id or "worktual-ticketing-hub").strip()
    server = (settings.hub_a2a_server_name or "worktual-hub").strip()
    row = _load_client_row(server, client_id)
    token = _row_token_usable(row)
    if token:
        return token
    return mint_hub_access_token()


def send_remainder(
    *,
    cdp_id: str,
    query: str,
    organization_id: int | str,
    channel: str = "chat",
    force_remint: bool = False,
) -> dict[str, Any]:
    """POST Hub JSON-RPC message/send with the fixed remainder body."""
    settings = get_settings()
    base = _hub_base_url()
    if not base:
        raise RuntimeError("HUB_A2A_URL is not configured")
    cdp = str(cdp_id or "").strip()
    if not cdp:
        raise ValueError("cdp_id is required")
    q = str(query or "").strip()
    if not q:
        raise ValueError("query is required")

    remainder = build_remainder_body(
        cdp_id=cdp,
        query=q,
        organization_id=organization_id,
        channel=channel,
    )
    message_id = str(uuid.uuid4())
    rpc = {
        "jsonrpc": "2.0",
        "id": message_id,
        "method": "message/send",
        "params": {
            "message": {
                "role": "user",
                "messageId": message_id,
                "parts": [{"kind": "data", "data": remainder}],
                "metadata": {"source": "ticketing"},
            }
        },
    }
    timeout = float(settings.hub_a2a_timeout or 120.0)
    logger.info(
        "ticketing_instruct org=%s cdp_id=%s channel=%s query_len=%s",
        remainder.get("organization_id"),
        cdp,
        remainder["recent_event"]["channel"],
        len(q),
    )

    def _post(token: str) -> httpx.Response:
        with httpx.Client(timeout=httpx.Timeout(timeout, connect=10.0)) as client:
            return client.post(
                f"{base}/",
                json=rpc,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
            )

    def _rpc_auth_expired(payload: Any) -> bool:
        if not isinstance(payload, dict):
            return False
        err = payload.get("error")
        if not isinstance(err, dict):
            return False
        code = err.get("code")
        msg = str(err.get("message") or "").strip().lower()
        if code in (-32001, 401, 403):
            return True
        return "access token" in msg and (
            "expired" in msg or "invalid" in msg or "unauthorized" in msg
        )

    access = mint_hub_access_token() if force_remint else get_or_mint_hub_access()
    resp = _post(access)
    if resp.status_code in (401, 403) and not force_remint:
        access = mint_hub_access_token()
        resp = _post(access)
    if resp.status_code >= 400:
        logger.warning(
            "hub_reply http_error status=%s body=%s",
            resp.status_code,
            (resp.text or "")[:400],
        )
        raise RuntimeError(f"Hub message/send HTTP {resp.status_code}")

    data: Any
    try:
        data = resp.json() if resp.content else {}
    except Exception:  # noqa: BLE001
        data = {"raw": (resp.text or "")[:2000]}

    # Hub may return HTTP 200 with JSON-RPC auth expiry; remint once and retry.
    if _rpc_auth_expired(data) and not force_remint:
        logger.info("hub_reply jsonrpc auth expired; reminting access token")
        access = mint_hub_access_token()
        resp = _post(access)
        if resp.status_code >= 400:
            raise RuntimeError(f"Hub message/send HTTP {resp.status_code}")
        try:
            data = resp.json() if resp.content else {}
        except Exception:  # noqa: BLE001
            data = {"raw": (resp.text or "")[:2000]}

    logger.info(
        "hub_reply ok keys=%s",
        list(data.keys()) if isinstance(data, dict) else type(data).__name__,
    )
    return {
        "remainder": remainder,
        "message_id": message_id,
        "hub_response": data,
    }
