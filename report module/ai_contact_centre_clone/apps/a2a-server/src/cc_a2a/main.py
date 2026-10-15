"""Contact Centre A2A v1.0 FastAPI entrypoint."""

from __future__ import annotations

import logging
import os
import uuid
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from cc_a2a.agent_catalog import export_all_agents, get_agent_detail, list_agent_summaries
from cc_a2a.audit_log import (
    configure_a2a_logging,
    log_a2a_trace,
    log_envelope_input,
    log_envelope_output,
)
from cc_a2a.auth import (
    AuthError,
    assert_tenant_access,
    authenticate_request,
    enforce_rate_limit,
    resolve_caller_organization_id,
)
from cc_a2a.card import build_extended_agent_card, build_public_agent_card
from cc_a2a.config import get_settings
from cc_a2a.contracts import (
    HubDelegationResult,
    HubHelpRequest,
    MissingInputStatus,
    SkillResultArtifact,
    WorktualEnvelope,
)
from cc_a2a.policy import assert_feature_flags
from cc_a2a.store import CcCoreTaskStore, InMemoryTaskStore, TaskStoreError, canonical_request_hash
from cc_a2a.supervisor import SuperAgentExecutor

logger = logging.getLogger("a2a.main")


def _jsonrpc_error(
    *,
    code: int,
    message: str,
    request_id: Any = None,
    http_status: int = 200,
    data: Any = None,
) -> JSONResponse:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return JSONResponse(
        status_code=http_status,
        content={"jsonrpc": "2.0", "id": request_id, "error": error},
    )


def _task_to_a2a(task: dict[str, Any]) -> dict[str, Any]:
    artifacts = task.get("artifacts") or []
    if not artifacts and task.get("resultArtifact"):
        artifacts = [
            {
                "artifactId": f"{task['id']}-result",
                "name": "result",
                "parts": [
                    {
                        "kind": "data",
                        "data": task["resultArtifact"],
                        "mimeType": "application/json",
                    }
                ],
            }
        ]
    return {
        "id": task["id"],
        "contextId": task.get("contextId") or task["id"],
        "status": {
            "state": str(task.get("state") or "SUBMITTED").lower(),
            "message": None,
        },
        "artifacts": artifacts,
        "metadata": {
            "commandId": task.get("commandId"),
            "skillId": task.get("skillId"),
            "organizationId": task.get("organizationId"),
            "callerSubject": task.get("callerSubject"),
        },
        "history": task.get("events") or [],
        "kind": "task",
    }


def _extract_envelope(message: dict[str, Any]) -> WorktualEnvelope:
    parts = message.get("parts") or []
    data_part = None
    for part in parts:
        kind = part.get("kind") or part.get("type")
        if kind in {"data", "DataPart"} and isinstance(part.get("data"), dict):
            data_part = part["data"]
            break
    if data_part is None:
        metadata = message.get("metadata")
        if isinstance(metadata, dict) and "skillId" in metadata:
            data_part = metadata
    if data_part is None:
        raise ValueError("SendMessage requires an application/json DataPart Worktual envelope")
    return WorktualEnvelope.model_validate(data_part)


def _require_internal_service(
    request: Request,
    *,
    settings,
) -> None:
    service_key = settings.internal_service_key.strip()
    header_key = (request.headers.get("x-internal-service-key") or "").strip()
    if service_key and header_key == service_key:
        return
    raise HTTPException(status_code=401, detail="Invalid internal service credentials")


