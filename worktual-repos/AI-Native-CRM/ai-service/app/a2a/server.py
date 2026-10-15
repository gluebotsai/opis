"""FastAPI A2A JSON-RPC + live Agent Card for the CRM spoke."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Mapping

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.a2a.auth import (
    SkillVersionStaleError,
    a2a_auth_middleware,
    hub_identity_from_request,
    require_fresh_access_skills,
)
from app.a2a.card import (
    build_agent_card,
    build_extended_agent_card,
    build_oauth_authorization_server_metadata,
)
from app.a2a.contracts import envelope_schema, result_schema, skill_contract
from app.a2a.dispatch import dispatch_skill
from app.a2a.errors import InputRequiredError, SpokeRejectError, receipt
from app.a2a.log import agent_activity, crm_respond, hub_instruction, log_a2a, start_a2a_trace
from app.a2a.payload import flatten_message, is_delegated, normalize_payload
from app.a2a.store import get_task, new_task_ids, save_task
from app.a2a.traffic import a2a_traffic_middleware
from app.config import get_settings

AGENT_CARD_PATH = "/.well-known/agent-card.json"
_RUNNING: dict[str, bool] = {}


def _part_text(parts: list[Any]) -> str:
    texts: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        text = part.get("text")
        if text:
            texts.append(str(text))
    return "\n".join(texts).strip()


def _part_data(parts: list[Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for part in parts:
        if not isinstance(part, dict):
            continue
        data = part.get("data")
        if isinstance(data, dict):
            merged.update(data)
    return merged


def _message_bundle(message: Mapping[str, Any]) -> dict[str, Any]:
    parts = list(message.get("parts") or [])
    metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
    data = _part_data(parts)
    text = _part_text(parts)
    bundled = flatten_message(metadata, data)
    if text:
        bundled.setdefault("text", text)
        bundled.setdefault("query", text)
        bundled.setdefault("task", text)
    if message.get("contextId") or message.get("context_id"):
        bundled.setdefault("contextId", message.get("contextId") or message.get("context_id"))
    if message.get("taskId") or message.get("task_id"):
        bundled.setdefault("taskId", message.get("taskId") or message.get("task_id"))
    return bundled


def _task_result(
    *,
    task_id: str,
    context_id: str,
    state: str,
    artifact: dict[str, Any] | None = None,
    status_text: str | None = None,
) -> dict[str, Any]:
    status_message = None
    if status_text:
        status_message = {
            "role": "agent",
            "parts": [{"kind": "text", "text": status_text}],
            "messageId": str(uuid.uuid4()),
        }
    body: dict[str, Any] = {
        "id": task_id,
        "contextId": context_id,
        "kind": "task",
        "status": {"state": state, "message": status_message},
        "artifacts": [],
    }
    if artifact is not None:
        body["artifacts"] = [
            {
                "artifactId": str(uuid.uuid4()),
                "name": "crm_spoke_receipt",
                "parts": [{"kind": "data", "data": artifact}],
            }
        ]
    return body


def _log_crm_respond(
    bundled: Mapping[str, Any],
    body: Mapping[str, Any],
    *,
    ok: bool,
) -> None:
    reply = crm_respond(body)
    log_a2a(
        step="crm_respond",
        ok=ok,
        message="CRM response sent to Hub",
        hub=hub_instruction(bundled),
        crm=reply,
    )


async def _handle_send(message: Mapping[str, Any], request: Request) -> dict[str, Any]:
    identity = hub_identity_from_request(request)
    require_fresh_access_skills(identity)
    actor_id = identity.actor_id if identity else "hub:unknown"
    if identity and identity.organization_id:
        # JWT org cannot be overridden by a different payload org.
        pass
    bundled = normalize_payload(_message_bundle(message))
    start_a2a_trace(str(bundled.get("traceId") or bundled.get("trace_id") or ""))
    hub_given = hub_instruction(bundled)
    log_a2a(
        step="hub_instruct",
        hub=hub_given,
        instruction=hub_given.get("instruction"),
        crm={"actorId": actor_id, "tokenKind": identity.token_kind if identity else None},
        clientId=identity.client_id if identity else None,
    )
    if identity and identity.organization_id:
        bundled["organizationId"] = identity.organization_id
        bundled["organization_id"] = identity.organization_id
    task_id, context_id = new_task_ids(
        str(message.get("taskId") or message.get("task_id") or bundled.get("taskId") or ""),
        str(message.get("contextId") or message.get("context_id") or bundled.get("contextId") or ""),
    )
    org = str(bundled.get("organizationId") or bundled.get("organization_id") or "")
    skill_id = str(bundled.get("skillId") or bundled.get("skill_id") or "")
    await save_task(
        {
            "id": str(uuid.uuid4()),
            "task_id": task_id,
            "context_id": context_id,
            "organization_id": org or "0",
            "skill_id": skill_id,
            "state": "WORKING",
            "actor_id": actor_id,
            "run_id": str(bundled.get("runId") or task_id),
            "idempotency_key": str(bundled.get("idempotencyKey") or task_id),
            "receipt": None,
        }
    )
    _RUNNING[task_id] = True
    try:
        artifact = await dispatch_skill(bundled, actor_id=actor_id)
        if (
            not is_delegated(bundled)
            and isinstance(artifact.get("result"), dict)
            and artifact["result"].get("escalateToHub")
        ):
            from app.a2a.escalate import maybe_escalate_to_hub

            leftover = await maybe_escalate_to_hub(
                text=str(bundled.get("text") or ""),
                payload=bundled,
                context_id=context_id,
            )
            if leftover is not None:
                artifact = {
                    **artifact,
                    "hubRemainder": leftover,
                }
                log_a2a(
                    step="escalate",
                    hub=hub_instruction(bundled),
                    crm={"taskId": task_id, "remainder": True},
                )
        state = "completed"
        activity = agent_activity(artifact if isinstance(artifact, dict) else None)
        log_a2a(
            step="complete",
            ok=True,
            message="Task finished successfully",
            hub=hub_instruction(bundled),
            activity=activity,
            crm={
                "outcome": "success",
                "message": "Task finished successfully",
                "taskId": task_id,
                "skillId": skill_id,
                "status": artifact.get("status") if isinstance(artifact, dict) else "completed",
                "agent": artifact.get("agent") if isinstance(artifact, dict) else None,
                "result": (activity or {}).get("result"),
            },
        )
        await save_task(
            {
                **((await get_task(task_id)) or {}),
                "task_id": task_id,
                "context_id": context_id,
                "organization_id": org or "0",
                "skill_id": skill_id,
                "state": "COMPLETED",
                "actor_id": actor_id,
                "receipt": artifact,
            }
        )
        body = _task_result(
            task_id=task_id,
            context_id=context_id,
            state=state,
            artifact=artifact,
            status_text="CRM spoke completed the request.",
        )
        _log_crm_respond(bundled, body, ok=True)
        return body
    except InputRequiredError as exc:
        payload = receipt(
            status="input_required",
            skill_id=skill_id or "unknown",
            agent_name="crm-spoke",
            error=exc.message,
            missing_fields=exc.fields,
        )
        await save_task(
            {
                "task_id": task_id,
                "context_id": context_id,
                "organization_id": org or "0",
                "skill_id": skill_id,
                "state": "INPUT_REQUIRED",
                "actor_id": actor_id,
                "run_id": task_id,
                "idempotency_key": task_id,
                "receipt": payload,
            }
        )
        activity = agent_activity(payload)
        log_a2a(
            step="input_required",
            ok=False,
            hub=hub_instruction(bundled),
            activity=activity,
            crm={
                "taskId": task_id,
                "missing": exc.fields,
                "message": exc.message,
                "activity": activity,
            },
        )
        body = _task_result(
            task_id=task_id,
            context_id=context_id,
            state="input-required",
            artifact=payload,
            status_text=exc.message,
        )
        _log_crm_respond(bundled, body, ok=False)
        return body
    except SpokeRejectError as exc:
        payload = receipt(
            status="rejected",
            skill_id=skill_id or "unknown",
            agent_name="crm-spoke",
            error=exc.message,
        )
        await save_task(
            {
                "task_id": task_id,
                "context_id": context_id,
                "organization_id": org or "0",
                "skill_id": skill_id,
                "state": "REJECTED",
                "actor_id": actor_id,
                "run_id": task_id,
                "idempotency_key": task_id,
                "receipt": payload,
            }
        )
        activity = agent_activity(payload)
        log_a2a(
            step="reject",
            ok=False,
            hub=hub_instruction(bundled),
            activity=activity,
            crm={
                "taskId": task_id,
                "code": exc.code,
                "message": exc.message,
                "activity": activity,
            },
        )
        body = _task_result(
            task_id=task_id,
            context_id=context_id,
            state="rejected",
            artifact=payload,
            status_text=exc.message,
        )
        _log_crm_respond(bundled, body, ok=False)
        return body
    except Exception as exc:  # noqa: BLE001
        payload = receipt(
            status="failed",
            skill_id=skill_id or "unknown",
            agent_name="crm-spoke",
            error=str(exc) or type(exc).__name__,
        )
        await save_task(
            {
                "task_id": task_id,
                "context_id": context_id,
                "organization_id": org or "0",
                "skill_id": skill_id,
                "state": "FAILED",
                "actor_id": actor_id,
                "run_id": task_id,
                "idempotency_key": task_id,
                "receipt": payload,
            }
        )
        activity = agent_activity(payload)
        log_a2a(
            step="fail",
            ok=False,
            hub=hub_instruction(bundled),
            activity=activity,
            crm={
                "taskId": task_id,
                "error": str(exc) or type(exc).__name__,
                "activity": activity,
            },
        )
        body = _task_result(
            task_id=task_id,
            context_id=context_id,
            state="failed",
            artifact=payload,
            status_text="CRM spoke failed the request.",
        )
        _log_crm_respond(bundled, body, ok=False)
        return body
    finally:
        _RUNNING.pop(task_id, None)


async def _jsonrpc(body: Mapping[str, Any], request: Request) -> dict[str, Any]:
    rpc_id = body.get("id")
    method = str(body.get("method") or "")
    params = body.get("params") if isinstance(body.get("params"), dict) else {}
    try:
        if method == "agent/getAuthenticatedExtendedCard":
            card = build_extended_agent_card(public_url=get_settings().a2a_public_url)
            return {"jsonrpc": "2.0", "id": rpc_id, "result": card}
        if method in {"message/send", "tasks/send"}:
            message = params.get("message") if isinstance(params.get("message"), dict) else params
            result = await _handle_send(message, request)
            return {"jsonrpc": "2.0", "id": rpc_id, "result": result}
        if method == "tasks/get":
            task_id = str(params.get("id") or params.get("taskId") or "")
            record = await get_task(task_id) if task_id else None
            if not record:
                log_a2a(step="task_get", ok=False, crm={"taskId": task_id, "found": False})
                return {
                    "jsonrpc": "2.0",
                    "id": rpc_id,
                    "error": {"code": -32001, "message": "Task not found"},
                }
            state = str(record.get("state") or "unknown").lower().replace("_", "-")
            log_a2a(step="task_get", ok=True, crm={"taskId": task_id, "state": state})
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": _task_result(
                    task_id=str(record["task_id"]),
                    context_id=str(record.get("context_id") or ""),
                    state=state,
                    artifact=record.get("receipt") if isinstance(record.get("receipt"), dict) else None,
                ),
            }
        if method == "tasks/cancel":
            task_id = str(params.get("id") or params.get("taskId") or "")
            _RUNNING.pop(task_id, None)
            record = await get_task(task_id) if task_id else None
            if record:
                record["state"] = "CANCELED"
                await save_task(record)
            log_a2a(step="cancel", crm={"taskId": task_id, "found": bool(record)})
            return {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "result": _task_result(
                    task_id=task_id or str(uuid.uuid4()),
                    context_id=str((record or {}).get("context_id") or ""),
                    state="canceled",
                    status_text="Task cancelled.",
                ),
            }
        return {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }
    except SkillVersionStaleError as exc:
        log_a2a(
            step="skill_stale",
            ok=False,
            crm={"skillVersion": exc.current_version},
        )
        return {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "error": {
                "code": -32010,
                "message": "skill_version_stale",
                "data": {"skillVersion": exc.current_version},
            },
        }
    except Exception as exc:  # noqa: BLE001
        log_a2a(step="rpc_error", ok=False, crm={"error": str(exc) or type(exc).__name__, "method": method})
        return {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "error": {"code": -32603, "message": str(exc) or type(exc).__name__},
        }


def create_a2a_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        from app.agent_log import a2a_log_path

        log_a2a(
            step="ready",
            crm={
                "server": settings.a2a_server_name or "worktual-crm",
                "url": settings.a2a_public_url,
                "logPath": str(a2a_log_path()),
            },
        )
        try:
            from app.a2a.clients import ensure_seed_row

            await ensure_seed_row()
        except Exception:  # noqa: BLE001
            pass
        yield

    app = FastAPI(
        title="Worktual CRM A2A Spoke",
        version="1.0.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.middleware("http")(a2a_auth_middleware)
    app.middleware("http")(a2a_traffic_middleware)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "server": settings.a2a_server_name or "worktual-crm"}

    @app.get(AGENT_CARD_PATH)
    async def agent_card() -> dict[str, Any]:
        card = build_agent_card(public_url=settings.a2a_public_url)
        log_a2a(
            step="card",
            hub={"path": AGENT_CARD_PATH},
            crm={
                "id": card.get("id"),
                "url": card.get("url"),
                "skillVersion": card.get("skillVersion"),
                "skills": len(card.get("skills") or []),
            },
        )
        return card

    @app.get("/.well-known/oauth-authorization-server")
    async def oauth_authorization_server() -> dict[str, Any]:
        return build_oauth_authorization_server_metadata(
            public_url=settings.a2a_public_url
        )

    @app.get("/a2a/contracts/worktual-envelope.v1.json")
    async def worktual_envelope_contract() -> dict[str, Any]:
        return envelope_schema()

    @app.get("/a2a/contracts/skill-result.v1.json")
    async def skill_result_contract() -> dict[str, Any]:
        return result_schema()

    @app.get("/a2a/contracts/skills/{skill_id:path}")
    async def skill_input_contract(skill_id: str) -> Any:
        name = skill_id
        if name.endswith(".v1.json"):
            name = name[: -len(".v1.json")]
        schema = skill_contract(name)
        if schema is None:
            return JSONResponse(status_code=404, content={"error": "unknown_skill", "skillId": name})
        return schema

    @app.get("/a2a/agent-card/extended")
    async def extended_agent_card() -> dict[str, Any]:
        card = build_extended_agent_card(public_url=settings.a2a_public_url)
        log_a2a(
            step="card_extended",
            hub={"path": "/a2a/agent-card/extended"},
            crm={
                "id": card.get("id"),
                "skillVersion": card.get("skillVersion"),
                "skills": len(card.get("skills") or []),
            },
        )
        return card

    @app.post("/token")
    @app.post("/oauth/token")
    async def issue_spoke_access_token(request: Request) -> Any:
        from app.a2a.access_token import handle_token_request

        return await handle_token_request(request)

    @app.get("/internal/v1/agents")
    async def sft_agent_list() -> dict[str, Any]:
        from app.a2a.sft_catalog import list_sft_catalog

        return list_sft_catalog()

    @app.get("/internal/v1/agents/export")
    async def sft_agent_export() -> dict[str, Any]:
        from app.a2a.sft_catalog import export_sft_catalog

        return export_sft_catalog()

    @app.get("/internal/v1/agents/{agent_id}")
    async def sft_agent_detail(agent_id: str) -> Any:
        from app.a2a.sft_catalog import get_sft_agent

        agent = get_sft_agent(agent_id)
        if agent is None:
            return JSONResponse(
                status_code=404,
                content={"error": "unknown_agent", "id": agent_id},
            )
        from app.a2a.sft_catalog import SFT_CATALOG_SOURCE, SFT_CATALOG_VERSION

        return {
            "version": SFT_CATALOG_VERSION,
            "source": SFT_CATALOG_SOURCE,
            "agent": agent,
        }

    @app.post("/")
    async def jsonrpc(request: Request) -> JSONResponse:
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001
            log_a2a(step="rpc_error", ok=False, crm={"error": "Parse error"})
            return JSONResponse(
                status_code=400,
                content={"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}},
            )
        if not isinstance(body, dict):
            return JSONResponse(
                status_code=400,
                content={"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "Invalid request"}},
            )
        return JSONResponse(await _jsonrpc(body, request))

    return app
