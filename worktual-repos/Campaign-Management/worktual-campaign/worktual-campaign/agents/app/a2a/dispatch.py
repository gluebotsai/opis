"""Dispatch Hub skillId → Super Agent (one-shot, no clarification)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.a2a.campaign_api_auth import resolve_campaign_api_bearer
from app.a2a.hub_ondemand_log import (
    is_on_demand_skill,
    log_hub_ondemand_turn,
)
from app.a2a.payload import flatten_hub_message
from app.hub_super import run_hub_task

_log = logging.getLogger(__name__)


def _hub_request_snapshot(flat: dict[str, Any]) -> dict[str, Any]:
    return {
        "skill_id": flat.get("skill_id") or "",
        "intent": flat.get("intent"),
        "organization_id": flat.get("organization_id") or "",
        "source": flat.get("source") or "hub",
        "message_id": flat.get("message_id") or "",
        "cdp_id": flat.get("cdp_id"),
        "payload": flat.get("payload") or {},
        "raw_data": flat.get("raw_data") or {},
    }


def _log_ondemand_pair(
    *,
    flat: dict[str, Any],
    dispatch_result: dict[str, Any],
    rpc_response: dict[str, Any] | None = None,
) -> None:
    skill_id = flat.get("skill_id") or ""
    intent = flat.get("intent")
    if not is_on_demand_skill(skill_id, intent):
        return
    ok = bool(dispatch_result.get("ok"))
    if rpc_response is None:
        rpc_response = {
            "status": {"state": "completed" if ok else "failed"},
            "error": None if ok else dispatch_result.get("error"),
            "error_code": dispatch_result.get("error_code"),
            "input_required": dispatch_result.get("input_required"),
        }
        if dispatch_result.get("task") is not None:
            rpc_response["artifacts"] = build_artifacts(dispatch_result)
    log_hub_ondemand_turn(
        skill_id=skill_id,
        intent=intent,
        organization_id=flat.get("organization_id") or "",
        source=flat.get("source") or "hub",
        message_id=flat.get("message_id") or "",
        request=_hub_request_snapshot(flat),
        response=dispatch_result,
        rpc_response=rpc_response,
        error=None if ok else dispatch_result.get("error"),
    )


async def dispatch_message_send(params: dict[str, Any]) -> dict[str, Any]:
    flat = flatten_hub_message(params if isinstance(params, dict) else {})
    skill_id = flat.get("skill_id") or ""
    intent = flat.get("intent")
    organization_id = flat.get("organization_id") or ""
    source = flat.get("source") or "hub"
    on_demand = is_on_demand_skill(skill_id, intent)

    if not skill_id:
        result = {
            "ok": False,
            "error_code": "missing_skill",
            "error": "skillId is required",
            "input_required": ["skillId"],
        }
        if on_demand:
            _log_ondemand_pair(flat=flat, dispatch_result=result)
        return result
    if not intent:
        result = {
            "ok": False,
            "error_code": "unknown_skill",
            "error": f"Unknown skillId: {skill_id}",
        }
        if on_demand:
            _log_ondemand_pair(flat=flat, dispatch_result=result)
        return result
    if not organization_id:
        result = {
            "ok": False,
            "error_code": "missing_organization",
            "error": "organizationId is required",
            "input_required": ["organizationId"],
        }
        if on_demand:
            _log_ondemand_pair(flat=flat, dispatch_result=result)
        return result

    token = await resolve_campaign_api_bearer(flat)
    if not token:
        result = {
            "ok": False,
            "error_code": "missing_campaign_token",
            "error": (
                "Could not resolve Campaign API auth for this Hub org. "
                "Ensure ACCOUNT_DATABASE_URL + JWT_SECRET match the Campaign backend "
                "(auto-mint from organizationId), or set A2A_CAMPAIGN_API_TOKEN, "
                "or optionally pass campaignToken."
            ),
            "input_required": ["organizationId"],
        }
        if on_demand:
            _log_ondemand_pair(flat=flat, dispatch_result=result)
        return result

    # Never escalate hub-originated work back to Hub (handled by caller).
    task = {
        "task_id": str(uuid.uuid4()),
        "correlation_id": flat.get("message_id") or str(uuid.uuid4()),
        "intent": intent,
        "organization_id": organization_id,
        "token": token,
        "payload": {
            **(flat.get("payload") or {}),
            "source": source or "hub",
        },
    }
    payload = flat.get("payload") if isinstance(flat.get("payload"), dict) else {}
    _log.info(
        "a2a dispatch skill=%s intent=%s org=%s source=%s "
        "message_id=%s cdp_id=%s email=%s emails=%s raw_data_keys=%s",
        skill_id,
        intent,
        organization_id,
        source,
        flat.get("message_id") or "",
        flat.get("cdp_id") or payload.get("cdp_id") or payload.get("cdpId") or "",
        payload.get("email") or "",
        payload.get("emails") or [],
        list((flat.get("raw_data") or {}).keys()),
    )
    result_task = await run_hub_task(task)
    status = str(result_task.get("status") or "failed")
    ok = status in {"completed", "partial"}
    dispatch_result = {
        "ok": ok,
        "skill_id": skill_id,
        "intent": intent,
        "organization_id": organization_id,
        "source": source,
        "task": result_task,
        "error": None if ok else _first_error(result_task),
        "error_code": None if ok else "task_failed",
    }
    if on_demand:
        _log_ondemand_pair(
            flat=flat,
            dispatch_result=dispatch_result,
            rpc_response={
                "status": {"state": "completed" if ok else "failed"},
                "artifacts": build_artifacts(dispatch_result),
            },
        )
    return dispatch_result


def _first_error(result: dict[str, Any]) -> str:
    errors = result.get("errors") if isinstance(result.get("errors"), list) else []
    if errors and isinstance(errors[0], dict):
        return str(errors[0].get("message") or errors[0].get("code") or "failed")
    return "Hub super agent task failed"


def build_artifacts(dispatch_result: dict[str, Any]) -> list[dict[str, Any]]:
    """JSON-RPC artifact receipt for Hub."""
    task = dispatch_result.get("task") if isinstance(dispatch_result.get("task"), dict) else {}
    return [
        {
            "name": "campaign-receipt",
            "description": "Campaign Super Agent execution receipt",
            "parts": [
                {
                    "kind": "data",
                    "data": {
                        "ok": dispatch_result.get("ok"),
                        "skillId": dispatch_result.get("skill_id"),
                        "organizationId": dispatch_result.get("organization_id"),
                        "status": task.get("status"),
                        "pipeline": task.get("pipeline"),
                        "result": task.get("result"),
                        "warnings": task.get("warnings"),
                        "errors": task.get("errors"),
                        "step_results": task.get("step_results"),
                    },
                }
            ],
        }
    ]
