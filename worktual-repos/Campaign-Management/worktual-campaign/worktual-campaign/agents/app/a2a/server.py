"""FastAPI routes: agent card, /token, JSON-RPC invoke."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import FastAPI, Header, Request
from fastapi.responses import JSONResponse

from app.a2a.access_token import TokenError, issue_tokens_for_spoke
from app.a2a.auth import verify_bearer
from app.a2a.card import build_agent_card, build_extended_agent_card
from app.a2a.clients import (
    ensure_spoke_row,
    get_client_by_credentials,
    get_client_by_server_name,
)
from app.a2a.contracts import resolve_contract
from app.a2a.dispatch import build_artifacts, dispatch_message_send
from app.a2a.hub_ondemand_log import log_json_block
from app.a2a.escalate import (
    HubEscalateError,
    diagnose_hub_connectivity,
    send_remainder_to_hub,
)
from app.config import get_settings

_log = logging.getLogger(__name__)


def create_a2a_app() -> FastAPI:
    app = FastAPI(title="Worktual Campaign A2A Spoke", version="1.0.0")

    @app.on_event("startup")
    async def _startup_ensure_rows() -> None:
        s = get_settings()
        if not s.account_database_url.strip():
            _log.warning(
                "ACCOUNT_DATABASE_URL empty — A2A tokens stored in memory only"
            )
            return
        try:
            ok = await ensure_spoke_row(s.a2a_server_name)
            if ok:
                _log.info(
                    "A2A spoke row ensured for %s (client_id=%s)",
                    s.a2a_server_name,
                    s.a2a_spoke_client_id,
                )
            else:
                _log.warning(
                    "A2A spoke row not persisted for %s — /token may still work via env credentials",
                    s.a2a_server_name,
                )
        except Exception as exc:  # noqa: BLE001
            _log.error("A2A startup ensure_spoke_row failed: %s", exc)

    @app.get("/health")
    async def health():
        s = get_settings()
        return {
            "status": "ok",
            "a2a_server_name": s.a2a_server_name,
            "hub_url": s.hub_a2a_url or None,
            "token_store": "db" if s.account_database_url.strip() else "memory",
            "on_demand_prepare": True,
        }

    @app.get("/ready")
    async def ready():
        """Hub integration: spoke + on-demand prepare + Campaign API reachability."""
        import httpx

        s = get_settings()
        api_base = (s.campaign_api_base or "").rstrip("/")
        health_url = (
            api_base[:-4] + "/health"
            if api_base.endswith("/api")
            else f"{api_base}/health"
        )
        checks: dict[str, Any] = {
            "spoke": "ok",
            "on_demand_prepare": "ok",
            "campaign_api": "unknown",
        }
        ok = True
        if api_base:
            try:
                async with httpx.AsyncClient(timeout=5.0) as client:
                    res = await client.get(health_url)
                    if res.status_code == 200:
                        checks["campaign_api"] = "ok"
                    else:
                        checks["campaign_api"] = f"http_{res.status_code}"
                        ok = False
            except Exception as exc:  # noqa: BLE001
                checks["campaign_api"] = str(exc)[:120]
                ok = False
        else:
            checks["campaign_api"] = "CAMPAIGN_API_BASE unset"
            ok = False
        return JSONResponse(
            {
                "status": "ready" if ok else "degraded",
                "a2a_server_name": s.a2a_server_name,
                "checks": checks,
            },
            status_code=200 if ok else 503,
        )

    @app.post("/on-demand/prepare")
    async def on_demand_prepare(payload: dict[str, Any]):
        """Same as agents :8005 — backend Hub launches call A2A :8040 by default."""
        from app.agents.on_demand import prepare_on_demand_send

        body = payload if isinstance(payload, dict) else {}
        result = await prepare_on_demand_send(body)
        status = 200 if result.get("ok") else 400
        return {
            "statusCode": status,
            "message": "On-demand prepare completed"
            if result.get("ok")
            else (result.get("error") or "On-demand prepare failed"),
            **result,
        }

    @app.post("/personalised-crm/prepare")
    async def personalised_crm_prepare(payload: dict[str, Any]):
        from app.agents.personalised_crm import prepare_personalised_crm_send

        body = payload if isinstance(payload, dict) else {}
        result = await prepare_personalised_crm_send(body)
        status = 200 if result.get("ok") else 400
        return {
            "statusCode": status,
            "message": "Personalised CRM prepare completed"
            if result.get("ok")
            else (result.get("error") or "Personalised CRM prepare failed"),
            **result,
        }

    @app.get("/.well-known/agent-card.json")
    async def agent_card():
        return build_agent_card()

    # Prod nginx serves spoke under /a2a/ — same paths on raw :8040 for LAN Hub registration.
    @app.get("/a2a/.well-known/agent-card.json")
    async def agent_card_under_a2a_prefix():
        return build_agent_card()

    @app.get("/a2a/health")
    async def health_under_a2a_prefix():
        return await health()

    @app.get("/a2a/ready")
    async def ready_under_a2a_prefix():
        return await ready()

    @app.get("/a2a/agent-card/extended")
    async def agent_card_extended(
        authorization: str | None = Header(default=None),
    ):
        """Authenticated extended Agent Card (richer per-skill metadata)."""
        try:
            verify_bearer(authorization)
        except TokenError as exc:
            return JSONResponse(
                {"error": exc.code, "error_description": exc.message},
                status_code=401 if exc.code != "skill_version_stale" else 409,
            )
        return build_extended_agent_card()

    @app.get("/a2a/contracts/worktual-envelope.v1.json")
    async def contract_envelope():
        doc = resolve_contract("/a2a/contracts/worktual-envelope.v1.json")
        return doc or JSONResponse({"error": "not_found"}, status_code=404)

    @app.get("/a2a/contracts/skill-result.v1.json")
    async def contract_skill_result():
        doc = resolve_contract("/a2a/contracts/skill-result.v1.json")
        return doc or JSONResponse({"error": "not_found"}, status_code=404)

    @app.get("/a2a/contracts/skills/{skill_id}.v1.json")
    async def contract_skill(skill_id: str):
        doc = resolve_contract(f"/a2a/contracts/skills/{skill_id}.v1.json")
        if not doc:
            return JSONResponse(
                {"error": "unknown_skill_contract", "skillId": skill_id},
                status_code=404,
            )
        return doc

    @app.post("/token")
    @app.post("/a2a/token")
    async def token(request: Request):
        body = await request.json()
        if not isinstance(body, dict):
            return JSONResponse(
                {"error": "invalid_request", "error_description": "JSON body required"},
                status_code=400,
            )
        grant = str(body.get("grant_type") or "").strip()
        client_id = str(body.get("client_id") or "").strip()
        client_secret = str(body.get("client_secret") or "").strip()
        server_name = str(body.get("a2a_server_name") or "").strip()
        s = get_settings()
        if not server_name:
            server_name = s.a2a_server_name

        if grant not in {"client_credentials", "refresh_token"}:
            return JSONResponse(
                {
                    "error": "unsupported_grant_type",
                    "error_description": "Use client_credentials or refresh_token",
                },
                status_code=400,
            )

        row = await get_client_by_credentials(client_id, client_secret, server_name)
        if not row:
            return JSONResponse(
                {
                    "error": "invalid_client",
                    "error_description": "Unknown client_id/secret for a2a_server_name",
                },
                status_code=401,
            )

        if grant == "refresh_token":
            refresh = str(body.get("refresh_token") or "").strip()
            stored = await get_client_by_server_name(server_name)
            if (
                not refresh
                or not stored
                or not stored.refresh_token
                or stored.refresh_token != refresh
            ):
                return JSONResponse(
                    {
                        "error": "invalid_grant",
                        "error_description": "refresh_token invalid",
                    },
                    status_code=400,
                )

        try:
            issued = await issue_tokens_for_spoke(
                client_id=client_id,
                a2a_server_name=server_name,
                client_secret=client_secret,
            )
        except TokenError as exc:
            return JSONResponse(
                {"error": exc.code, "error_description": exc.message},
                status_code=400,
            )
        return issued

    @app.post("/")
    @app.post("/a2a/")
    async def invoke(
        request: Request,
        authorization: str | None = Header(default=None),
    ):
        try:
            claims = verify_bearer(authorization)
        except TokenError as exc:
            code = -32010 if exc.code == "skill_version_stale" else -32001
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": code, "message": exc.message, "data": {"code": exc.code}},
                },
                status_code=401 if exc.code != "skill_version_stale" else 409,
            )

        body = await request.json()
        if not isinstance(body, dict):
            return _rpc_error(None, -32600, "Invalid Request")

        rpc_id = body.get("id", "1")
        method = str(body.get("method") or "").strip()
        params = body.get("params") if isinstance(body.get("params"), dict) else {}

        if method == "message/send":
            log_json_block(
                "A2A REQUEST RECEIVED  method=message/send",
                body,
                extra_lines=[
                    f"client: {claims.get('sub')}",
                    f"rpc_id: {rpc_id}",
                ],
            )
            result = await dispatch_message_send(params)
            if not result.get("ok"):
                error_text = str(result.get("error") or "failed")
                # Typed missing fields → input-required style error for Hub
                if result.get("input_required"):
                    rpc_out: dict[str, Any] = {
                        "jsonrpc": "2.0",
                        "id": rpc_id,
                        "result": {
                            "id": str(uuid.uuid4()),
                            "status": {
                                "state": "input-required",
                                "message": {
                                    "role": "agent",
                                    "parts": [
                                        {
                                            "kind": "data",
                                            "data": {
                                                "error": result.get("error"),
                                                "input_required": result.get(
                                                    "input_required"
                                                ),
                                            },
                                        }
                                    ],
                                },
                            },
                        },
                    }
                    log_json_block(
                        "A2A RESPONSE TO HUB  state=input-required",
                        rpc_out,
                        extra_lines=[f"error: {error_text}"],
                    )
                    return rpc_out
                rpc_out = {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "result": {
                        "id": str(uuid.uuid4()),
                        "status": {"state": "failed", "message": result.get("error")},
                        "artifacts": build_artifacts(result),
                    },
                }
                log_json_block(
                    "A2A RESPONSE TO HUB  state=failed",
                    rpc_out,
                    extra_lines=[f"error: {error_text}"],
                )
                return rpc_out

            rpc_out = {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": {
                    "id": str(uuid.uuid4()),
                    "contextId": result.get("organization_id"),
                    "status": {"state": "completed"},
                    "artifacts": build_artifacts(result),
                },
            }
            log_json_block(
                "A2A RESPONSE TO HUB  state=completed",
                rpc_out,
                extra_lines=["error: none"],
            )
            return rpc_out

        if method in {"tasks/get", "tasks/cancel"}:
            return _rpc_error(rpc_id, -32601, f"Method not implemented: {method}")

        return _rpc_error(rpc_id, -32601, f"Method not found: {method}")

    @app.get("/internal/hub-ping")
    async def hub_ping():
        """Diagnose Campaign → Hub: card → token → message/send."""
        return await diagnose_hub_connectivity()

    @app.post("/internal/escalate-hub")
    async def escalate_hub(payload: dict[str, Any]):
        """
        Campaign-originated remainder → Hub.
        Body: cdp_id, query, organization_id, channel?, source?
        """
        body = payload if isinstance(payload, dict) else {}
        source = str(body.get("source") or "campaign").strip().lower()
        _log.info("escalate-hub request payload=%s", body)
        try:
            result = await send_remainder_to_hub(
                cdp_id=str(body.get("cdp_id") or ""),
                query=str(body.get("query") or body.get("request_text") or ""),
                organization_id=body.get("organization_id")
                or body.get("organizationId")
                or "",
                channel=str(body.get("channel") or "chat"),
                source=source,
            )
        except HubEscalateError as exc:
            _log.warning("escalate-hub failed: %s payload=%s", exc, body)
            return JSONResponse(
                {
                    "ok": False,
                    "error": str(exc),
                    "hint": (
                        "Check HUB_A2A_CLIENT_ID / HUB_A2A_CLIENT_SECRET in .env, "
                        "restart uvicorn, then GET /internal/hub-ping"
                    ),
                },
                status_code=400,
            )
        except Exception as exc:  # noqa: BLE001
            _log.exception("escalate-hub unexpected error payload=%s", body)
            return JSONResponse(
                {"ok": False, "error": f"unexpected: {exc}"},
                status_code=500,
            )
        _log.info(
            "escalate-hub result ok=%s skipped=%s error=%s sent=%s hub_response=%s",
            result.get("ok"),
            result.get("skipped"),
            result.get("error"),
            result.get("sent"),
            result.get("hub_response"),
        )
        status = 200 if result.get("ok") or result.get("skipped") else 400
        return JSONResponse(result, status_code=status)

    return app


def _rpc_error(rpc_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": rpc_id,
        "error": {"code": code, "message": message},
    }
