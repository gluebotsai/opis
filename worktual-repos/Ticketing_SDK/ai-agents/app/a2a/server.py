"""A2A spoke HTTP server — agent card, token mint, JSON-RPC invoke."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse

from app.a2a.access_token import mint_access_token, mint_refresh_token
from app.a2a.auth import AuthError, verify_invoke_token
from app.a2a.card import (
    build_agent_card,
    build_extended_agent_card,
    public_base_url,
)
from app.a2a.catalog import is_hub_card_skill, skill_version
from app.a2a.clients import (
    persist_tokens,
    validate_client_credentials,
    validate_refresh_token,
)
from app.a2a.contracts import contract_document, skill_input_schema
from app.a2a.dispatch import dispatch_from_message
from app.a2a.log import log_event
from app.a2a.store import get_task
from app.config import get_settings

router = APIRouter()


def _jsonrpc_error(rpc_id: Any, code: int, message: str) -> JSONResponse:
    return JSONResponse(
        {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}}
    )


def _jsonrpc_result(rpc_id: Any, result: Any) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": rpc_id, "result": result})


def _hub_token_meta(body: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "grant_type": str(body.get("grant_type") or "client_credentials").strip(),
        "client_id": str(body.get("client_id") or "").strip(),
    }
    server = str(body.get("a2a_server_name") or "").strip()
    if server:
        out["a2a_server_name"] = server
    return out


@router.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "ticketing-a2a"}


@router.get("/.well-known/agent-card.json")
def agent_card() -> dict[str, Any]:
    return build_agent_card()


@router.get("/.well-known/oauth-authorization-server")
def oauth_authorization_server_metadata() -> dict[str, Any]:
    base = public_base_url()
    return {
        "issuer": base,
        "token_endpoint": f"{base}/oauth/token",
        "grant_types_supported": ["client_credentials", "refresh_token"],
        "token_endpoint_auth_methods_supported": ["client_secret_post"],
        "response_types_supported": ["token"],
    }


@router.get("/a2a/agent-card/extended")
def agent_card_extended(
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    settings = get_settings()
    auth = str(authorization or "").strip()
    if settings.a2a_allow_dev_auth and auth.lower() == "bearer dev":
        return JSONResponse(build_extended_agent_card())
    try:
        verify_invoke_token(authorization)
    except AuthError as exc:
        return JSONResponse(
            {"error": "unauthorized", "message": exc.message},
            status_code=401,
        )
    return JSONResponse(build_extended_agent_card())


@router.get("/a2a/contracts/{name}")
def contract_by_name(name: str) -> JSONResponse:
    doc = contract_document(name)
    if not doc:
        return JSONResponse({"error": "not_found", "message": name}, status_code=404)
    return JSONResponse(doc)


@router.get("/a2a/contracts/skills/{skill_file}")
def skill_contract(skill_file: str) -> JSONResponse:
    sid = str(skill_file or "").strip()
    if sid.endswith(".v1.json"):
        sid = sid[: -len(".v1.json")]
    if not is_hub_card_skill(sid):
        return JSONResponse(
            {"error": "not_found", "message": f"unknown skill {sid}"},
            status_code=404,
        )
    schema = skill_input_schema(sid)
    if not schema:
        return JSONResponse(
            {"error": "not_found", "message": f"no input schema for {sid}"},
            status_code=404,
        )
    return JSONResponse(schema)


async def _token_response(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        log_event(
            "token",
            ok=False,
            hub={},
            ticketing={"error": "invalid_request", "message": "invalid_json", "http": 400},
        )
        return JSONResponse(
            {"error": "invalid_request", "message": "invalid_json"},
            status_code=400,
        )
    if not isinstance(body, dict):
        log_event(
            "token",
            ok=False,
            hub={},
            ticketing={"error": "invalid_request", "message": "invalid_body", "http": 400},
        )
        return JSONResponse(
            {"error": "invalid_request", "message": "invalid_body"},
            status_code=400,
        )

    settings = get_settings()
    server_name = (settings.a2a_server_name or "worktual-ticketing").strip()
    client_id = str(body.get("client_id") or "").strip()
    client_secret = str(body.get("client_secret") or "").strip()
    grant = str(body.get("grant_type") or "client_credentials").strip()
    req_server = str(body.get("a2a_server_name") or "").strip()
    hub_meta = _hub_token_meta(body)
    ttl = max(60, int(settings.a2a_access_token_ttl_seconds or 21600))
    refresh_ttl = max(60, int(settings.a2a_refresh_token_ttl_seconds or 5184000))
    live_ver = skill_version()

    if req_server and req_server != server_name:
        log_event(
            "token",
            ok=False,
            hub=hub_meta,
            ticketing={
                "error": "invalid_request",
                "message": f"a2a_server_name must be {server_name}",
                "http": 400,
            },
        )
        return JSONResponse(
            {
                "error": "invalid_request",
                "message": f"a2a_server_name must be {server_name}",
            },
            status_code=400,
        )
    if not client_id or not client_secret:
        log_event(
            "token",
            ok=False,
            hub=hub_meta,
            ticketing={"error": "invalid_client", "message": "invalid_client", "http": 401},
        )
        return JSONResponse({"error": "invalid_client"}, status_code=401)

    rotated = grant == "refresh_token"
    if grant == "refresh_token":
        refresh = str(body.get("refresh_token") or "").strip()
        row = validate_refresh_token(
            a2a_server_name=server_name,
            client_id=client_id,
            client_secret=client_secret,
            refresh_token=refresh,
        )
        if not row:
            log_event(
                "token",
                ok=False,
                hub=hub_meta,
                ticketing={
                    "error": "invalid_grant",
                    "message": "Invalid refresh_token",
                    "http": 401,
                },
            )
            return JSONResponse(
                {"error": "invalid_grant", "message": "Invalid refresh_token"},
                status_code=401,
            )
    else:
        row = validate_client_credentials(
            a2a_server_name=server_name,
            client_id=client_id,
            client_secret=client_secret,
        )
        if not row:
            log_event(
                "token",
                ok=False,
                hub=hub_meta,
                ticketing={
                    "error": "invalid_client",
                    "message": "unknown client",
                    "http": 401,
                },
            )
            return JSONResponse({"error": "invalid_client"}, status_code=401)

    access, expires_at = mint_access_token(client_id=client_id, a2a_server_name=server_name)
    refresh = mint_refresh_token()
    persist_tokens(
        a2a_server_name=server_name,
        client_id=client_id,
        access_token=access,
        refresh_token=refresh,
        expires_at=expires_at,
    )
    log_event(
        "token",
        ok=True,
        hub=hub_meta if req_server else {**hub_meta, "a2a_server_name": server_name},
        ticketing={
            "expires_in": ttl,
            "refresh_expires_in": refresh_ttl,
            "skillVersion": live_ver,
            "rotated": rotated,
            "stored": "accounts.a2a_spoke_clients",
        },
    )
    return JSONResponse(
        {
            "access_token": access,
            "token_type": "Bearer",
            "expires_in": ttl,
            "expires_at": expires_at.isoformat(),
            "refresh_token": refresh,
            "refresh_expires_in": refresh_ttl,
            "a2a_server_name": server_name,
            "skillVersion": live_ver,
        }
    )


@router.post("/token")
async def token_endpoint(request: Request) -> JSONResponse:
    """Legacy token path (kept for local/Hub clients)."""
    return await _token_response(request)


@router.post("/oauth/token")
async def oauth_token_endpoint(request: Request) -> JSONResponse:
    """CCaaS-aligned OAuth2 token URL advertised on the Agent Card."""
    return await _token_response(request)


@router.post("/")
async def jsonrpc_root(
    request: Request,
    authorization: str | None = Header(default=None),
) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001
        log_event(
            "invoke",
            ok=False,
            ticketing={"error": "Parse error", "http": 200, "code": -32700},
        )
        return _jsonrpc_error(None, -32700, "Parse error")
    if not isinstance(body, dict):
        log_event(
            "invoke",
            ok=False,
            ticketing={"error": "Invalid Request", "http": 200, "code": -32600},
        )
        return _jsonrpc_error(None, -32600, "Invalid Request")

    rpc_id = body.get("id")
    method = str(body.get("method") or "").strip()
    params = body.get("params") if isinstance(body.get("params"), dict) else {}

    try:
        claims = verify_invoke_token(authorization)
    except AuthError as exc:
        log_event(
            "invoke",
            ok=False,
            hub={"method": method},
            ticketing={"error": exc.message, "code": exc.code, "http": 200},
        )
        return _jsonrpc_error(rpc_id, exc.code, exc.message)

    client_id = str(claims.get("client_id") or claims.get("sub") or "").strip()

    if method in {
        "agent/getAuthenticatedExtendedCard",
        "agent/authenticatedExtendedCard",
    }:
        return _jsonrpc_result(rpc_id, build_extended_agent_card())

    if method == "message/send":
        message = params.get("message") if isinstance(params.get("message"), dict) else None
        result = dispatch_from_message(message, client_id=client_id)
        return _jsonrpc_result(rpc_id, result)

    if method == "tasks/get":
        task_id = str(params.get("id") or params.get("taskId") or "").strip()
        row = get_task(task_id) if task_id else None
        if not row:
            log_event(
                "tasks/get",
                ok=False,
                hub={"taskId": task_id, "client_id": client_id},
                ticketing={"error": "Task not found", "code": -32004},
            )
            return _jsonrpc_error(rpc_id, -32004, "Task not found")
        log_event(
            "tasks/get",
            ok=True,
            hub={"taskId": task_id, "client_id": client_id},
            ticketing={"status": row.get("status") or "unknown"},
        )
        return _jsonrpc_result(
            rpc_id,
            {
                "id": task_id,
                "status": {"state": row.get("status") or "unknown"},
                "artifacts": [
                    {
                        "parts": [
                            {
                                "kind": "data",
                                "data": row.get("response_json") or {},
                            }
                        ]
                    }
                ],
            },
        )

    if method == "tasks/cancel":
        task_id = str(params.get("id") or params.get("taskId") or "").strip()
        log_event(
            "tasks/cancel",
            ok=True,
            hub={"taskId": task_id, "client_id": client_id},
            ticketing={"status": "canceled"},
        )
        return _jsonrpc_result(
            rpc_id,
            {"id": task_id, "status": {"state": "canceled"}},
        )

    log_event(
        "invoke",
        ok=False,
        hub={"method": method, "client_id": client_id},
        ticketing={"error": f"Method not found: {method}", "code": -32601},
    )
    return _jsonrpc_error(rpc_id, -32601, f"Method not found: {method}")