def create_app() -> FastAPI:
    configure_a2a_logging()
    settings = get_settings()
    application = FastAPI(
        title="Worktual Contact Centre A2A",
        version=settings.a2a_catalog_version,
        docs_url="/docs" if settings.a2a_allow_dev_auth else None,
    )

    task_store: CcCoreTaskStore | InMemoryTaskStore = (
        InMemoryTaskStore()
        if os.environ.get("A2A_TASK_STORE", "").lower() == "memory"
        else CcCoreTaskStore(settings)
    )
    executor = SuperAgentExecutor(settings)
    application.state.task_store = task_store
    application.state.executor = executor

    @application.get("/health")
    async def health() -> dict[str, Any]:
        cfg = get_settings()
        return {
            "status": "ok" if cfg.a2a_enabled else "disabled",
            "service": "a2a-server",
            "protocolVersion": cfg.a2a_protocol_version,
            "enabled": cfg.a2a_enabled,
        }

    @application.get("/.well-known/oauth-authorization-server")
    async def oauth_metadata() -> dict[str, Any]:
        from cc_a2a.auth.oauth import token_endpoint_metadata

        return token_endpoint_metadata(get_settings())

    @application.post("/oauth/token")
    async def oauth_token(
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> Response:
        from cc_a2a.auth.oauth import TokenError, issue_token_response

        cfg = get_settings()
        content_type = (request.headers.get("content-type") or "").lower()
        form: dict[str, Any]
        try:
            if "application/json" in content_type:
                body = await request.json()
                form = body if isinstance(body, dict) else {}
            else:
                raw = await request.form()
                form = {str(key): raw.get(key) for key in raw.keys()}
        except Exception:  # noqa: BLE001
            return JSONResponse(
                status_code=400,
                content={
                    "error": "invalid_request",
                    "error_description": "Unable to parse token request body",
                },
            )

        log_a2a_trace(
            "OAUTH_INPUT",
            grantType=str(form.get("grant_type") or ""),
            clientId=str(form.get("client_id") or "(basic-auth)"),
            organizationId=str(
                form.get("organization_id")
                or form.get("organizationId")
                or form.get("tenant_id")
                or form.get("tenantId")
                or ""
            ),
            scope=str(form.get("scope") or ""),
        )

        try:
            token_response = await issue_token_response(
                cfg,
                form=form,
                authorization=authorization,
            )
            log_a2a_trace(
                "OAUTH_OUTPUT",
                organizationId=token_response.get("organization_id"),
                expiresIn=token_response.get("expires_in"),
                scope=token_response.get("scope"),
                skillVersion=token_response.get("skill_version"),
            )
            return JSONResponse(token_response)
        except TokenError as error:
            return JSONResponse(
                status_code=error.status_code,
                content={
                    "error": error.error,
                    "error_description": error.description,
                },
                headers={"WWW-Authenticate": "Basic"} if error.status_code == 401 else None,
            )

    @application.get("/.well-known/agent-card.json")
    async def public_agent_card() -> dict[str, Any]:
        return build_public_agent_card(get_settings())

    @application.get("/a2a/agent-card/extended")
    async def extended_agent_card(
        authorization: str | None = Header(default=None),
        x_tenant_id: str | None = Header(default=None),
        x_a2a_client_id: str | None = Header(default=None),
    ) -> dict[str, Any]:
        try:
            authenticate_request(
                get_settings(),
                authorization=authorization,
                tenant_header=x_tenant_id,
                client_header=x_a2a_client_id,
            )
        except AuthError as error:
            raise HTTPException(status_code=error.status_code, detail=str(error)) from error
        return build_extended_agent_card(get_settings())

    @application.get("/a2a/contracts/worktual-envelope.v1.json")
    async def envelope_schema() -> dict[str, Any]:
        return WorktualEnvelope.model_json_schema()

    @application.get("/a2a/contracts/skill-result.v1.json")
    async def result_schema() -> dict[str, Any]:
        return SkillResultArtifact.model_json_schema()

    @application.get("/a2a/contracts/skills/{skill_id}.v1.json")
    async def skill_contract_schema(skill_id: str) -> dict[str, Any]:
        from cc_a2a.skill_contracts import get_skill_contract

        contract = get_skill_contract(skill_id, public_url=get_settings().a2a_public_url)
        if contract is None:
            raise HTTPException(status_code=404, detail=f"Unknown skillId: {skill_id}")
        return contract

    # Also accept path without forcing callers to know the .v1.json suffix.
    @application.get("/a2a/contracts/skills/{skill_id}")
    async def skill_contract_schema_alias(skill_id: str) -> dict[str, Any]:
        from cc_a2a.skill_contracts import get_skill_contract

        normalized = skill_id.removesuffix(".v1.json").removesuffix(".json")
        contract = get_skill_contract(normalized, public_url=get_settings().a2a_public_url)
        if contract is None:
            raise HTTPException(status_code=404, detail=f"Unknown skillId: {skill_id}")
        return contract

    @application.post("/internal/v1/hub/delegate")
    async def internal_hub_delegate(
        request: Request,
        x_tenant_id: str | None = Header(default=None),
    ) -> HubDelegationResult:
        cfg = get_settings()
        _require_internal_service(request, settings=cfg)
        try:
            body = await request.json()
            payload = HubHelpRequest.model_validate(body)
        except ValidationError as error:
            raise HTTPException(status_code=400, detail=error.errors()) from error
        except Exception as error:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="Invalid JSON body") from error

        tenant = (x_tenant_id or payload.organizationId).strip()
        if tenant != payload.organizationId:
            raise HTTPException(
                status_code=403,
                detail="x-tenant-id must match organizationId",
            )

        agent_executor = application.state.executor
        return await agent_executor.delegate_to_hub(payload)

    @application.get("/internal/v1/agents")
    async def list_synthetic_agents(request: Request) -> dict[str, Any]:
        _require_internal_service(request, settings=get_settings())
        return list_agent_summaries()

    @application.get("/internal/v1/agents/export")
    async def export_synthetic_agents(request: Request) -> dict[str, Any]:
        _require_internal_service(request, settings=get_settings())
        return export_all_agents()

    @application.get("/internal/v1/agents/{agent_id}")
    async def get_synthetic_agent(request: Request, agent_id: str) -> dict[str, Any]:
        _require_internal_service(request, settings=get_settings())
        detail = get_agent_detail(agent_id)
        if detail is None:
            raise HTTPException(status_code=404, detail=f"Unknown agent: {agent_id}")
        return detail

    async def handle_send_message(
        params: dict[str, Any],
        *,
        authorization: str | None,
        tenant_header: str | None,
        client_header: str | None,
    ) -> dict[str, Any]:
        cfg = get_settings()
        caller = authenticate_request(
            cfg,
            authorization=authorization,
            tenant_header=tenant_header,
            client_header=client_header,
        )
        message = params.get("message") or params
        envelope = _extract_envelope(message if isinstance(message, dict) else {})
        assert_tenant_access(caller, envelope.organizationId)
        assert_feature_flags(
            enabled=cfg.a2a_enabled or cfg.a2a_allow_dev_auth,
            organization_id=envelope.organizationId,
            skill_id=envelope.skillId,
            enabled_tenants=cfg.enabled_tenant_set(),
            enabled_skills=cfg.enabled_skill_set(),
        )
        enforce_rate_limit(cfg, caller, envelope.organizationId)

        log_envelope_input(
            command_id=envelope.commandId,
            skill_id=envelope.skillId,
            organization_id=envelope.organizationId,
            arguments=envelope.arguments,
            caller_subject=caller.subject,
        )

        request_hash = canonical_request_hash(envelope.model_dump(mode="json"))
        context_id = str(message.get("contextId") or uuid.uuid4())
        active_store = application.state.task_store
        agent_executor = application.state.executor
        task_store_name = (
            "memory" if isinstance(active_store, InMemoryTaskStore) else "cc-core"
        )

        try:
            task = await active_store.create_or_get(
                organization_id=envelope.organizationId,
                caller_subject=caller.subject,
                command_id=envelope.commandId,
                skill_id=envelope.skillId,
                request_hash=request_hash,
                request_envelope=envelope.model_dump(mode="json"),
                context_id=context_id,
            )
        except TaskStoreError as error:
            if error.status_code == 409:
                raise
            log_a2a_trace(
                "STEP",
                command_id=envelope.commandId,
                step="task_store_fallback",
                fromStore="cc-core",
                toStore="memory",
                reason=str(error),
            )
            logger.warning("cc-core task store unavailable (%s); using memory store", error)
            active_store = InMemoryTaskStore()
            application.state.task_store = active_store
            task_store_name = "memory"
            task = await active_store.create_or_get(
                organization_id=envelope.organizationId,
                caller_subject=caller.subject,
                command_id=envelope.commandId,
                skill_id=envelope.skillId,
                request_hash=request_hash,
                request_envelope=envelope.model_dump(mode="json"),
                context_id=context_id,
            )

        log_a2a_trace(
            "STEP",
            command_id=envelope.commandId,
            step="task_created",
            taskId=task.get("id"),
            taskStore=task_store_name,
            idempotentReplay=bool(task.get("idempotentReplay")),
        )

        if task.get("idempotentReplay"):
            replay_artifact = (task.get("resultArtifact") or {}) if isinstance(task, dict) else {}
            log_envelope_output(
                command_id=envelope.commandId,
                task_id=str(task.get("id") or ""),
                skill_id=envelope.skillId,
                organization_id=envelope.organizationId,
                outcome=str(replay_artifact.get("outcome") or "idempotent_replay"),
                task_state=str(task.get("state") or "COMPLETED"),
                idempotent_replay=True,
                affected=replay_artifact.get("affectedIds"),
                evidence=replay_artifact.get("evidence"),
            )
            return _task_to_a2a(task)

        task_id = task["id"]
        await active_store.update_task(
            envelope.organizationId,
            task_id,
            state="WORKING",
            event_type="working",
        )
        log_a2a_trace(
            "STEP",
            command_id=envelope.commandId,
            step="execute_skill",
            taskId=task_id,
            skillId=envelope.skillId,
        )

        result = await agent_executor.execute(envelope, caller)

        if isinstance(result, MissingInputStatus):
            artifact = result.model_dump(mode="json")
            updated = await active_store.update_task(
                envelope.organizationId,
                task_id,
                state="INPUT_REQUIRED",
                result_artifact=artifact,
                event_type="input_required",
                event_payload=artifact,
            )
            log_envelope_output(
                command_id=envelope.commandId,
                task_id=task_id,
                skill_id=envelope.skillId,
                organization_id=envelope.organizationId,
                outcome="input_required",
                task_state="INPUT_REQUIRED",
                message=result.message,
                missing_fields=list(result.missingFields),
            )
            return _task_to_a2a(updated)

        assert isinstance(result, SkillResultArtifact)
        artifact = result.model_dump(mode="json")
        state_map = {
            "succeeded": "COMPLETED",
            "visitor_offline": "COMPLETED",
            "failed": "FAILED",
            "rejected": "REJECTED",
            "auth_required": "AUTH_REQUIRED",
            "input_required": "INPUT_REQUIRED",
            "canceled": "CANCELED",
        }
        state = state_map.get(result.outcome, "FAILED")
        updated = await active_store.update_task(
            envelope.organizationId,
            task_id,
            state=state,
            result_artifact=artifact,
            event_type=result.outcome,
            event_payload={"outcome": result.outcome},
            error=None if result.outcome in {"succeeded", "visitor_offline"} else artifact,
        )
        log_envelope_output(
            command_id=envelope.commandId,
            task_id=task_id,
            skill_id=envelope.skillId,
            organization_id=envelope.organizationId,
            outcome=result.outcome,
            task_state=state,
            message=result.message,
            affected=result.affectedIds,
            evidence=result.evidence,
        )
        return _task_to_a2a(updated)

    @application.post("/")
    async def jsonrpc_root(
        request: Request,
        authorization: str | None = Header(default=None),
        x_tenant_id: str | None = Header(default=None),
        x_a2a_client_id: str | None = Header(default=None),
    ) -> Response:
        cfg = get_settings()
        body = await request.body()
        if len(body) > cfg.a2a_max_request_bytes:
            return _jsonrpc_error(code=-32600, message="Request too large", http_status=413)

        try:
            payload = await request.json()
        except Exception:  # noqa: BLE001
            return _jsonrpc_error(code=-32700, message="Parse error")

        if not isinstance(payload, dict):
            return _jsonrpc_error(code=-32600, message="Invalid Request")

        request_id = payload.get("id")
        method = payload.get("method")
        params = payload.get("params") or {}
        if not isinstance(params, dict):
            params = {}

        active_store = application.state.task_store

        try:
            if method in {"message/send", "SendMessage", "tasks/send"}:
                result = await handle_send_message(
                    params,
                    authorization=authorization,
                    tenant_header=x_tenant_id,
                    client_header=x_a2a_client_id,
                )
                return JSONResponse({"jsonrpc": "2.0", "id": request_id, "result": result})

            if method in {"tasks/get", "GetTask"}:
                caller = authenticate_request(
                    cfg,
                    authorization=authorization,
                    tenant_header=x_tenant_id,
                    client_header=x_a2a_client_id,
                )
                task_id = str(params.get("id") or params.get("taskId") or "")
                organization_id = resolve_caller_organization_id(
                    caller,
                    organization_id=str(params.get("organizationId") or ""),
                    tenant_header=x_tenant_id,
                )
                if not task_id or not organization_id:
                    return _jsonrpc_error(
                        code=-32602,
                        message="id and organizationId are required",
                        request_id=request_id,
                    )
                assert_tenant_access(caller, organization_id)
                task = await active_store.get_task(organization_id, task_id)
                if task.get("callerSubject") != caller.subject and "*" not in caller.scopes:
                    return _jsonrpc_error(
                        code=-32001,
                        message="Task not visible to caller",
                        request_id=request_id,
                        http_status=403,
                    )
                return JSONResponse(
                    {"jsonrpc": "2.0", "id": request_id, "result": _task_to_a2a(task)}
                )

            if method in {"tasks/list", "ListTasks"}:
                caller = authenticate_request(
                    cfg,
                    authorization=authorization,
                    tenant_header=x_tenant_id,
                    client_header=x_a2a_client_id,
                )
                organization_id = resolve_caller_organization_id(
                    caller,
                    organization_id=str(params.get("organizationId") or ""),
                    tenant_header=x_tenant_id,
                )
                assert_tenant_access(caller, organization_id)
                listed = await active_store.list_tasks(
                    organization_id,
                    caller_subject=caller.subject,
                    limit=int(params.get("limit") or 50),
                )
                return JSONResponse(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "result": {
                            "tasks": [_task_to_a2a(item) for item in listed.get("tasks", [])]
                        },
                    }
                )

            if method in {"tasks/cancel", "CancelTask"}:
                caller = authenticate_request(
                    cfg,
                    authorization=authorization,
                    tenant_header=x_tenant_id,
                    client_header=x_a2a_client_id,
                )
                task_id = str(params.get("id") or params.get("taskId") or "")
                organization_id = resolve_caller_organization_id(
                    caller,
                    organization_id=str(params.get("organizationId") or ""),
                    tenant_header=x_tenant_id,
                )
                assert_tenant_access(caller, organization_id)
                task = await active_store.get_task(organization_id, task_id)
                if task.get("callerSubject") != caller.subject:
                    return _jsonrpc_error(
                        code=-32001,
                        message="Task not visible to caller",
                        request_id=request_id,
                        http_status=403,
                    )
                canceled = await active_store.cancel_task(
                    organization_id,
                    task_id,
                    reason=str(params.get("reason") or "canceled by caller"),
                )
                return JSONResponse(
                    {"jsonrpc": "2.0", "id": request_id, "result": _task_to_a2a(canceled)}
                )

            if method in {"agent/getAuthenticatedExtendedCard", "GetExtendedAgentCard"}:
                authenticate_request(
                    cfg,
                    authorization=authorization,
                    tenant_header=x_tenant_id,
                    client_header=x_a2a_client_id,
                )
                return JSONResponse(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "result": build_extended_agent_card(cfg),
                    }
                )

            if method in {"message/stream", "SendStreamingMessage"}:
                if not cfg.a2a_streaming_enabled:
                    return _jsonrpc_error(
                        code=-32000,
                        message="Streaming disabled until task/event store is reliable",
                        request_id=request_id,
                    )

            return _jsonrpc_error(
                code=-32601,
                message=f"Method not found: {method}",
                request_id=request_id,
            )
        except AuthError as error:
            if error.status_code == 403:
                log_a2a_trace(
                    "AUTH_DENIED",
                    reason=str(error),
                    method=str(method or ""),
                )
            return _jsonrpc_error(
                code=-32001,
                message=str(error),
                request_id=request_id,
                http_status=error.status_code,
            )
        except TaskStoreError as error:
            return _jsonrpc_error(
                code=-32002,
                message=str(error),
                request_id=request_id,
                data=error.payload,
                http_status=error.status_code if error.status_code in {404, 409} else 200,
            )
        except ValidationError as error:
            return _jsonrpc_error(
                code=-32602,
                message="Invalid Worktual envelope",
                request_id=request_id,
                data=error.errors(),
            )
        except ValueError as error:
            return _jsonrpc_error(
                code=-32602,
                message=str(error),
                request_id=request_id,
            )
        except Exception as error:  # noqa: BLE001
            logger.exception("A2A JSON-RPC failure")
            return _jsonrpc_error(
                code=-32603,
                message="Internal error",
                request_id=request_id,
                data={"type": type(error).__name__},
            )

    return application


app = create_app()

try:
    import a2a  # noqa: F401

    logger.info("a2a-sdk available: %s", getattr(a2a, "__version__", "unknown"))
except Exception:  # noqa: BLE001
    logger.info("a2a-sdk import skipped")
